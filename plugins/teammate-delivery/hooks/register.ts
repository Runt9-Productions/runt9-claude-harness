import type {
  AgentInfo,
  ApiMessage,
  EngineInterface,
  Register,
  SessionSendInput,
  TurnCompleteReason,
} from 'claude-code'

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

type StoredRow = {
  row: Row
  target: AgentInfo
  // The turn open when the append began, which may have closed by the time it returns.
  turn: Turn
}

// The engine's name for the lead in an idle teammate's mailbox; a diverted row must name it the same way.
const LEAD_NAME = 'team-lead'

const WAKE_UP =
  'A message reached you while you were working and was added to your conversation, ' +
  'under a header naming its sender. Read it there before you go on.'

const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/

// The shape of the engine's envelope tags: `<`, an optional `/`, then a name that starts with a letter and holds a
// separator. Each of the three is matched with its look-alikes, and invisible characters and combining marks are
// skipped wherever they fall, since a model reads through all of them. One glued to a word is escaped too, generics
// such as `Result<io_error>` included, because a model reads `text<envelope-tag>` as a tag all the same. The shape
// ends at the separator, so the closing `>` and its look-alikes play no part.
const SKIPPED = String.raw`\p{Default_Ignorable_Code_Point}\p{M}`
// `<` in normal, small and fullwidth forms, the left and low left modifier arrowheads, the single left angle quotation
// mark, and the CJK, technical, mathematical, ornament and curved left angle brackets.
const OPENER = String.raw`<\uFE64\uFF1C\u02C2\u02F1\u2039\u3008\u2329\u27E8\u276C\u276E\u2770\u29FC`
// `/` in normal and fullwidth forms, the fraction, division and big slashes, the box-drawing diagonal, the
// mathematical rising diagonal and the Philippine single punctuation.
const SLASH = String.raw`/\uFF0F\u2044\u2215\u29F8\u2571\u27CB\u1735`
// Every Unicode dash, the minus sign, the soft hyphen, the hyphen bullet, and the modifier, superscript, subscript and
// heavy minus signs.
const DASH = String.raw`\p{Pd}\u2212\u00AD\u2043\u02D7\u207B\u208B\u2796`
// Every Unicode connector, such as `_`, and the double low line.
const CONNECTOR = String.raw`\p{Pc}\u2017`
// `:` in normal, vertical, small and fullwidth forms, the ratio sign, the modifier and raised modifier colons, two dot
// punctuation, the Armenian full stop and the Hebrew sof pasuq.
const COLON = String.raw`:\uFE13\uFE55\uFF1A\u2236\uA789\u02F8\u205A\u0589\u05C3`
const SEPARATOR = `${DASH}${CONNECTOR}${COLON}`
const ENVELOPE_LIKE_TAG = new RegExp(
  String.raw`[${OPENER}](?=[${SKIPPED}]*(?:[${SLASH}][${SKIPPED}]*)?\p{L}[\p{L}\p{N}.${SEPARATOR}${SKIPPED}]*[${SEPARATOR}])`,
  'gu',
)

// Separates text blocks when matching, so a row matches whole blocks and never the start of a longer one.
const BLOCK_SEPARATOR = '\u0000'

function escapeTags(text: string): string {
  return text.replace(ENVELOPE_LIKE_TAG, '$&\\')
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

// A refused read holds nothing, so every row counts as missing from it.
async function conversation($: EngineInterface, agentId: string): Promise<readonly ApiMessage[]> {
  const messages = await $.session.messages({ agentId, as: 'api' })
  return Array.isArray(messages) ? messages : []
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
  const held = heldRows(rows, await conversation($, agentId))
  const missing = rows.filter((_, i) => !held[i])
  if (missing.length === 0) {
    await mail($, agentId, recipient, WAKE_UP)
    return
  }
  for (const row of missing) await mail($, agentId, recipient, row.join('\n'))
}

// The running teammate that `to` names, when exactly one agent answers to it.
function addressedTeammate(agents: readonly AgentInfo[], to: string): AgentInfo | undefined {
  const matches = agents.filter(agent => [agent.id, agent.name, agent.teammateId].includes(to))
  const target = matches.length === 1 ? matches[0] : undefined
  if (target?.teammateId === undefined || target.status !== 'running') return undefined
  return target
}

function senderName(agents: readonly AgentInfo[], agentId: string | undefined): string {
  if (agentId === undefined) return LEAD_NAME
  return agents.find(agent => agent.id === agentId)?.name ?? agentId
}

// Stores a model's message in the open turn of the teammate it addresses. Undefined means nothing was stored.
async function storeRow(
  $: EngineInterface,
  openTurns: ReadonlyMap<string, Turn>,
  e: SessionSendInput,
): Promise<StoredRow | undefined> {
  if (e.origin.kind !== 'model' || openTurns.size === 0) return undefined
  const agents = await $.agent.list()
  const target = addressedTeammate(agents, e.to)
  const turn = target === undefined ? undefined : openTurns.get(target.id)
  if (target === undefined || turn === undefined) return undefined
  const stored = await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: composeRow(senderName(agents, e.agentId), e.text) }] },
    agentId: target.id,
  })
  if (stored.deny !== undefined) return undefined
  return { row: textBlocks(stored.message.content), target, turn }
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
    // Read before `next`: a row stored while the request streams can merge into the messages it carried. Only
    // rows stored before the read are candidates, so one stored during it stays.
    let carried: Row[] = []
    if (agentId !== undefined && turn !== undefined && turn.rows.length > 0) {
      const candidates = turn.rows.slice()
      await safely($, async () => {
        const held = heldRows(candidates, (await conversation($, agentId)).slice(0, e.messageCount))
        carried = candidates.filter((_, i) => held[i])
      })
    }
    const result = yield* next(e)
    // A request that drew no response reached no model, so its rows wait for the turn end.
    if (turn !== undefined && result.stopReason !== null) {
      // Removes from the live list, which a turn end may have emptied meanwhile.
      for (const row of carried) {
        const at = turn.rows.indexOf(row)
        if (at !== -1) turn.rows.splice(at, 1)
      }
    }
    return result
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
    // A failed lookup or append leaves the message to the mailbox.
    const stored = await storeRow($, openTurns, e).catch(() => undefined)
    if (stored === undefined) return next(e)

    // The row is stored from here on, so falling back to the mailbox would deliver it twice. Looked up again because
    // the turn may have ended during the append, and the next one begun.
    const { row, target, turn } = stored
    const recipient = target.name ?? target.id
    const live = openTurns.get(target.id)
    if (live !== undefined) {
      live.rows.push(row)
      live.recipient = recipient
    } else if (turn.ending !== undefined) {
      const ending = turn.ending
      await safely($, () => settle($, target.id, recipient, ending, [row]))
    }
    return { isDelivered: true }
  })
}
