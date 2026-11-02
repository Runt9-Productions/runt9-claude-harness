import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, EngineInterface, Register, Timer, TurnCompleteInput } from 'claude-code'

import type { AttentionMode } from '../types'
import { isBoardTool, postDenial, refuse } from './board-posts'
import { followRoot, holdSandbox, putSandboxBackForEveryHolder, releaseSandbox, toastIfHeld } from './sandbox-hold'

const mode = atom({ plugin: 'away', key: 'mode' } as const, 'present')
const isRulesOwed = atom({ plugin: 'away', key: 'isRulesOwed' } as const, false)
const isReportOwed = atom({ plugin: 'away', key: 'isReportOwed' } as const, false)
const isHandoffArmed = atom({ plugin: 'away', key: 'isHandoffArmed' } as const, true)

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
    'apply. Reply and stop as you normally would. Post a question as a board decision (mcp__board__ask_decision),',
    'never through AskUserQuestion or in a reply, and put in its context what that reply would have said, so it reads',
    'on its own.',
  ].join(' '),
  distracted: [
    '[mode: distracted] The owner is on another monitor, glancing at this session now and then and not reading',
    'replies closely. Keep each reply to one or two lines and give detail only when asked. Post a question as a board',
    'decision (mcp__board__ask_decision), never through AskUserQuestion or in a reply, then carry on with whatever',
    "does not depend on it. Stop for anything you normally would, and say so in the reply's first line so a glance",
    'catches it.',
  ].join(' '),
  away: [
    '[mode: away] The owner is away from the computer and reads nothing until they are back. Keep each reply to a',
    'line at most, or write none. While work remains, go on to the next step rather than ending the turn. Post a',
    'question as a board decision (mcp__board__ask_decision), never through AskUserQuestion, with the option you would',
    'take as the recommended one, and when that option can be undone, proceed on it without waiting for the answer.',
    'Stop only for a risk to the security or integrity of the machine or a repository, a change that would take hours',
    'to unwind, or a hard stop the owner named. Keep your board tasks current (mcp__board__set_task), since the owner',
    'reads them on return.',
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

// Which $.agent.list() statuses are of a loop that has ended. board's ENDED_STATUSES holds its own list, and where the
// two disagree, away and board count different loops as ended.
const IS_ENDED: Record<AgentStatus, boolean> = {
  pending: false,
  running: false,
  waiting: false,
  idle: false,
  completed: true,
  failed: true,
  killed: true,
}

// A timer this short fires once the running hook has returned: a prompt submitted or a command run from inside
// command.run or turn.complete would wait on the turn the hook holds, and is refused.
const AFTER_HOOK_RETURNS_MS = 1

const SESSION_PREFIX = 'session:'

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

const storeKey = (sessionId: string) => `${SESSION_PREFIX}${sessionId}`

const isMode = (value: unknown): value is AttentionMode => MODES.includes(value as AttentionMode)

async function loadMode($: EngineInterface, sessionId: string): Promise<AttentionMode | undefined> {
  const value: unknown = await $.store.get(storeKey(sessionId))
  return isMode(value) ? value : undefined
}

// Present is the default and keeps no key, so only sessions left distracted or away are stored.
async function save($: EngineInterface, current: AttentionMode) {
  const key = storeKey(await $.session.id())
  if (current === 'present') await $.store.delete(key)
  else await $.store.set(key, current)
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
    await toastIfRestored($, saved)
    current = saved
  } else if (previousId === undefined) {
    // A fresh session, or a hot reload, whose state already holds the mode.
    current = await read($, mode)
    if (current === 'present') await toastIfHeld($)
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
async function toastIfRestored($: EngineInterface, saved: AttentionMode) {
  const held: AttentionMode = await read($, mode)
  if (saved !== held) $.ui.toast(`Restored ${saved} mode`)
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
  if (next !== previous) return await switchMode($, previous, next)
  if (next !== 'present') return `Already ${next}.`
  return await presentAgainPuttingSandboxBack($)
}

async function switchMode($: EngineInterface, previous: AttentionMode, next: AttentionMode): Promise<string> {
  dropContinuation()
  await update($, mode, () => next)
  await save($, next)
  const sessionId = await $.session.id()
  if (previous === 'away') await releaseSandbox($, sessionId)
  if (next === 'away') await holdSandbox($, sessionId)
  showStatus($, next)
  await sendRules($, next)
  if (next === 'away') await update($, isReportOwed, () => true)
  if (next === 'present') await askForReturnReport($)
  return `Mode: ${next}.`
}

// Present typed while present is the owner's way to undo a hold left by a session that ended while away.
async function presentAgainPuttingSandboxBack($: EngineInterface): Promise<string> {
  const already = 'Already present.'
  if (!(await putSandboxBackForEveryHolder($))) return already
  return `${already} The sandbox settings a session left behind while away are put back.`
}

async function askForReturnReport($: EngineInterface) {
  if (!(await read($, isReportOwed))) return
  await update($, isReportOwed, () => false)
  $.clock.after(AFTER_HOOK_RETURNS_MS, () => void submit($, RETURN_PROMPT, 'The return report'))
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
  continuationTimer = $.clock.after(delayMs, () => void continueWork($, text))
}

async function continueWork($: EngineInterface, text: string) {
  continuationTimer = undefined
  // A handoff begun during an API error's wait resumes the work itself.
  if (await isHandoffIdle($)) {
    const isEntered = await submit($, text, 'The continuation')
    if (isEntered) return
  }
  // A prompt that never entered starts no turn whose end would clear the flag, so it would hold back every later one.
  isContinuationOutstanding = false
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
  if (IS_ENDED[agent.status]) return false
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
    $.clock.after(AFTER_HOOK_RETURNS_MS, () => void handOff($))
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
  scheduleContinuation($, AFTER_HOOK_RETURNS_MS, CONTINUE_PROMPT)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Immediate, or a /mode present typed while away would wait for the end of a turn the away rules keep going.
    await $.command.register({ name: 'mode', description: 'How present you are: present, distracted or away', immediate: true })
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
    // A subagent's turn inside the continuation's own would otherwise unmark it, and send the rules owed to the main
    // conversation in the middle of a main turn.
    if (e.agentId !== undefined) return next(e)
    // Matched anywhere, since the engine opens a plugin's prompt with a line naming the plugin.
    continuationTurnId = e.text.includes(CONTINUE_MARK) ? e.turnId : undefined
    await sendOwedRules($)
    return next(e)
  })

  // A compaction inside a running turn raises no turn.start before the loop's next request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await bind($)
      // Here rather than at turn.start: a tool can move the root mid-turn, and a turn's first request comes here too.
      if ((await read($, mode)) === 'away') await followRoot($)
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
