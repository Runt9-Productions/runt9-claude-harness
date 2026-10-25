import type { AgentInfo, ApiContentBlock, ApiMessage, EngineInterface, Register, SessionSendInput, TurnCompleteInput } from 'claude-code'

// What Agent Teams calls the main session, and what a teammate replies to.
const LEAD_NAME = 'team-lead'

// Every line break a reader could render as one, so no line of a quoted body escapes the quote.
const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/

// Sent by mailbox to wake a teammate whose turn ended before reading rows added to it: those rows are already in its
// conversation, so its next request carries them and only the wake-up is needed.
const WAKE_UP = '[teammate-delivery] A message headed "delivered while you were working" reached you as your turn ended. Read it above and act on it.'

// Rows added to a running teammate's loop that no model request of that loop has carried yet, by loop id. A hot
// reload forgets them, so a row added just before one gets no wake-up if its turn then ends. A row is recorded once
// its append resolves, so a request made meanwhile leaves it here and the turn's end sends a needless wake-up.
const unread = new Map<string, string[]>()

/** The one running teammate a send addresses, or undefined when none or several do. */
function runningTeammate(agents: readonly AgentInfo[], to: string): AgentInfo | undefined {
  const addressed = agents
    .filter(agent => agent.teammateId !== undefined && agent.status === 'running')
    .filter(agent => [agent.id, agent.name, agent.teammateId].includes(to))
  return addressed.length === 1 ? addressed[0] : undefined
}

function senderName(agents: readonly AgentInfo[], agentId: string | undefined): string {
  if (agentId === undefined) return LEAD_NAME
  const sender = agents.find(agent => agent.id === agentId)
  return sender?.name ?? agentId
}

/**
 * The row the receiving loop reads, its body quoted so that a line inside it cannot pass for a header:
 *
 * [Message from team-lead, delivered while you were working]
 * > Stop after this file and report.
 */
function framed(agents: readonly AgentInfo[], e: SessionSendInput): string {
  const header = `[Message from ${senderName(agents, e.agentId)}, delivered while you were working]`
  const lines = e.text.split(LINE_BREAK).map(line => `> ${line}`)
  return [header, ...lines].join('\n')
}

/** Adds the message to the addressed teammate's loop if it is mid-turn; false when it has to go by mailbox. */
async function addToRunningLoop($: EngineInterface, e: SessionSendInput): Promise<boolean> {
  const agents = await $.agent.list()
  const teammate = runningTeammate(agents, e.to)
  if (teammate === undefined) return false

  const text = framed(agents, e)
  const appended = await $.session.append({ agentId: teammate.id, message: { type: 'user', content: [{ type: 'text', text }] } })
  if (appended.deny !== undefined) return false

  unread.set(teammate.id, [...(unread.get(teammate.id) ?? []), text])
  return true
}

function holds(messages: readonly ApiMessage[], row: string): boolean {
  const isRow = (block: ApiContentBlock) => block.type === 'text' && block.text === row
  return messages.some(message => message.content.some(isRow))
}

/**
 * After a teammate's turn, the rows added to it that no request of the turn carried: by mailbox, a wake-up when its
 * conversation holds them all, else the whole rows it does not hold. A turn that ended any other way than with an
 * answer was stopped (interrupted, killed or failed), and a mailbox send would start it again, so nothing is sent.
 */
async function deliverUnread($: EngineInterface, e: TurnCompleteInput, agentId: string, rows: readonly string[]) {
  if (e.reason !== 'answer') {
    $.ui.toast(`teammate-delivery: ${agentId} stopped (${e.reason}) before reading ${rows.length} message(s)`)
    return
  }
  const messages = await $.session.messages({ agentId, as: 'api' })
  // The messages the next request is built from; when they cannot be read, every row counts as missing.
  const held = 'deny' in messages ? [] : messages
  const missing = rows.filter(row => !holds(held, row))
  const texts = missing.length > 0 ? missing : [WAKE_UP]
  for (const text of texts) {
    const sent = await $.session.send({ to: { agentId }, text })
    if (!sent.isDelivered) $.ui.toast(`teammate-delivery: a message to ${agentId} was lost (${sent.reason})`)
  }
}

export const register: Register = on => {
  // A teammate's mailbox is read only when its turn ends, which can be many tool calls after a message arrives.
  // Answering without `next` hides the send from every session.send hook beneath this one.
  on('session.send', async ($, e, next) => {
    // Another plugin's send keeps its own framing and timing.
    if (e.origin.kind !== 'model') return next(e)
    const isAdded = await addToRunningLoop($, e).catch(() => false)
    return isAdded ? { isDelivered: true } : next(e)
  })

  // Counts every row added before this hook as carried. The types do not order an append against the building of
  // this request, so a row added just before may miss it; that row then waits for the loop's next request, which is
  // the next turn's when this request was the turn's last.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) unread.delete(e.agentId)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) return result
    const rows = unread.get(e.agentId) ?? []
    unread.delete(e.agentId)
    if (rows.length > 0) await deliverUnread($, e, e.agentId, rows)
    return result
  })
}
