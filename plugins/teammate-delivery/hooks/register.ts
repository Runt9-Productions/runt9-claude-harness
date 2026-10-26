import type { AgentInfo, ApiContentBlock, ApiMessage, EngineInterface, Register, SessionSendInput, TurnCompleteReason } from 'claude-code'

// What Agent Teams calls the main session, and what a teammate replies to.
const LEAD_NAME = 'team-lead'

// Every line break a reader could render as one, so no line of a quoted body escapes the quote.
const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/

const DELIVERED = 'delivered while you were working'

// Sent by mailbox to wake a teammate whose turn ended before reading rows added to it: those rows are already in its
// conversation, so its next request carries them and only the wake-up is needed.
export const WAKE_UP = `[teammate-delivery] A message headed "${DELIVERED}" reached you as your turn ended. Read it above and act on it.`

// Each teammate loop's turn as this mod heard it: `open` from its start or first step until its end, then why it
// ended. A hot reload forgets it, so sends go by mailbox until the loop's next step.
const turns = new Map<string, 'open' | TurnCompleteReason>()

// Rows added to a loop mid-turn, as stored, that no model request of the loop has carried yet, by loop id. A hot
// reload forgets them, so a row added just before one gets no wake-up if its turn then ends.
const unread = new Map<string, string[]>()

/** The one teammate a send addresses that is mid-turn, or undefined when none or several are. */
function midTurnTeammate(agents: readonly AgentInfo[], to: string): AgentInfo | undefined {
  const addressed = agents
    .filter(agent => agent.teammateId !== undefined && agent.status === 'running' && turns.get(agent.id) === 'open')
    .filter(agent => [agent.id, agent.name, agent.teammateId].includes(to))
  return addressed.length === 1 ? addressed[0] : undefined
}

function nameOf(agents: readonly AgentInfo[], agentId: string | undefined): string {
  if (agentId === undefined) return LEAD_NAME
  const agent = agents.find(candidate => candidate.id === agentId)
  return agent?.name ?? agentId
}

/**
 * The row the receiving loop reads, its body quoted so that a line inside it cannot pass for a header:
 *
 * [Message from team-lead, delivered while you were working]
 * > Stop after this file and report.
 */
function framed(agents: readonly AgentInfo[], e: SessionSendInput): string {
  const header = `[Message from ${nameOf(agents, e.agentId)}, ${DELIVERED}]`
  const lines = e.text.split(LINE_BREAK).map(line => `> ${line}`)
  return [header, ...lines].join('\n')
}

function textOf(content: readonly ApiContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

/** Adds the message to the addressed teammate's loop if it is mid-turn; false when it has to go by mailbox. */
async function addToRunningLoop($: EngineInterface, e: SessionSendInput): Promise<boolean> {
  const agents = await $.agent.list()
  const teammate = midTurnTeammate(agents, e.to)
  if (teammate === undefined) return false

  const text = framed(agents, e)
  const appended = await $.session.append({ agentId: teammate.id, message: { type: 'user', content: [{ type: 'text', text }] } })
  if (appended.deny !== undefined) return false

  // Another plugin's session.append hook may have rewritten the row, and the conversation holds what was stored.
  const row = textOf(appended.message.content)
  // A turn that ended while the row was stored has already delivered its rows, so this one goes now. The entry is
  // set: midTurnTeammate found it open, and none is ever deleted.
  const turn = turns.get(teammate.id)!
  if (turn === 'open') unread.set(teammate.id, [...(unread.get(teammate.id) ?? []), row])
  else {
    const name = teammate.name ?? teammate.id
    // The row is stored, so a failure here must not reach the caller, which would send the message by mailbox too.
    await deliverUnread($, turn, teammate.id, name, [row]).catch((error: unknown) => {
      $.ui.toast(`teammate-delivery: ${name} may not have read a message (${String(error)})`)
    })
  }
  return true
}

/** The messages a loop's next request is built from; none when they cannot be read. */
async function conversation($: EngineInterface, agentId: string): Promise<readonly ApiMessage[]> {
  const messages = await $.session.messages({ agentId, as: 'api' })
  return 'deny' in messages ? [] : messages
}

function holds(messages: readonly ApiMessage[], row: string): boolean {
  const isRow = (block: ApiContentBlock) => block.type === 'text' && block.text === row
  return messages.some(message => message.content.some(isRow))
}

/**
 * Drops the rows this step's request carries: those within its first `messageCount` messages. A row stored after the
 * engine built the request stays when it is a message of its own; one the engine merged into the request's last
 * message cannot be told apart and counts as carried, so if this is the turn's last request nothing wakes the loop.
 */
async function dropCarried($: EngineInterface, agentId: string, messageCount: number) {
  const rows = unread.get(agentId) ?? []
  if (rows.length === 0) return
  const carried = (await conversation($, agentId)).slice(0, messageCount)
  // Rows recorded while the messages were read were stored after the request was built.
  const recordedSince = (unread.get(agentId) ?? []).slice(rows.length)
  unread.set(agentId, [...rows.filter(row => !holds(carried, row)), ...recordedSince])
}

/**
 * After a teammate's turn, the rows added to it that no request of the turn carried: by mailbox, a wake-up when its
 * conversation holds them all, else the whole rows it does not hold. A turn that ended any other way than with an
 * answer was stopped (interrupted, killed or failed), and a mailbox send would start it again, so nothing is sent.
 */
async function deliverUnread($: EngineInterface, reason: TurnCompleteReason, agentId: string, name: string, rows: readonly string[]) {
  if (reason !== 'answer') {
    $.ui.toast(`teammate-delivery: ${name} stopped (${reason}) before reading ${rows.length} message(s)`)
    return
  }
  const held = await conversation($, agentId)
  const missing = rows.filter(row => !holds(held, row))
  const texts = missing.length > 0 ? missing : [WAKE_UP]
  for (const text of texts) {
    const sent = await $.session.send({ to: { agentId }, text })
    if (!sent.isDelivered) $.ui.toast(`teammate-delivery: a message to ${name} was lost (${sent.reason})`)
  }
}

export const register: Register = on => {
  // A teammate's mailbox is read only when its turn ends, which can be many tool calls after a message arrives.
  // Answering without `next` hides the send from every session.send hook beneath this one and from every
  // session.receive hook, and the receiver gets a row whose sender is only the name in its header, never the
  // harness's verified `origin.teammate`.
  on('session.send', async ($, e, next) => {
    // Another plugin's send keeps its own framing and timing.
    if (e.origin.kind !== 'model') return next(e)
    const isAdded = await addToRunningLoop($, e).catch(() => false)
    return isAdded ? { isDelivered: true } : next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) turns.set(e.agentId, 'open')
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      turns.set(e.agentId, 'open')
      await dropCarried($, e.agentId, e.messageCount)
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) return result
    // Closing the turn and taking its rows must not be split by an await: addToRunningLoop decides between the two
    // by whether the turn is still open.
    turns.set(e.agentId, e.reason)
    const rows = unread.get(e.agentId) ?? []
    unread.delete(e.agentId)
    if (rows.length > 0) await deliverUnread($, e.reason, e.agentId, nameOf(await $.agent.list(), e.agentId), rows)
    return result
  })
}
