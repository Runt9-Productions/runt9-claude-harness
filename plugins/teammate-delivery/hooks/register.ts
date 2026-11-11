import type { AgentInfo, ApiContentBlock, EngineInterface, Register, SessionSendInput } from 'claude-code'

type Turn = {
  id: string
  // Composed messages waiting for the teammate's next tool result.
  held: string[]
  // Messages added to a tool result, oldest first, that no model response has read yet.
  unread: string[]
  recipient?: string
}

// The engine's name for the lead in an idle teammate's mailbox; a diverted message must name it the same way.
const LEAD_NAME = 'team-lead'

const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/

// The shape of the engine's envelope tags: `<`, an optional `/`, then a name that starts with a letter and holds a
// separator. Each of the three is matched with the look-alikes the constants below list, and no others. Invisible
// characters and combining marks are skipped wherever they fall, since a model reads through all of them. One glued to
// a word is escaped too, generics such as `Result<io_error>` included, because a model reads `text<envelope-tag>` as a
// tag all the same. The shape ends at the separator, so the closing `>` and its look-alikes play no part.
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

function escapeTags(text: string): string {
  return text.replace(ENVELOPE_LIKE_TAG, '$&\\')
}

function composeMessage(sender: string, body: string): string {
  const quoted = escapeTags(body)
    .split(LINE_BREAK)
    .map(line => `> ${line}`)
  return [`Message from ${sender}, sent during your turn:`, ...quoted].join('\n')
}

function isTextOrImage(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) return false
  if (!('type' in part)) return false
  return part.type === 'text' || part.type === 'image'
}

// Text inside a `tool_reference` result's content makes every later request fail, so messages go beside the results,
// which `tool_reference` rows accept. Other result kinds are untried, so only rows of text and image results take
// them; skipping a row delays the messages by one tool call at most.
function takesMessages(block: ApiContentBlock): boolean {
  if (block.type !== 'tool_result') return true
  const content = block.content
  if (content === undefined || typeof content === 'string') return true
  return Array.isArray(content) && content.every(isTextOrImage)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function mail($: EngineInterface, agentId: string, recipient: string, text: string): Promise<void> {
  const sent = await $.session.send({ to: { agentId }, text })
  if (!sent.isDelivered) $.ui.toast(`teammate-delivery: a message for ${recipient} was lost: ${sent.reason}`)
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

// The running teammate a model's message addresses, with the message composed for it. Undefined leaves the message to
// the mailbox.
async function divertedMessage($: EngineInterface, openTurns: ReadonlyMap<string, Turn>, e: SessionSendInput) {
  if (e.origin.kind !== 'model' || openTurns.size === 0) return undefined
  const agents = await $.agent.list()
  const target = addressedTeammate(agents, e.to)
  if (target === undefined) return undefined
  const text = composeMessage(senderName(agents, e.agentId), e.text)
  return { text, agentId: target.id, recipient: target.name ?? target.id }
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
    // A turn whose end this module never heard leaves its messages to the next one.
    const turn: Turn = { id: turnId, held: current?.held ?? [], unread: current?.unread ?? [], recipient: current?.recipient }
    openTurns.set(agentId, turn)
    return turn
  }

  on('turn.start', ($, e, next) => {
    if (e.agentId !== undefined) openTurn(e.agentId, e.turnId)
    return next(e)
  })

  // A step also reopens a turn whose start went unheard, as after a reload.
  on('turn.step', async function* ($, e, next) {
    const turn = e.agentId === undefined ? undefined : openTurn(e.agentId, e.turnId)
    // Counted before `next`, since a text added while the request streams is not in it and lands after those that are.
    const carried = turn?.unread.length ?? 0
    const result = yield* next(e)
    // No stop reason means no response arrived, so no model read the request.
    if (result.stopReason !== null) turn?.unread.splice(0, carried)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const turn = agentId === undefined ? undefined : openTurns.get(agentId)
    if (agentId === undefined || turn?.id !== e.turnId) return next(e)
    openTurns.delete(agentId)
    const result = await next(e)
    const recipient = turn.recipient ?? agentId
    // An unread text was added before any still held, so it is mailed first.
    for (const text of [...turn.unread, ...turn.held]) await safely($, () => mail($, agentId, recipient, text))
    return result
  })

  on('session.append', { door: 'tool-result' }, ($, e, next) => {
    const turn = e.agentId === undefined ? undefined : openTurns.get(e.agentId)
    if (turn === undefined || turn.held.length === 0) return next(e)
    if (!e.message.content.every(takesMessages)) return next(e)
    const added = turn.held.splice(0)
    turn.unread.push(...added)
    const messages = added.map(text => ({ type: 'text', text }))
    return next({ ...e, message: { ...e.message, content: [...e.message.content, ...messages] } })
  })

  on('session.send', async ($, e, next) => {
    // A failed lookup leaves the message to the mailbox.
    const diverted = await divertedMessage($, openTurns, e).catch(() => undefined)
    if (diverted === undefined) return next(e)
    // Looked up after the last await, so a turn that ended during the listing is not found and the turn found is still
    // open when it takes the message.
    const turn = openTurns.get(diverted.agentId)
    if (turn === undefined) return next(e)
    turn.held.push(diverted.text)
    turn.recipient = diverted.recipient
    return { isDelivered: true }
  })
}
