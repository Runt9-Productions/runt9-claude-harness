import type { AgentInfo, ApiMessage, EngineInterface, Register, TurnCompleteReason } from 'claude-code'

// The stored text blocks of one diverted row.
type Row = readonly string[]

type Turn = {
  id: string
  // Diverted rows that no model request has carried yet.
  rows: Row[]
  // Set the moment the turn closes; an append still in flight reads it.
  ending?: TurnCompleteReason
  recipient?: string
}

// The engine's name for the lead in an idle teammate's mailbox; a diverted row must name it the same way.
const LEAD_NAME = 'team-lead'

const WAKE_UP =
  'A message reached you while you were working and was added to your conversation, ' +
  'under a header naming its sender. Read it there before you go on.'

const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/

// A tag name holding `-`, `_` or `:` is the shape of the engine's envelope tags. One glued to a word is escaped too,
// generics such as `Result<io_error>` included, because a model reads `text<envelope-tag>` as a tag all the same.
const TAG_NAME = String.raw`[a-z][\w.:-]*[-_:][\w.:-]*(?:[\s/>]|$)`
const ENVELOPE_LIKE_TAG = new RegExp(String.raw`<(?=\/?${TAG_NAME})`, 'gi')

// Separates text blocks when matching, so a row matches whole blocks and never the start of a longer one.
const BLOCK_SEPARATOR = '\u0000'

function escapeTags(text: string): string {
  return text.replace(ENVELOPE_LIKE_TAG, '<\\')
}

function composeRow(sender: string, body: string): string {
  const quoted = escapeTags(body)
    .split(LINE_BREAK)
    .map(line => `> ${line}`)
  return [`Message from ${sender}, delivered during your turn:`, ...quoted].join('\n')
}

function textBlocks(content: readonly { type: string; text?: unknown }[]): string[] {
  return content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
}

function bounded(blocks: readonly string[]): string {
  return BLOCK_SEPARATOR + blocks.join(BLOCK_SEPARATOR) + BLOCK_SEPARATOR
}

// Marks each row found in `messages`, a repeated row needing a repeated occurrence.
function heldRows(rows: readonly Row[], messages: readonly ApiMessage[]): boolean[] {
  const haystack = bounded(messages.flatMap(message => textBlocks(message.content)))
  const searchFrom = new Map<string, number>()
  return rows.map(row => {
    const needle = bounded(row)
    const at = haystack.indexOf(needle, searchFrom.get(needle) ?? 0)
    if (at === -1) return false
    // The closing separator is the next block's opening one.
    searchFrom.set(needle, at + needle.length - 1)
    return true
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function mail($: EngineInterface, agentId: string, recipient: string, text: string): Promise<void> {
  const sent = await $.session.send({ to: { agentId }, text })
  if (!sent.isDelivered) $.ui.toast(`teammate-delivery: a message for ${recipient} was lost: ${sent.reason}`)
}

async function settle(
  $: EngineInterface,
  agentId: string,
  recipient: string,
  ending: TurnCompleteReason,
  rows: readonly Row[],
): Promise<void> {
  if (rows.length === 0) return
  if (ending !== 'answer') {
    const count = rows.length === 1 ? 'A message' : `${rows.length} messages`
    $.ui.toast(`teammate-delivery: ${count} sent to ${recipient} mid-turn went unread; its turn ended (${ending})`)
    return
  }
  const messages = await $.session.messages({ agentId, as: 'api' })
  const held = Array.isArray(messages) ? heldRows(rows, messages) : rows.map(() => false)
  const missing = rows.filter((_, i) => !held[i])
  if (missing.length === 0) {
    await mail($, agentId, recipient, WAKE_UP)
    return
  }
  for (const row of missing) await mail($, agentId, recipient, row.join('\n'))
}

async function safely($: EngineInterface, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.toast(`teammate-delivery: ${messageOf(error)}`)
  }
}

export const register: Register = on => {
  const openTurns = new Map<string, Turn>()

  function openTurn(agentId: string, turnId: string): Turn {
    const current = openTurns.get(agentId)
    if (current?.id === turnId) return current
    // A turn whose end this module never heard leaves its rows to the next one.
    const turn: Turn = { id: turnId, rows: current?.rows ?? [], recipient: current?.recipient }
    openTurns.set(agentId, turn)
    return turn
  }

  on('turn.start', ($, e, next) => {
    if (e.agentId !== undefined) openTurn(e.agentId, e.turnId)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    // A step also reopens a turn whose start went unheard, as after a reload.
    const turn = agentId === undefined ? undefined : openTurn(agentId, e.turnId)
    // Checked before `next`: a row stored while the request streams can merge into the messages it carried. Only
    // rows stored before the read are candidates, so one stored during it stays.
    if (agentId !== undefined && turn !== undefined && turn.rows.length > 0) {
      const candidates = turn.rows.slice()
      await safely($, async () => {
        const messages = await $.session.messages({ agentId, as: 'api' })
        if (!Array.isArray(messages)) return
        const held = heldRows(candidates, messages.slice(0, e.messageCount))
        // Removes from the live list, which a turn end may have emptied during the await.
        for (const [i, row] of candidates.entries()) {
          const at = held[i] ? turn.rows.indexOf(row) : -1
          if (at !== -1) turn.rows.splice(at, 1)
        }
      })
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const turn = agentId === undefined ? undefined : openTurns.get(agentId)
    if (agentId === undefined || turn?.id !== e.turnId) return next(e)
    openTurns.delete(agentId)
    turn.ending = e.reason
    const rows = turn.rows.splice(0)
    const result = await next(e)
    await safely($, () => settle($, agentId, turn.recipient ?? agentId, e.reason, rows))
    return result
  })

  on('session.send', async ($, e, next) => {
    if (e.origin.kind !== 'model') return next(e)

    let agents: AgentInfo[]
    try {
      agents = await $.agent.list()
    } catch {
      return next(e)
    }
    const matches = agents.filter(agent => [agent.id, agent.name, agent.teammateId].includes(e.to))
    const target = matches.length === 1 ? matches[0] : undefined
    const turn = target === undefined ? undefined : openTurns.get(target.id)
    if (target?.teammateId === undefined || target.status !== 'running' || turn === undefined) return next(e)

    const sender =
      e.agentId === undefined ? LEAD_NAME : (agents.find(agent => agent.id === e.agentId)?.name ?? e.agentId)
    const recipient = target.name ?? target.id
    let row: Row
    try {
      const stored = await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text: composeRow(sender, e.text) }] },
        agentId: target.id,
      })
      if (stored.deny !== undefined) return next(e)
      row = textBlocks(stored.message.content)
    } catch {
      return next(e)
    }

    // The row is stored from here on, so falling back to the mailbox would deliver it twice.
    if (turn.ending === undefined) {
      turn.rows.push(row)
      turn.recipient = recipient
    } else {
      const ending = turn.ending
      await safely($, () => settle($, target.id, recipient, ending, [row]))
    }
    return { isDelivered: true }
  })
}
