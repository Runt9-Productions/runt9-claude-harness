import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, Timer } from 'claude-code'

import type {
  BoardActivity,
  BoardDecision,
  BoardDelivery,
  BoardItem,
  BoardOwnerChange,
  BoardOption,
  BoardOwnerTask,
  BoardTask,
  BoardTaskStatus,
} from '../types'
import { ASK_DECISION, MAX_NOTE_CHARS, READ_BOARD, SET_OWNER_TASK, SET_STATUS, SET_TASK } from './tools'
import type { AskDecisionInput, ItemRename, SetOwnerTaskInput, SetStatusInput, SetTaskInput } from './tools'

// One file on purpose: the loader refuses a module that passes `$` to a function imported from another file, and
// nearly everything here takes `$`. Only the pure tool specs live in tools.ts.

const PANE = 'board'
const MAIN = 'main'
const TICK_MS = 10_000

const OPEN_ORDER: BoardTaskStatus[] = ['in_progress', 'blocked', 'pending']

const STATUS_MARK: Record<BoardTaskStatus, string> = { done: '✓', in_progress: '◐', blocked: '!', pending: '○' }

// Explicit per status: dim text is unreadable on a gray pane.
const STATUS_COLOR: Record<BoardTaskStatus, string | undefined> = {
  done: 'green',
  in_progress: 'cyan',
  blocked: 'yellow',
  pending: undefined,
}

// Carried by the mod rather than CLAUDE.md, so removing the mod removes the instruction too.
const GUIDANCE = {
  id: 'board:guidance',
  scope: 'session',
  text:
    'The board mod is loaded. Post a single decision whose answer changes what you do next with ' +
    'mcp__board__ask_decision (load it through ToolSearch) instead of asking it in a reply, then keep working ' +
    'on whatever does not depend on it. When you need the owner to do something rather than choose, such as ' +
    're-review PRs or try a change by hand, post it with mcp__board__set_owner_task. Track your own multi-step work ' +
    'with mcp__board__set_task, giving it a checklist of its phases to tick as you go, and keep a one-line ' +
    'status saying what you are doing with mcp__board__set_status. Call mcp__board__read_board after a ' +
    'compaction, and before taking up a task another agent may hold.',
} as const

const decisions = atom({ plugin: 'board', key: 'decisions' } as const, [])
const tasks = atom({ plugin: 'board', key: 'tasks' } as const, [])
const ownerTasks = atom({ plugin: 'board', key: 'ownerTasks' } as const, [])
const lastTaskNumber = atom({ plugin: 'board', key: 'lastTaskNumber' } as const, 0)
const lastDecisionNumber = atom({ plugin: 'board', key: 'lastDecisionNumber' } as const, 0)
const lastOwnerTaskNumber = atom({ plugin: 'board', key: 'lastOwnerTaskNumber' } as const, 0)
const isDoneShown = atom({ plugin: 'board', key: 'isDoneShown' } as const, false)
const expandedNotes = atom({ plugin: 'board', key: 'expandedNotes' } as const, [])
const activity = atom({ plugin: 'board', key: 'activity' } as const, [])
const now = atom({ plugin: 'board', key: 'now' } as const, 0)
const litIds = atom({ plugin: 'board', key: 'litIds' } as const, [])
const areHotkeysHeld = atom({ plugin: 'board', key: 'areHotkeysHeld' } as const, false)

async function openBoard($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Board' })
}

// ─── Persistence and session binding ─────────────────────────────────────────────────────────────────────

type SavedBoard = {
  decisions?: BoardDecision[]
  tasks?: BoardTask[]
  ownerTasks?: BoardOwnerTask[]
  lastTaskNumber?: number
  lastDecisionNumber?: number
  lastOwnerTaskNumber?: number
  savedAt?: number
  toolUseIds?: string[]
}

// Saved boards kept in the store, newest first; older sessions are pruned at start.
const KEPT_SESSIONS = 20
const KEPT_TOOL_USE_IDS = 20

// The model's recent tool_use ids. A conversation moved to a new session id (backgrounding it from the
// agents view does this; `--resume` does not) carries its rows over with their tool_use ids intact,
// so these are what tie the new id back to the board saved under the old one.
let recentToolUseIds: string[] = []
// The session id the board was last restored for. A /clear, a resume from inside a session and
// backgrounding all continue under a new id with no session.start, so save() binds before writing, and
// every handler that changes the board binds before reading it.
let boundSessionId: string | undefined

const sessionKey = async ($: EngineInterface) => `session:${await $.session.id()}`

const loadSaved = async ($: EngineInterface, key: string) => (await $.store.get(key)) as SavedBoard | undefined

function isEmpty(b: SavedBoard | undefined): boolean {
  if (!b) return true
  return [b.decisions, b.tasks, b.ownerTasks].every(list => (list ?? []).length === 0)
}

// Decisions and tasks outlive the process, keyed by session id. Activity is not saved: it is meaningless
// after a restart. An empty board is not kept, so short sessions do not push real boards out of the store.
async function save($: EngineInterface) {
  await bind($)
  const key = await sessionKey($)
  const board: SavedBoard = {
    decisions: await read($, decisions),
    tasks: await read($, tasks),
    ownerTasks: await read($, ownerTasks),
    lastTaskNumber: await read($, lastTaskNumber),
    lastDecisionNumber: await read($, lastDecisionNumber),
    lastOwnerTaskNumber: await read($, lastOwnerTaskNumber),
  }
  if (isEmpty(board)) {
    // A board emptied by drops or clears would otherwise come back from its last non-empty save.
    if ((await loadSaved($, key)) !== undefined) await $.store.delete(key)
    return
  }
  // Module variables reset on a hot reload, so keep the ids the last save already had.
  const previous = (await loadSaved($, key))?.toolUseIds ?? []
  const toolUseIds = [...new Set([...previous, ...recentToolUseIds])].slice(-KEPT_TOOL_USE_IDS)
  await $.store.set(key, { ...board, savedAt: await $.clock.now(), toolUseIds })
}

/** The newest board saved under another session id whose tool calls appear in this transcript. */
async function findMovedBoard($: EngineInterface, ownKey: string): Promise<SavedBoard | undefined> {
  const inTranscript = new Set<string>()
  for (const m of await $.session.messages()) {
    for (const use of m.toolUses) inTranscript.add(use.tool_use_id)
  }
  if (inTranscript.size === 0) return undefined
  let best: SavedBoard | undefined
  for (const key of (await $.store.keys()).filter(k => k.startsWith('session:') && k !== ownKey)) {
    const saved = await loadSaved($, key)
    if (isEmpty(saved) || !saved?.toolUseIds?.some(id => inTranscript.has(id))) continue
    if (!best || (saved.savedAt ?? 0) > (best.savedAt ?? 0)) best = saved
  }
  return best
}

/** Restores the board once per session id; a no-op while the id is unchanged. */
async function bind($: EngineInterface) {
  const id = await $.session.id()
  if (id === boundSessionId) return
  // Unset after a hot reload, when the state still belongs to this session. A change of id within one
  // process means another conversation, whose board is its own or one it carried over.
  if (boundSessionId !== undefined) {
    await update($, decisions, () => [])
    await update($, tasks, () => [])
    await update($, ownerTasks, () => [])
    await update($, lastTaskNumber, () => 0)
    await update($, lastDecisionNumber, () => 0)
    await update($, lastOwnerTaskNumber, () => 0)
    recentToolUseIds = []
  }
  boundSessionId = id
  await restore($)
}

/**
 * Runs a pane press only while the board is the one its frame was drawn from (`drawnFor`, the bound session then).
 * Ids start again at D1, T1 and O1 in every session, so after the id changes the same id names another
 * conversation's item.
 */
async function pressOnBoard($: EngineInterface, drawnFor: string | undefined, act: () => Promise<void>) {
  await bind($)
  if (boundSessionId !== drawnFor) return
  await act()
}

async function restore($: EngineInterface) {
  // A hot reload keeps state, and restoring over it would lose anything newer than the last save.
  const current: BoardDecision[] = await read($, decisions)
  const currentTasks: BoardTask[] = await read($, tasks)
  const currentOwnerTasks: BoardOwnerTask[] = await read($, ownerTasks)
  if (!isEmpty({ decisions: current, tasks: currentTasks, ownerTasks: currentOwnerTasks })) return

  const ownKey = await sessionKey($)
  const own = await loadSaved($, ownKey)
  const saved = isEmpty(own) ? await findMovedBoard($, ownKey) : own
  if (!saved || isEmpty(saved)) return
  await update($, decisions, () => saved.decisions ?? [])
  await update($, tasks, () => saved.tasks ?? [])
  await update($, ownerTasks, () => saved.ownerTasks ?? [])
  await update($, lastTaskNumber, () => saved.lastTaskNumber ?? 0)
  await update($, lastDecisionNumber, () => saved.lastDecisionNumber ?? 0)
  await update($, lastOwnerTaskNumber, () => saved.lastOwnerTaskNumber ?? 0)
  await save($)
}

async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(k => k.startsWith('session:'))
  if (keys.length <= KEPT_SESSIONS) return
  const dated = await Promise.all(keys.map(async k => ({ k, at: (await loadSaved($, k))?.savedAt ?? 0 })))
  dated.sort((a, b) => b.at - a.at)
  for (const { k } of dated.slice(KEPT_SESSIONS)) await $.store.delete(k)
}

// ─── Ids ─────────────────────────────────────────────────────────────────────────────────────────────────

type IdPrefix = 'T' | 'D' | 'O'

const idNumber = (id: string) => Number(id.slice(1)) || 0

/**
 * The next id with this prefix, from that prefix's own counter. Claude and the owner refer to items by id, so one
 * that was dropped or cleared is never reissued.
 */
async function nextId($: EngineInterface, prefix: IdPrefix): Promise<string> {
  const listedNumbers = (await listedIds($, prefix)).map(idNumber)
  let issued = 0
  await updateCounter($, prefix, last => {
    issued = Math.max(last, ...listedNumbers) + 1
    return issued
  })
  return `${prefix}${issued}`
}

/**
 * Call before removing items. A board saved without its counter knows its ids only from the lists, so removing the
 * highest one without this lets its number be issued again.
 */
async function retireIds($: EngineInterface, prefix: IdPrefix, ids: readonly string[]) {
  await updateCounter($, prefix, last => Math.max(last, ...ids.map(idNumber)))
}

// Spelled out per atom: the loader reads which state a module touches from the source, so it refuses an atom
// picked at run time, such as one looked up in a map by prefix.
async function updateCounter($: EngineInterface, prefix: IdPrefix, change: (last: number) => number) {
  if (prefix === 'T') await update($, lastTaskNumber, change)
  else if (prefix === 'D') await update($, lastDecisionNumber, change)
  else await update($, lastOwnerTaskNumber, change)
}

async function listedIds($: EngineInterface, prefix: IdPrefix): Promise<string[]> {
  if (prefix === 'T') return (await read($, tasks)).map(t => t.id)
  if (prefix === 'D') return (await read($, decisions)).map(d => d.id)
  return (await read($, ownerTasks)).map(t => t.id)
}

// ─── Activity and nudges ─────────────────────────────────────────────────────────────────────────────────

// A status this old, by tool calls or by working time, earns its agent one nudge. Starting points, expected to be tuned.
const STALE_CALLS = 20
const STALE_MS = 10 * 60_000
// An agent holding an in-progress task with unticked items is reminded of them this often, and after each commit.
const CHECKLIST_CALLS = STALE_CALLS

// Each named spawn's Agent call description, until $.agent.list() lists the loop that name runs as.
const pendingStarts = new Map<string, string>()

async function setActivity($: EngineInterface, agentId: string, patch: Partial<BoardActivity>) {
  const at = await $.clock.now()
  await update($, activity, all => {
    const existing = all.find(a => a.agentId === agentId)
    const base: BoardActivity = existing ?? {
      agentId,
      label: agentId === MAIN ? 'Claude' : agentId,
      state: 'working',
      statusAt: at,
      callsSinceStatus: 0,
      workedMsSinceStatus: 0,
      isNudged: false,
      callsSinceChecklist: 0,
      since: at,
    }
    const isNewState = patch.state !== undefined && patch.state !== base.state
    // Banked as a working stretch ends, so time idle or on a permission prompt is never counted.
    const workedMsSinceStatus = base.workedMsSinceStatus + (isNewState ? currentWorkMs(base, at) : 0)
    const next = { ...base, workedMsSinceStatus, ...patch, since: isNewState ? at : base.since }
    return existing ? all.map(a => (a.agentId === agentId ? next : a)) : [...all, next]
  })
}

/**
 * Starts each listed agent's row with its Agent call's description. Matched by name, not by the id the spawn
 * answered: for a teammate that id differs from the one its own calls carry, so a row keyed by it is never used.
 */
async function applyStarts($: EngineInterface, agents: readonly AgentInfo[]) {
  for (const [name, description] of pendingStarts) {
    const agent = agents.findLast(a => a.name === name)
    if (!agent) continue
    pendingStarts.delete(name)
    const rows: BoardActivity[] = await read($, activity)
    // A status the agent set itself is newer than its spawn's.
    const hasOwnStatus = rows.some(a => a.agentId === agent.id && a.status !== undefined)
    await setActivity($, agent.id, hasOwnStatus ? { label: name } : { label: name, status: description, state: 'working' })
  }
}

/** The current working stretch, from no earlier than the status was set; 0 while not working. */
function currentWorkMs(row: BoardActivity, at: number): number {
  return row.state === 'working' ? at - Math.max(row.since, row.statusAt) : 0
}

/**
 * Counts one tool call against the agent's status and its checklist, and returns the nudge the call earns, if any:
 * the stale-status nudge once per status, else a reminder of the unticked items it holds.
 */
async function countCall($: EngineInterface, agentId: string, isCommit: boolean): Promise<string | undefined> {
  await update($, activity, all =>
    all.map(a => (a.agentId === agentId ? { ...a, callsSinceStatus: a.callsSinceStatus + 1, callsSinceChecklist: a.callsSinceChecklist + 1 } : a)),
  )
  const rows: BoardActivity[] = await read($, activity)
  const row = rows.find(a => a.agentId === agentId)
  if (!row) return undefined
  // As with the guidance: with no surface, nobody sees the pane a nudge asks the agent to keep current.
  if ((await $.session.surfaces()).length === 0) return undefined
  const allTasks: BoardTask[] = await read($, tasks)
  const held = allTasks.filter(t => t.holderId === agentId)
  return (await staleStatusNudge($, row, held)) ?? (await checklistNudge($, row, held, isCommit))
}

/** Once per status, so an agent that ignores it is not nagged on every call after. */
async function staleStatusNudge($: EngineInterface, row: BoardActivity, held: readonly BoardTask[]): Promise<string | undefined> {
  if (row.isNudged) return undefined
  const at = await $.clock.now()
  // Working time, not wall time: an agent waiting on the owner or a teammate is not drifting from its status.
  const workedMs = row.workedMsSinceStatus + currentWorkMs(row, at)
  const isStale = row.callsSinceStatus >= STALE_CALLS || workedMs >= STALE_MS
  if (!isStale) return undefined
  // A subagent's prompt carries no guidance, so one that has not used the board is not told to load a tool it may
  // not have. Marked nudged all the same, so the agent list is read once per status rather than on every call.
  const hasUsedBoard = row.status !== undefined || held.length > 0
  if (!hasUsedBoard && !(await isToldOfBoard($, row.agentId))) {
    await setActivity($, row.agentId, { isNudged: true })
    return undefined
  }
  // It names the held tasks' unticked items too, so the checklist reminder starts its count again.
  await setActivity($, row.agentId, { isNudged: true, callsSinceChecklist: 0 })
  return nudgeText(row, at, held)
}

/** The main session and teammates: the loops whose prompts carry the guidance. */
async function isToldOfBoard($: EngineInterface, agentId: string): Promise<boolean> {
  if (agentId === MAIN) return true
  return (await $.agent.list()).some(a => a.id === agentId && a.teammateId !== undefined)
}

/** Every CHECKLIST_CALLS calls, and after a commit, while the agent holds an in-progress task with unticked items. */
async function checklistNudge($: EngineInterface, row: BoardActivity, held: readonly BoardTask[], isCommit: boolean): Promise<string | undefined> {
  const isDue = isCommit || row.callsSinceChecklist >= CHECKLIST_CALLS
  if (!isDue) return undefined
  const unfinished = held.filter(t => t.status === 'in_progress' && untickedLabels(t).length > 0)
  if (unfinished.length === 0) return undefined
  await setActivity($, row.agentId, { callsSinceChecklist: 0 })
  return checklistText(unfinished, isCommit)
}

/**
 * [board] Your board status "reading the parser" was set 12m ago, 23 tool calls back. If it no longer says what you
 * are doing, update it with mcp__board__set_status (load it through ToolSearch); otherwise carry on. You hold T3 "Fix
 * the parser" (not yet ticked: tests, PR): tick what you have finished, and if it is finished or no longer yours,
 * update it with mcp__board__set_task.
 */
function nudgeText(row: BoardActivity, at: number, held: readonly BoardTask[]): string {
  const how = 'with mcp__board__set_status (load it through ToolSearch)'
  const claims = held.length === 0 ? '' : ` ${claimsText(held)}`
  if (!row.status) return `[board] You have no board status yet. Set a one-line status saying what you are doing ${how}.${claims}`
  const age = `was set ${elapsed(row.statusAt, at)} ago, ${row.callsSinceStatus} tool calls back`
  return `[board] Your board status "${row.status}" ${age}. If it no longer says what you are doing, update it ${how}; otherwise carry on.${claims}`
}

function claimsText(held: readonly BoardTask[]): string {
  const listed = held.map(heldText).join(', ')
  const isAnyUnticked = held.some(t => untickedLabels(t).length > 0)
  const tick = isAnyUnticked ? 'tick what you have finished, and ' : ''
  const which = held.length === 1 ? 'it is' : 'any is'
  return `You hold ${listed}: ${tick}if ${which} finished or no longer yours, update it with mcp__board__set_task.`
}

/**
 * [board] You just committed. You hold T3 "Fix the parser" (not yet ticked: tests, PR). Tick each item you have
 * finished with mcp__board__set_task (load it through ToolSearch); otherwise carry on.
 */
function checklistText(unfinished: readonly BoardTask[], isCommit: boolean): string {
  const opening = isCommit ? 'You just committed. ' : ''
  const listed = unfinished.map(heldText).join(', ')
  return `[board] ${opening}You hold ${listed}. Tick each item you have finished with mcp__board__set_task (load it through ToolSearch); otherwise carry on.`
}

/** T3 "Fix the parser" (not yet ticked: tests, PR) */
function heldText(task: BoardTask): string {
  const unticked = untickedLabels(task)
  const named = `${task.id} "${task.title}"`
  return unticked.length === 0 ? named : `${named} (not yet ticked: ${unticked.join(', ')})`
}

function untickedLabels(task: BoardTask): string[] {
  return (task.items ?? []).filter(i => !i.isTicked).map(i => i.label)
}

/** Whether core read a commit made by this Bash call. */
function isCommitResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false
  const { gitOperation } = result as { gitOperation?: { commit?: unknown } }
  return gitOperation?.commit !== undefined
}

/** A set_task call is the agent tending its checklist, so the reminder starts its count again. */
async function resetChecklistCount($: EngineInterface, agentId: string) {
  await update($, activity, all => all.map(a => (a.agentId === agentId ? { ...a, callsSinceChecklist: 0 } : a)))
}

// Runs on the clock: names agents by their labels, drops the ones that have gone, and moves `now`,
// which redraws every elapsed time.
async function tick($: EngineInterface) {
  const agents = await $.agent.list()
  // A spawn not yet listed when its Agent call returned is started here instead.
  await applyStarts($, agents)
  await releaseAbandoned($, agents)
  const listed = new Map(agents.map(a => [a.id, a.name ?? a.description]))
  await update($, activity, all =>
    all
      .filter(a => a.agentId === MAIN || listed.has(a.agentId))
      .map(a => (a.agentId === MAIN ? a : { ...a, label: listed.get(a.agentId) ?? a.label })),
  )
  const at = await $.clock.now()
  await update($, now, () => at)
}

function elapsed(fromMs: number, toMs: number): string {
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

// ─── Decisions ───────────────────────────────────────────────────────────────────────────────────────────

/** The loop's name as the pane shows it; undefined for the main session. */
function agentLabel(rows: readonly BoardActivity[], agentId: string | undefined): string | undefined {
  if (agentId === undefined) return undefined
  return rows.find(a => a.agentId === agentId)?.label ?? agentId
}

/**
 * The engine does not hold a call to the input schema, so a caller that skipped loading it passes bare strings.
 * A Button with no label throws and takes the whole pane down, so decisions already saved that way are read through this too.
 */
function asOption(option: BoardOption | string): BoardOption {
  return typeof option === 'string' ? { label: option } : option
}

/**
 * What a decision's options lack, worded to follow "a decision", or undefined when they can be posted. Checked before
 * saving, since one option without a label is enough to take the pane down.
 *
 * needs a label on every option
 */
function optionsRefusal(options: readonly (BoardOption | string)[]): string | undefined {
  if (options.length < 2 || options.length > 4) return 'needs 2 to 4 options'
  const isEveryLabelled = options.map(asOption).every(o => typeof o.label === 'string' && o.label.trim() !== '')
  return isEveryLabelled ? undefined : 'needs a label on every option'
}

/** Posts, rewords or withdraws a decision for the calling loop; `agentId` is absent for the main session. */
async function askDecision($: EngineInterface, agentId: string | undefined, input: AskDecisionInput): Promise<string> {
  await bind($)
  if (input.withdraw) return withdrawDecision($, agentId, input.id)
  if (input.id !== undefined) return rewordDecision($, agentId, input.id, input)
  if (!input.question) return 'Nothing posted: a new decision needs a question.'
  const refusal = optionsRefusal(input.options ?? [])
  if (refusal !== undefined) return `Nothing posted: a new decision ${refusal}.`
  const id = await nextId($, 'D')
  const rows: BoardActivity[] = await read($, activity)
  const decision: BoardDecision = {
    id,
    question: input.question,
    context: input.context,
    options: (input.options ?? []).map(asOption),
    recommended: input.recommended,
    agentId,
    askedBy: agentLabel(rows, agentId),
  }
  await update($, decisions, all => [...all, decision])
  await save($)
  void openBoard($)
  await flash($, id)
  // The away plugin reads the decision id from the start of this result.
  return `Posted ${id}. The answer will arrive as a message starting "[board]"; do not wait for it.`
}

/**
 * Why the calling loop may not change an item, or undefined when it may: only the loop that posted it and the main
 * session can. A change is relayed to the poster as a user-role row, so without this any teammate could put words in
 * another loop's mouth.
 *
 * D3 was posted by worker; only worker or the main session can change it.
 */
function notPosterText(rows: readonly BoardActivity[], id: string, posterId: string | undefined, callerId: string | undefined): string | undefined {
  if (callerId === undefined || callerId === posterId) return undefined
  if (posterId === undefined) return `${id} was posted by the main session; only the main session can change it.`
  const poster = agentLabel(rows, posterId) ?? posterId
  return `${id} was posted by ${poster}; only ${poster} or the main session can change it.`
}

async function rewordDecision($: EngineInterface, agentId: string | undefined, id: string, input: AskDecisionInput): Promise<string> {
  const optionsProblem = input.options === undefined ? undefined : optionsRefusal(input.options)
  if (optionsProblem !== undefined) return `Nothing changed: a decision ${optionsProblem}.`
  const options = input.options?.map(asOption)
  const rows: BoardActivity[] = await read($, activity)
  // Decided inside the update, which retries on a conflicting write, so an answer pressed meanwhile is never reworded.
  let refusal: string | undefined
  let written: BoardDecision | undefined
  await update($, decisions, all => {
    refusal = undefined
    written = undefined
    const existing = all.find(d => d.id === id)
    if (existing === undefined) {
      refusal = `Nothing changed: there is no ${id}. Omit id to post a new decision.`
      return all
    }
    const notPoster = notPosterText(rows, id, existing.agentId, agentId)
    if (notPoster !== undefined) {
      refusal = `Nothing changed: ${notPoster}`
      return all
    }
    if (existing.answer !== undefined) {
      refusal = `Nothing changed: the owner already answered ${id}: ${existing.answer}`
      return all
    }
    const reworded: BoardDecision = {
      ...existing,
      question: input.question ?? existing.question,
      context: input.context === undefined ? existing.context : input.context || undefined,
      options: options ?? existing.options,
      // An index into the old options would point at whichever new option took its place.
      recommended: options === undefined ? (input.recommended ?? existing.recommended) : input.recommended,
    }
    written = reworded
    return all.map(d => (d.id === id ? reworded : d))
  })
  if (refusal !== undefined) return refusal
  await save($)
  void openBoard($)
  await flash($, id)
  const reworded = written
  if (reworded) {
    const labels = reworded.options.map(o => asOption(o).label).join(' / ')
    await tellPoster($, reworded.agentId, agentId, by => `[board] ${by} reworded ${id}, which you asked: "${reworded.question}" Options: ${labels}`)
  }
  return `Updated ${id}.`
}

/**
 * Tells the loop that posted an item that another loop withdrew or reworded it. Nothing retries a failure, so the
 * owner is told to relay it.
 *
 * [board] reviewer withdrew D3 ("Draft an issue?"), which you asked; no answer will come.
 */
async function tellPoster($: EngineInterface, posterId: string | undefined, callerId: string | undefined, text: (by: string) => string) {
  if (posterId === callerId) return
  const rows: BoardActivity[] = await read($, activity)
  const row = text(agentLabel(rows, callerId) ?? 'the main session')
  const failure = await deliver($, posterId, row)
  if (failure !== undefined) $.ui.toast(`Not delivered to ${agentLabel(rows, posterId) ?? 'Claude'} (${failure}); tell it yourself: ${row}`)
}

async function withdrawDecision($: EngineInterface, agentId: string | undefined, id: string | undefined): Promise<string> {
  if (id === undefined) return 'Nothing withdrawn: withdraw needs the id of the decision.'
  const listed: BoardDecision[] = await read($, decisions)
  const decision = listed.find(d => d.id === id)
  if (decision === undefined) return `Nothing withdrawn: there is no ${id}.`
  const notPoster = notPosterText(await read($, activity), id, decision.agentId, agentId)
  if (notPoster !== undefined) return `Nothing withdrawn: ${notPoster}`
  if (decision.answer !== undefined) return `Nothing withdrawn: the owner already answered ${id}: ${decision.answer}`
  await retireIds($, 'D', [id])
  // Checked again inside the update, so an answer pressed since the read is delivered rather than lost.
  let withdrawn: BoardDecision | undefined
  await update($, decisions, all => {
    withdrawn = all.find(d => d.id === id && d.answer === undefined)
    return all.filter(d => d !== withdrawn)
  })
  if (withdrawn === undefined) return `Nothing withdrawn: the owner answered ${id} meanwhile.`
  await holdHotkeys($)
  await save($)
  const rows: BoardActivity[] = await read($, activity)
  $.ui.toast(`${id} withdrawn by ${agentLabel(rows, agentId) ?? 'Claude'}: "${withdrawn.question}"`)
  const question = withdrawn.question
  await tellPoster($, withdrawn.agentId, agentId, by => `[board] ${by} withdrew ${id} ("${question}"), which you asked; no answer will come.`)
  return `Withdrew ${id}.`
}

// A new decision's line blinks this long, so a glance at a side monitor catches it. The away plugin relies on it as
// its only alert in distracted mode, so it is not cosmetic.
const FLASH_MS = 4_000
const FLASH_PERIOD_MS = 500
const LIT_STYLE = { color: 'black', backgroundColor: 'yellow' }

// When each flashing decision stops. Module state, like the timer, so a hot reload ends both together.
const flashEnds = new Map<string, number>()
let flashTimer: Timer | undefined

async function flash($: EngineInterface, id: string) {
  flashEnds.set(id, (await $.clock.now()) + FLASH_MS)
  await update($, litIds, ids => [...ids, id])
  flashTimer ??= $.clock.every(FLASH_PERIOD_MS, () => void blink($))
}

/** Lights every flashing decision's line, or puts all of them out, in turn; the last one out stops the timer. */
async function blink($: EngineInterface) {
  const at = await $.clock.now()
  for (const [id, end] of flashEnds) {
    if (at >= end) flashEnds.delete(id)
  }
  if (flashEnds.size === 0) {
    flashTimer?.cancel()
    flashTimer = undefined
  }
  await update($, litIds, ids => (ids.length > 0 ? [] : [...flashEnds.keys()]))
}

// Keys 1 to 4 answer whichever decision is first in the waiting list. When that one leaves, the next takes the keys
// only after this long, so a second press meant for the one answered cannot answer the next unread.
const HOTKEY_HOLD_MS = 1_500

let hotkeyTimer: Timer | undefined

async function holdHotkeys($: EngineInterface) {
  hotkeyTimer?.cancel()
  await update($, areHotkeysHeld, () => true)
  hotkeyTimer = $.clock.after(HOTKEY_HOLD_MS, () => void update($, areHotkeysHeld, () => false))
}

async function answer($: EngineInterface, id: string, text: string) {
  await bind($)
  // Claimed inside the update, which retries on a conflicting write, so two quick presses answer once.
  let claimed: BoardDecision | undefined
  await update($, decisions, all => {
    claimed = all.find(d => d.id === id && d.answer === undefined)
    return all.map(d => (d === claimed ? { ...d, answer: text, delivery: 'sending' as const } : d))
  })
  if (!claimed) return
  await holdHotkeys($)
  await save($)
  await sendAnswer($, claimed, text)
}

async function retry($: EngineInterface, id: string) {
  await bind($)
  // Claimed as in answer(), so two quick presses deliver once.
  let claimed: BoardDecision | undefined
  await update($, decisions, all => {
    claimed = all.find(d => d.id === id && d.delivery === 'failed')
    return all.map(d => (d === claimed ? { ...d, delivery: 'sending' as const } : d))
  })
  if (!claimed?.answer) return
  await save($)
  await sendAnswer($, claimed, claimed.answer)
}

/** The owner told the agent themselves: the decision leaves the board, and its id is never reissued. */
async function dismiss($: EngineInterface, id: string) {
  await bind($)
  await retireIds($, 'D', [id])
  await update($, decisions, all => all.filter(d => d.id !== id))
  await save($)
}

/** Delivers an answer already recorded on the board, records whether it arrived, and tells the owner. */
async function sendAnswer($: EngineInterface, decision: BoardDecision, text: string) {
  const asker = decision.askedBy ?? 'Claude'
  const failure = await deliver($, decision.agentId, `[board] The owner answered ${decision.id} ("${decision.question}"): ${text}`)
  await setDelivery($, decision.id, failure === undefined ? 'sent' : 'failed')
  await save($)
  if (failure === undefined) {
    $.ui.toast(`${decision.id} answered; ${asker} reads it at its next step${decision.agentId ? '' : ' or with your next prompt'}`)
  } else {
    // The pane shows it answered either way, so say plainly that no agent has been told.
    $.ui.toast(`${decision.id}: answer saved on the board but NOT delivered to ${asker} (${failure}); tell it yourself`)
  }
}

/**
 * Appends the row to the loop that asked or posted (`agentId` absent for the main session), where a running loop reads
 * it at its next step; resolves undefined when delivered, else why not. The main session, when idle, reads it with the
 * owner's next prompt. An agent that has ended is not reached, and its item is cleared with "Dismiss (I told it)".
 */
async function deliver($: EngineInterface, agentId: string | undefined, row: string): Promise<string | undefined> {
  let appendFailure: string | undefined
  try {
    const result = await $.session.append({
      agentId,
      message: { type: 'user', content: [{ type: 'text', text: row }] },
    })
    appendFailure = result.deny
  } catch (err) {
    appendFailure = String(err)
  }
  if (appendFailure === undefined || agentId === undefined) return appendFailure
  // A message would resume an agent that finished or was stopped, with its tools, so one is never sent there.
  if (!isPresent(await $.agent.list(), agentId)) return `${appendFailure}; it has ended`
  // A teammate idle between turns refuses the append, and only a message wakes it. Addressed to that loop
  // alone: the lead must not receive an answer it never asked for.
  try {
    const sent = await $.session.send({ to: { agentId }, text: row })
    return sent.isDelivered ? undefined : `${appendFailure}; message: ${sent.reason}`
  } catch (err) {
    return `${appendFailure}; message: ${String(err)}`
  }
}

async function setDelivery($: EngineInterface, id: string, delivery: BoardDelivery) {
  await update($, decisions, all => all.map(d => (d.id === id ? { ...d, delivery } : d)))
}

// The Input's text reaches only its own handlers, so the note is kept in state for the option buttons.
async function setNote($: EngineInterface, id: string, note: string) {
  await bind($)
  await update($, decisions, all => all.map(d => (d.id === id ? { ...d, note } : d)))
}

// An answer rather than a removal, so the asker is told and Retry covers a failed delivery.
const DISMISSED_ANSWER = 'Dismissed without choosing an option'

async function answerWithNote($: EngineInterface, id: string, label: string) {
  await bind($)
  const all: BoardDecision[] = await read($, decisions)
  const decision = all.find(d => d.id === id)
  // A press on a frame drawn before a reword can name an option the decision no longer offers.
  const isOffered = label === DISMISSED_ANSWER || (decision?.options.map(asOption).some(o => o.label === label) ?? false)
  if (!isOffered) return
  const note = decision?.note?.trim()
  await answer($, id, note ? `${label}. Note: ${note}` : label)
}

async function answerOther($: EngineInterface, id: string, text: string) {
  if (text.trim()) await answer($, id, `Other: ${text.trim()}`)
}

/** Marks every answer and owner's change sent to this loop as seen; called as one of its model requests goes out. */
async function markSeen($: EngineInterface, agentId: string | undefined) {
  // Set again on a retried update, which costs at most one save that changes nothing.
  let isChanged = false
  await update($, decisions, all =>
    all.map(d => {
      if (d.delivery !== 'sent' || d.agentId !== agentId) return d
      isChanged = true
      return { ...d, delivery: 'seen' as const }
    }),
  )
  await update($, ownerTasks, all =>
    all.map(t => {
      if (t.lastChange?.delivery !== 'sent' || t.agentId !== agentId) return t
      isChanged = true
      return { ...t, lastChange: { ...t.lastChange, delivery: 'seen' as const } }
    }),
  )
  if (isChanged) await save($)
}

// ─── Tasks for the owner ─────────────────────────────────────────────────────────────────────────────────

const NEW_OWNER_TASK_REFUSAL = 'Nothing posted: a new task for the owner needs a title.'

/** Posts a task for the owner, or updates one, for the calling loop; `agentId` is absent for the main session. */
async function setOwnerTask($: EngineInterface, agentId: string | undefined, input: SetOwnerTaskInput): Promise<string> {
  await bind($)
  if (input.withdraw) return withdrawOwnerTask($, agentId, input.id)
  // Checked before nextId, so a refused post does not use up an id.
  if (input.id === undefined && !input.title) return NEW_OWNER_TASK_REFUSAL
  const id = input.id ?? (await nextId($, 'O'))
  const rows: BoardActivity[] = await read($, activity)
  const description = input.description?.trim()
  let refusal: string | undefined
  let isPosted = false
  await update($, ownerTasks, all => {
    refusal = undefined
    const existing = all.find(t => t.id === id)
    if (input.id !== undefined && existing === undefined) {
      refusal = `Nothing changed: there is no ${id}. Omit id to post a new task for the owner.`
      return all
    }
    const notPoster = existing === undefined ? undefined : notPosterText(rows, id, existing.agentId, agentId)
    if (notPoster !== undefined) {
      refusal = `Nothing changed: ${notPoster}`
      return all
    }
    // Its items would never be drawn, and an addition the owner cannot see is lost.
    if (existing?.isDone) {
      refusal = `Nothing changed: the owner has marked ${id} done. Post a new task for anything left.`
      return all
    }
    const title = input.title ?? existing?.title
    if (title === undefined) {
      refusal = NEW_OWNER_TASK_REFUSAL
      return all
    }
    // Only the owner changes an item they ticked.
    const items = editItems(existing?.items ?? [], input, false)
    if (typeof items === 'string') {
      refusal = `Nothing changed: ${input.id ?? 'the new task'} ${items}`
      return all
    }
    isPosted = existing === undefined
    const task: BoardOwnerTask = {
      ...(existing ?? { id, isDone: false, agentId, postedBy: agentLabel(rows, agentId) }),
      title,
      description: description === undefined ? existing?.description : description || undefined,
      items,
    }
    return existing ? all.map(t => (t.id === id ? task : t)) : [...all, task]
  })
  if (refusal !== undefined) return refusal
  await save($)
  if (!isPosted) return `Updated ${id}.`
  void openBoard($)
  await flash($, id)
  return `Posted ${id}. Each tick, Start and the Done arrive as messages starting "[board]"; do not wait for them.`
}

/** Appends each label not already listed, so an agent resending its whole list adds only the new ones and keeps the ticks. */
function withNewItems(items: readonly BoardItem[], labels: readonly string[]): BoardItem[] {
  const result = [...items]
  for (const label of labels.map(l => l.trim())) {
    if (label === '' || result.some(i => i.label === label)) continue
    result.push({ label, isTicked: false })
  }
  return result
}

type ItemEdits = { items?: string[]; remove?: string[]; rename?: ItemRename[] }

/**
 * The checklist after a call's additions, removals and renames, in that order, or why the call changes nothing,
 * worded to follow the task's id:
 *
 * has no item "PR 12". List it in items to add it.
 */
function editItems(items: readonly BoardItem[], edits: ItemEdits, canChangeTicked: boolean): BoardItem[] | string {
  const added = withNewItems(items, edits.items ?? [])
  const removals = (edits.remove ?? []).map(l => l.trim())
  const unknownRemovals = missingLabels(added, removals)
  if (unknownRemovals.length > 0) return hasNoItemText(unknownRemovals)
  const kept = added.filter(i => !removals.includes(i.label))

  const requested: unknown[] = edits.rename ?? []
  if (!requested.every(isItemRename)) return 'needs a from and a to label for each rename.'
  const renames = requested.map(r => ({ from: r.from.trim(), to: r.to.trim() }))
  const unknownRenames = missingLabels(kept, renames.map(r => r.from))
  if (unknownRenames.length > 0) return hasNoItemText(unknownRenames)
  const fromLabels = renames.map(r => r.from)
  if (new Set(fromLabels).size < fromLabels.length) return 'cannot rename one item twice in one call.'

  const changed = [...removals, ...fromLabels]
  const locked = canChangeTicked ? undefined : items.find(i => i.isTicked && changed.includes(i.label))
  if (locked) return `has "${locked.label}" ticked, and only the owner changes an item they ticked.`
  const emptied = renames.find(r => r.to === '')
  if (emptied) return `cannot rename "${emptied.from}" to an empty label.`

  const renamed = kept.map(item => {
    const rename = renames.find(r => r.from === item.label)
    return rename ? { ...item, label: rename.to } : item
  })
  // Checked on the result rather than per rename, so a swap passes and two renames to one label do not.
  const clash = renamed.find((item, i) => renamed.findIndex(other => other.label === item.label) !== i)
  if (clash) return `would have two items "${clash.label}".`
  return renamed
}

// The engine does not hold a call to the input schema (see asOption), so an entry can arrive as a bare string.
function isItemRename(value: unknown): value is ItemRename {
  if (typeof value !== 'object' || value === null) return false
  const { from, to } = value as Record<string, unknown>
  return typeof from === 'string' && typeof to === 'string'
}

/** has no item "build", "deploy". List it in items to add it. */
function hasNoItemText(labels: readonly string[]): string {
  const listed = labels.map(label => `"${label}"`).join(', ')
  return `has no item ${listed}. List it in items to add it.`
}

async function withdrawOwnerTask($: EngineInterface, agentId: string | undefined, id: string | undefined): Promise<string> {
  if (id === undefined) return 'Nothing withdrawn: withdraw needs the id of the task for the owner.'
  const listed: BoardOwnerTask[] = await read($, ownerTasks)
  const task = listed.find(t => t.id === id)
  if (task === undefined) return `Nothing withdrawn: there is no ${id}.`
  const notPoster = notPosterText(await read($, activity), id, task.agentId, agentId)
  if (notPoster !== undefined) return `Nothing withdrawn: ${notPoster}`
  await retireIds($, 'O', [id])
  // Decided inside the update, so a Done pressed since the read is delivered rather than lost.
  let withdrawn: BoardOwnerTask | undefined
  await update($, ownerTasks, all => {
    withdrawn = all.find(t => t.id === id && !t.isDone)
    return all.filter(t => t !== withdrawn)
  })
  if (withdrawn === undefined) return `Nothing withdrawn: the owner has marked ${id} done.`
  await save($)
  const rows: BoardActivity[] = await read($, activity)
  $.ui.toast(`${id} withdrawn by ${agentLabel(rows, agentId) ?? 'Claude'}: "${withdrawn.title}"`)
  const title = withdrawn.title
  await tellPoster($, withdrawn.agentId, agentId, by => `[board] ${by} withdrew ${id} "${title}", which you posted for the owner; no tick or Done will come.`)
  return `Withdrew ${id}.`
}

type OwnerTaskStatus = Extract<BoardTaskStatus, 'pending' | 'in_progress' | 'done'>

const OWNER_STATUS_TEXT: Record<OwnerTaskStatus, string> = { pending: 'not started', in_progress: 'started', done: 'done' }

/** Drawn with the task list's marks and colors. */
function ownerTaskStatus(task: BoardOwnerTask): OwnerTaskStatus {
  if (task.isDone) return 'done'
  if (task.isStartPressed || task.items.some(i => i.isTicked)) return 'in_progress'
  return 'pending'
}

/**
 * 2 of 3 ticked; not yet: PR 13.
 */
function progressText(items: readonly BoardItem[]): string | undefined {
  if (items.length === 0) return undefined
  const unticked = items.filter(i => !i.isTicked).map(i => i.label)
  if (unticked.length === 0) return `All ${items.length} ticked.`
  const ticked = items.length - unticked.length
  return `${ticked} of ${items.length} ticked; not yet: ${unticked.join(', ')}.`
}

/**
 * Records the owner's change, with the message that tells the poster. Each message carries the whole checklist, so
 * a newer one makes up for an older one that was lost, and Retry sends only the latest.
 *
 * [board] The owner ticked "PR 12" on O1 "Re-review the PRs". 2 of 3 ticked; not yet: PR 13.
 */
function withChange(task: BoardOwnerTask, summary: string, sentence: string): BoardOwnerTask {
  const progress = progressText(task.items)
  const message = progress === undefined ? `[board] The owner ${sentence}.` : `[board] The owner ${sentence}. ${progress}`
  return { ...task, lastChange: { summary, message, delivery: 'sending' } }
}

// By label, not position: an agent removing an item shifts the positions under a press drawn before it.
async function toggleItem($: EngineInterface, id: string, label: string) {
  await bind($)
  let changed: BoardOwnerTask | undefined
  await update($, ownerTasks, all => {
    changed = undefined
    return all.map(t => {
      const item = t.items.find(it => it.label === label)
      if (t.id !== id || t.isDone || item === undefined) return t
      const isTicked = !item.isTicked
      const items = t.items.map(it => (it === item ? { ...it, isTicked } : it))
      const change = `${isTicked ? 'ticked' : 'unticked'} "${item.label}"`
      changed = withChange({ ...t, items }, change, `${change} on ${t.id} "${t.title}"`)
      return changed
    })
  })
  if (changed?.lastChange) await deliverOwnerChange($, changed, changed.lastChange)
}

/** Start tells the poster; Unstart does not, and drops a Start not yet delivered so Retry cannot send it. */
async function toggleStart($: EngineInterface, id: string) {
  await bind($)
  let isChanged = false
  let started: BoardOwnerTask | undefined
  await update($, ownerTasks, all => {
    isChanged = false
    started = undefined
    return all.map(t => {
      if (t.id !== id || t.isDone) return t
      isChanged = true
      if (t.isStartPressed) {
        const isStartUnsent = t.lastChange?.summary === 'started'
        const isUndelivered = t.lastChange?.delivery === 'failed' || t.lastChange?.delivery === 'sending'
        return { ...t, isStartPressed: false, lastChange: isStartUnsent && isUndelivered ? undefined : t.lastChange }
      }
      started = withChange({ ...t, isStartPressed: true }, 'started', `started ${t.id} "${t.title}"`)
      return started
    })
  })
  if (started?.lastChange) await deliverOwnerChange($, started, started.lastChange)
  else if (isChanged) await save($)
}

async function completeOwnerTask($: EngineInterface, id: string) {
  await bind($)
  // Claimed as in answer(), so two quick presses send Done once.
  let claimed: BoardOwnerTask | undefined
  await update($, ownerTasks, all => {
    claimed = undefined
    return all.map(t => {
      if (t.id !== id || t.isDone) return t
      claimed = withChange({ ...t, isDone: true }, 'done', `marked ${t.id} "${t.title}" done`)
      return claimed
    })
  })
  if (claimed?.lastChange) await deliverOwnerChange($, claimed, claimed.lastChange)
}

async function retryOwnerChange($: EngineInterface, id: string) {
  await bind($)
  // Claimed as in answer(), so two quick presses deliver once.
  let claimed: BoardOwnerTask | undefined
  await update($, ownerTasks, all => {
    claimed = undefined
    return all.map(t => {
      if (t.id !== id || t.lastChange?.delivery !== 'failed') return t
      claimed = { ...t, lastChange: { ...t.lastChange, delivery: 'sending' } }
      return claimed
    })
  })
  if (claimed?.lastChange) await deliverOwnerChange($, claimed, claimed.lastChange)
}

/** The owner told the poster themselves: the change leaves the unsent list, and an open task stays open. */
async function dismissOwnerChange($: EngineInterface, id: string) {
  await bind($)
  await update($, ownerTasks, all =>
    all.map(t => {
      if (t.id !== id || !t.lastChange) return t
      return { ...t, lastChange: { ...t.lastChange, delivery: 'seen' as const } }
    }),
  )
  await save($)
}

/** Delivers the change to the loop that posted the task, records whether it arrived, and tells the owner of a failure. */
async function deliverOwnerChange($: EngineInterface, task: BoardOwnerTask, change: BoardOwnerChange) {
  await save($)
  const failure = await deliver($, task.agentId, change.message)
  const delivery: BoardDelivery = failure === undefined ? 'sent' : 'failed'
  await update($, ownerTasks, all =>
    all.map(t => {
      if (t.id !== task.id || !t.lastChange) return t
      // A newer change has replaced this one, and records its own delivery.
      if (t.lastChange.message !== change.message) return t
      return { ...t, lastChange: { ...t.lastChange, delivery } }
    }),
  )
  await save($)
  const poster = task.postedBy ?? 'Claude'
  if (failure !== undefined) {
    $.ui.toast(`${task.id}: ${change.summary} saved on the board but NOT delivered to ${poster} (${failure}); tell it yourself`)
  } else if (task.isDone) {
    $.ui.toast(`${task.id} done; ${poster} reads it at its next step${task.agentId ? '' : ' or with your next prompt'}`)
  }
}

/** A description longer than one line of the pane collapses its entry. */
function isLongText(text: string | undefined, columns: number): boolean {
  if (text === undefined) return false
  return text.includes('\n') || text.length > columns
}

// ─── Tasks ───────────────────────────────────────────────────────────────────────────────────────────────

// Statuses $.agent.list() keeps listing a loop under once it has ended. A copy is in the away plugin; change both.
const ENDED_STATUSES = new Set(['completed', 'failed', 'killed'])

/** Whether the loop is still there to work what it holds. The main session always is. */
function isPresent(agents: readonly AgentInfo[], holderId: string): boolean {
  if (holderId === MAIN) return true
  return agents.some(a => a.id === holderId && !ENDED_STATUSES.has(a.status))
}

/** The holder as another agent reads it. */
function holderName(rows: readonly BoardActivity[], holderId: string): string {
  if (holderId === MAIN) return 'the main session'
  return rows.find(a => a.agentId === holderId)?.label ?? holderId
}

/** Releases every claim whose holder has ended or is no longer listed. */
async function releaseAbandoned($: EngineInterface, agents: readonly AgentInfo[]) {
  await bind($)
  let isChanged = false
  await update($, tasks, all => {
    isChanged = false
    return all.map(t => {
      if (t.holderId === undefined || isPresent(agents, t.holderId)) return t
      isChanged = true
      return { ...t, holderId: undefined }
    })
  })
  if (isChanged) await save($)
}

/** Who holds the task once it moves to `status`: in_progress claims it, blocked keeps the claim, the rest release it. */
function holderAfter(status: BoardTaskStatus, callerId: string, current: string | undefined): string | undefined {
  if (status === 'in_progress') return callerId
  if (status === 'blocked') return current
  return undefined
}

const NEW_TASK_REFUSAL = 'Nothing changed: a new task needs a title and a status.'

/** Applies one set_task call for the calling loop and returns what the model reads back. */
async function setTask($: EngineInterface, callerId: string, input: SetTaskInput): Promise<string> {
  await bind($)
  if (input.status === 'dropped') return dropTask($, input.id)
  // One line wherever it is read, so read_board's one line per task holds.
  const note = input.note?.replace(/\s+/g, ' ').trim()
  if (note !== undefined && note.length > MAX_NOTE_CHARS) {
    return `Nothing changed: the note is ${note.length} characters, over the ${MAX_NOTE_CHARS} cap.`
  }
  // Checked before nextId, so a refused add does not use up an id.
  const hasTitleAndStatus = Boolean(input.title) && input.status !== undefined
  if (input.id === undefined && !hasTitleAndStatus) return NEW_TASK_REFUSAL
  const id = input.id ?? (await nextId($, 'T'))
  const requestedStatus = input.status
  const agents = await $.agent.list()
  const rows: BoardActivity[] = await read($, activity)
  const tick = input.tick ?? []
  const untick = input.untick ?? []
  // Decided inside the update, which retries on a conflicting write, so two agents claiming at once cannot both win.
  let refusal: string | undefined
  let written: BoardTask | undefined
  await update($, tasks, all => {
    refusal = undefined
    written = undefined
    const existing = all.find(t => t.id === id)
    // Otherwise a stale id would bring back a dropped task under the id nextId promises never to reissue.
    if (input.id !== undefined && existing === undefined) {
      refusal = `Nothing changed: there is no ${id}. Omit id to add a task.`
      return all
    }
    const title = input.title ?? existing?.title
    const status = requestedStatus ?? existing?.status
    if (title === undefined || status === undefined) {
      refusal = NEW_TASK_REFUSAL
      return all
    }
    const holder = existing?.holderId
    const isHeldByOther = holder !== undefined && holder !== callerId && isPresent(agents, holder)
    if (requestedStatus === 'in_progress' && isHeldByOther) {
      refusal = `Task ${id} not changed: ${holderName(rows, holder)} holds it. Take another task, or ask the holder to release it.`
      return all
    }
    const subject = input.id ?? 'the new task'
    const edited = editItems(existing?.items ?? [], input, true)
    if (typeof edited === 'string') {
      refusal = `Nothing changed: ${subject} ${edited}`
      return all
    }
    const unknownLabels = missingLabels(edited, [...tick, ...untick])
    if (unknownLabels.length > 0) {
      refusal = `Nothing changed: ${subject} ${hasNoItemText(unknownLabels)}`
      return all
    }
    const items = withTicks(edited, tick, untick)
    const task: BoardTask = {
      id,
      title,
      status,
      note: note === undefined ? existing?.note : note || undefined,
      // A call that leaves the status alone, such as one only ticking, neither claims nor releases.
      holderId: requestedStatus === undefined ? holder : holderAfter(requestedStatus, callerId, holder),
      items: items.length > 0 ? items : undefined,
    }
    written = task
    return existing ? all.map(t => (t.id === id ? task : t)) : [...all, task]
  })
  if (refusal !== undefined) return refusal
  await save($)
  const progress = progressText(written?.items ?? [])
  const status = written?.status
  return progress === undefined ? `Task ${id} is ${status}.` : `Task ${id} is ${status}. ${progress}`
}

async function dropTask($: EngineInterface, id: string | undefined): Promise<string> {
  if (!id) return 'Nothing dropped: dropped needs the id of the task to remove.'
  const listed: BoardTask[] = await read($, tasks)
  if (!listed.some(t => t.id === id)) return `Nothing dropped: there is no ${id}.`
  await retireIds($, 'T', [id])
  await update($, tasks, all => all.filter(t => t.id !== id))
  await save($)
  return `Task ${id} dropped.`
}

function missingLabels(items: readonly BoardItem[], labels: readonly string[]): string[] {
  return labels.map(l => l.trim()).filter(label => !items.some(i => i.label === label))
}

function withTicks(items: readonly BoardItem[], tick: readonly string[], untick: readonly string[]): BoardItem[] {
  const ticked = new Set(tick.map(l => l.trim()))
  const unticked = new Set(untick.map(l => l.trim()))
  return items.map(item => {
    if (ticked.has(item.label)) return { ...item, isTicked: true }
    if (unticked.has(item.label)) return { ...item, isTicked: false }
    return item
  })
}

/**
 * Open tasks:
 * T3 [in_progress, held by you] Fix the parser · 1 of 3 ticked; not yet: tests, PR. · note: waits on D2
 * T4 [pending] Write the tests
 * Decisions waiting on the owner:
 * D2 (scout asks) Draft an issue? Options: Skip / Draft it
 * Tasks waiting on the owner:
 * O1 [started] (yours) Re-review the PRs · 1 of 2 ticked; not yet: PR 13.
 */
async function readBoard($: EngineInterface, callerId: string): Promise<string> {
  await releaseAbandoned($, await $.agent.list())
  const allTasks: BoardTask[] = await read($, tasks)
  const allDecisions: BoardDecision[] = await read($, decisions)
  const allOwnerTasks: BoardOwnerTask[] = await read($, ownerTasks)
  const rows: BoardActivity[] = await read($, activity)

  const taskLine = (t: BoardTask) => {
    const holder = t.holderId === undefined ? '' : `, held by ${t.holderId === callerId ? 'you' : holderName(rows, t.holderId)}`
    const progress = progressText(t.items ?? [])
    const progressPart = progress ? ` · ${progress}` : ''
    const note = t.note ? ` · note: ${t.note}` : ''
    return `${t.id} [${t.status}${holder}] ${t.title}${progressPart}${note}`
  }
  const decisionLine = (d: BoardDecision) => {
    const asker = d.askedBy ? ` (${d.askedBy} asks)` : ''
    const options = d.options.map(o => asOption(o).label).join(' / ')
    return `${d.id}${asker} ${d.question} Options: ${options}`
  }
  const posterText = (t: BoardOwnerTask) => {
    if ((t.agentId ?? MAIN) === callerId) return 'yours'
    if (t.agentId === undefined) return 'from the main session'
    return `from ${t.postedBy ?? t.agentId}`
  }
  const ownerTaskLine = (t: BoardOwnerTask) => {
    const progress = progressText(t.items)
    return `${t.id} [${OWNER_STATUS_TEXT[ownerTaskStatus(t)]}] (${posterText(t)}) ${t.title}${progress ? ` · ${progress}` : ''}`
  }

  const open = OPEN_ORDER.flatMap(status => allTasks.filter(t => t.status === status))
  const waiting = allDecisions.filter(d => d.answer === undefined)
  const taskLines = open.length === 0 ? ['No open tasks.'] : ['Open tasks:', ...open.map(taskLine)]
  const decisionLines = waiting.length === 0 ? ['No decisions waiting on the owner.'] : ['Decisions waiting on the owner:', ...waiting.map(decisionLine)]
  const openOwnerTasks = allOwnerTasks.filter(t => !t.isDone)
  const ownerTaskLines = openOwnerTasks.length === 0 ? [] : ['Tasks waiting on the owner:', ...openOwnerTasks.map(ownerTaskLine)]
  return [...taskLines, ...decisionLines, ...ownerTaskLines].join('\n')
}

async function toggleExpanded($: EngineInterface, id: string) {
  await update($, expandedNotes, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]))
}

async function clearDone($: EngineInterface) {
  await bind($)
  const all: BoardTask[] = await read($, tasks)
  await retireIds($, 'T', all.filter(t => t.status === 'done').map(t => t.id))
  await update($, tasks, current => current.filter(t => t.status !== 'done'))
  await save($)
}

// ─── Hooks ───────────────────────────────────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const tool of [ASK_DECISION, SET_OWNER_TASK, SET_TASK, SET_STATUS, READ_BOARD]) await $.tool.register(tool)
    await $.command.register({ name: 'board', description: 'Open the Board pane' })
    await bind($)
    // A reload stops the flash and hotkey timers, which would leave a lit line lit and the hotkeys held.
    await update($, litIds, () => [])
    await update($, areHotkeysHeld, () => false)
    // Rows kept across a hot reload may predate the current row shape: fill what they lack, keep their status.
    await update($, activity, all =>
      all.map(a => ({
        ...a,
        statusAt: a.statusAt ?? a.since,
        callsSinceStatus: a.callsSinceStatus ?? 0,
        workedMsSinceStatus: a.workedMsSinceStatus ?? 0,
        isNudged: a.isNudged ?? false,
        callsSinceChecklist: a.callsSinceChecklist ?? 0,
      })),
    )
    // Also captures a board built before a hot reload.
    await save($)
    await prune($)
    // Module timers stop on a reload and register runs again, so this never runs twice.
    $.clock.every(TICK_MS, () => void tick($))
    return next(e)
  })

  // Activity is observed, never reported: it stays current however far into a session the model is.
  on('tool.call', async ($, e, next) => {
    // Another plugin's own call is not the model working, and a nudge on it reaches only that plugin.
    if (next.origin.plugin !== 'engine') return next(e)
    if (!e.agentId && e.tool_use_id) {
      recentToolUseIds = [...recentToolUseIds, e.tool_use_id].slice(-KEPT_TOOL_USE_IDS)
    }
    if (e.tool.startsWith('mcp__board__')) return next(e)
    const agentId = e.agentId ?? MAIN
    // No turn.complete follows a call made outside a turn to set Claude idle again, so the main loop
    // counts as working only inside one.
    if (agentId === MAIN) {
      const rows: BoardActivity[] = await read($, activity)
      const main = rows.find(a => a.agentId === MAIN)
      if (!main || main.state === 'idle') return next(e)
    }
    await setActivity($, agentId, { state: 'working' })
    const result = await next(e)
    // A permission prompt that held this call is resolved once the call returns.
    await setActivity($, agentId, { state: 'working', permissionTool: undefined })
    const isCommit = e.tool === 'Bash' && !result.isError && isCommitResult(result.result)
    const nudge = await countCall($, agentId, isCommit)
    // The context reaches only the loop that made this call, so the nudge lands on that agent alone.
    if (!nudge || 'deny' in result) return result
    return { ...result, context: [...(result.context ?? []), nudge] }
  })

  // A named agent starts with the Agent call's short description as its status. Not $.agent.list()'s description:
  // for a teammate that is its whole prompt. The tool call, not agent.spawn, because it is the one known to fire
  // for a teammate.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const result = await next(e)
    if ('deny' in result || !e.name) return result
    pendingStarts.set(e.name, e.description)
    await applyStarts($, await $.agent.list())
    return result
  })

  // turn.start names no loop; binding is right whichever loop it was.
  on('turn.start', async ($, e, next) => {
    await bind($)
    return next(e)
  })

  // Fires per model request of every loop, so it means both "this loop is working" and "this request carries
  // whatever answer was already appended to this loop".
  on('turn.step', async function* ($, e, next) {
    await setActivity($, e.agentId ?? MAIN, { state: 'working' })
    await markSeen($, e.agentId)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setActivity($, e.agentId ?? MAIN, { state: 'idle' })
    // Records this turn's tool_use ids, which is what lets a moved conversation find this board.
    if (!e.agentId) await save($)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await setActivity($, e.agent_id ?? MAIN, { state: 'permission', permissionTool: e.tool_name })
    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await bind($)
    const opened = await openBoard($)
    return { text: opened.isPlaced ? 'Board opened.' : 'Board is waiting for room to open.' }
  })

  // The engine does not hold a call to its schema, and types written outside an interactive session carry none for
  // these tools, so each input is taken as its type unchecked.
  on('tool.call', { tool: 'mcp__board__ask_decision' }, async ($, e) => {
    const input = e as unknown as AskDecisionInput
    return { result: await askDecision($, e.agentId, input) }
  })

  on('tool.call', { tool: 'mcp__board__set_owner_task' }, async ($, e) => {
    const input = e as unknown as SetOwnerTaskInput
    return { result: await setOwnerTask($, e.agentId, input) }
  })

  on('tool.call', { tool: 'mcp__board__set_task' }, async ($, e) => {
    const input = e as unknown as SetTaskInput
    const callerId = e.agentId ?? MAIN
    await resetChecklistCount($, callerId)
    return { result: await setTask($, callerId, input) }
  })

  on('tool.call', { tool: 'mcp__board__read_board' }, async ($, e) => {
    return { result: await readBoard($, e.agentId ?? MAIN) }
  })

  on('tool.call', { tool: 'mcp__board__set_status' }, async ($, e) => {
    const input = e as unknown as SetStatusInput
    const status = input.status.trim()
    await setActivity($, e.agentId ?? MAIN, { status, statusAt: await $.clock.now(), callsSinceStatus: 0, workedMsSinceStatus: 0, isNudged: false })
    return { result: 'Status set.' }
  })

  // Only where a surface draws: with none, nobody can answer, and the model would post to a pane nobody sees.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (e.surfaces.length === 0) return result
    return { sections: [...result.sections, GUIDANCE] }
  })

  // ─── Rendering ─────────────────────────────────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // Mobile draws no Input yet, so there the note box is left out and only the option buttons answer.
    const Input = 'Input' in elements ? elements.Input : undefined
    const allDecisions: BoardDecision[] = await read($, decisions)
    const allTasks: BoardTask[] = await read($, tasks)
    const allOwnerTasks: BoardOwnerTask[] = await read($, ownerTasks)
    const waiting = allDecisions.filter(d => d.answer === undefined)
    const waitingOwnerTasks = allOwnerTasks.filter(t => !t.isDone)
    // An answer stays listed until a request of the loop that asked has carried it, or until the owner dismisses it.
    const unsent = allDecisions.filter(d => d.delivery !== undefined && d.delivery !== 'seen')
    const unsentOwnerTasks = allOwnerTasks.filter(t => t.lastChange !== undefined && t.lastChange.delivery !== 'seen')
    const loops: BoardActivity[] = await read($, activity)
    const at = (await read($, now)) || (await $.clock.now())
    const hasOpenWork = allTasks.some(t => t.status === 'in_progress' || t.status === 'pending')
    const openTasks = OPEN_ORDER.flatMap(status => allTasks.filter(t => t.status === status))
    const doneTasks = allTasks.filter(t => t.status === 'done')
    const isDoneListed: boolean = await read($, isDoneShown)
    const expanded: string[] = await read($, expandedNotes)
    const lit: string[] = await read($, litIds)
    const holderLabel = (holderId: string) => loops.find(a => a.agentId === holderId)?.label ?? (holderId === MAIN ? 'Claude' : holderId)
    const hotkeysHeld: boolean = await read($, areHotkeysHeld)
    const drawnFor = boundSessionId
    const onBoard = (act: () => Promise<void>) => () => void pressOnBoard($, drawnFor, act)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>ACTIVITY</Text>
        {loops.length === 0 && <Text>Nothing observed yet.</Text>}
        {loops.map(a => (
          <Box key={a.agentId} flexDirection="column">
            {/* One line per agent whatever the pane's width: a wrapped row moves everything below it. */}
            <Text
              wrap="truncate-end"
              color={a.state === 'permission' ? 'red' : a.state === 'working' ? 'cyan' : hasOpenWork ? 'yellow' : undefined}
              bold={a.state === 'permission'}
            >
              {a.state === 'permission' ? '!' : a.state === 'working' ? '●' : '○'} {a.label}{' '}
              {a.state === 'permission' ? `waiting on a permission prompt (${a.permissionTool ?? 'a tool'})` : a.state}{' '}
              {elapsed(a.since, at)}
              {a.status ? ` · ${a.status} (${elapsed(a.statusAt, at)} ago)` : ''}
            </Text>
          </Box>
        ))}
        <Text> </Text>

        <Text bold>WAITING ON YOU ({waiting.length + waitingOwnerTasks.length})</Text>
        {/* Each decision card already ends in a blank line; this gives the empty list the same gap. */}
        {waiting.length + waitingOwnerTasks.length === 0 && (
          <Box marginBottom={1}>
            <Text dimColor>Nothing waiting.</Text>
          </Box>
        )}
        {waiting.map((d, index) => (
          <Box key={d.id} flexDirection="column" marginBottom={1}>
            <Text bold {...(lit.includes(d.id) ? LIT_STYLE : {})}>
              {d.id} {d.askedBy ? `(${d.askedBy} asks) ` : ''}
              {d.question}
            </Text>
            {d.context && <Text italic>{d.context}</Text>}
            <Box flexDirection="row" flexWrap="wrap">
              {d.options.map(asOption).map((option, i) => (
                <Button
                  key={`${d.id}-option-${i}`}
                  label={i === d.recommended ? `${option.label} (recommended)` : option.label}
                  hotkey={index === 0 && !hotkeysHeld ? String(i + 1) : undefined}
                  variant={i === d.recommended ? 'primary' : undefined}
                  onPress={onBoard(() => answerWithNote($, d.id, option.label))}
                />
              ))}
              <Button key={`${d.id}-dismiss-question`} label="Dismiss" onPress={onBoard(() => answerWithNote($, d.id, DISMISSED_ANSWER))} />
            </Box>
            {Input && (
              // Input wraps to the pane's full width rather than its own box, so it must not sit inside the root's paddingX.
              <Box marginX={-1}>
                <Input
                  key={`${d.id}-other`}
                  placeholder="Note: goes with the option you press, or Enter sends it alone as Other"
                  submitLabel="send"
                  onInput={value => void pressOnBoard($, drawnFor, () => setNote($, d.id, value))}
                  onSubmit={value => void pressOnBoard($, drawnFor, () => answerOther($, d.id, value))}
                />
              </Box>
            )}
          </Box>
        ))}
        {waitingOwnerTasks.map(t => {
          // Less the pane's paddingX on both sides.
          const isCollapsible = t.items.length > 0 || isLongText(t.description, e.props.bodyColumns - 2)
          const isExpanded = !isCollapsible || expanded.includes(t.id)
          const ticked = t.items.filter(item => item.isTicked).length
          const status = ownerTaskStatus(t)
          return (
            <Box key={t.id} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" flexWrap="wrap">
                <Text bold color={STATUS_COLOR[status]} {...(lit.includes(t.id) ? LIT_STYLE : {})}>
                  {STATUS_MARK[status]} {t.id} {t.postedBy ? `(from ${t.postedBy}) ` : ''}
                  {t.title}
                  {t.items.length > 0 ? ` ${ticked}/${t.items.length}` : ''}{' '}
                </Text>
                {isCollapsible && (
                  <Button key={`${t.id}-expand`} label={isExpanded ? 'Collapse' : 'Expand'} onPress={() => void toggleExpanded($, t.id)} />
                )}
                {/* A ticked item keeps the task started, so Unstart would change nothing. */}
                {ticked === 0 && (
                  <Button key={`${t.id}-start`} label={t.isStartPressed ? 'Unstart' : 'Start'} onPress={onBoard(() => toggleStart($, t.id))} />
                )}
                <Button key={`${t.id}-done`} label="Done" onPress={onBoard(() => completeOwnerTask($, t.id))} />
              </Box>
              {isExpanded && t.description && <Text italic>{t.description}</Text>}
              {isExpanded &&
                t.items.map((item, i) => (
                  <Button
                    key={`${t.id}-item-${i}`}
                    plain
                    label={`${item.isTicked ? '[x]' : '[ ]'} ${item.label}`}
                    onPress={onBoard(() => toggleItem($, t.id, item.label))}
                  />
                ))}
            </Box>
          )
        })}

        <Text bold>TASKS</Text>
        {allTasks.length === 0 && <Text dimColor>No tasks.</Text>}
        {[...openTasks, ...(isDoneListed ? doneTasks : [])].map(t => {
          const items = t.items ?? []
          const isCollapsible = items.length > 0 || t.note !== undefined
          const isExpanded = isCollapsible && expanded.includes(t.id)
          const ticked = items.filter(item => item.isTicked).length
          return (
            <Box key={t.id} flexDirection="column">
              <Box flexDirection="row">
                <Text color={STATUS_COLOR[t.status]}>
                  {STATUS_MARK[t.status]} {t.id} {t.title}
                  {items.length > 0 ? ` ${ticked}/${items.length}` : ''}
                  {t.holderId === undefined ? '' : ` · ${holderLabel(t.holderId)}`}{' '}
                </Text>
                {isCollapsible && (
                  <Button key={`${t.id}-expand`} label={isExpanded ? 'Collapse' : 'Expand'} onPress={() => void toggleExpanded($, t.id)} />
                )}
              </Box>
              {isExpanded && t.note !== undefined && <Text key={`${t.id}-note-text`}>    {t.note}</Text>}
              {/* Text, not the owner task's Buttons: these are the agent's to tick. */}
              {isExpanded &&
                items.map((item, i) => (
                  <Text key={`${t.id}-item-${i}`}>{`    ${item.isTicked ? '[x]' : '[ ]'} ${item.label}`}</Text>
                ))}
            </Box>
          )
        })}
        {doneTasks.length > 0 && (
          <Box key="done" flexDirection="row">
            <Text color={STATUS_COLOR.done}>
              {STATUS_MARK.done} {doneTasks.length} done{' '}
            </Text>
            <Button
              key="done-toggle"
              label={isDoneListed ? 'Hide' : 'Show'}
              onPress={() => void update($, isDoneShown, shown => !shown)}
            />
            <Button key="done-clear" label="Clear" onPress={onBoard(() => clearDone($))} />
          </Box>
        )}

        {unsent.length + unsentOwnerTasks.length > 0 && (
          <Box key="unsent" flexDirection="column" marginTop={1}>
            <Text bold>ANSWERED, NOT YET SENT TO CLAUDE</Text>
            {unsent.map(d => (
              <Box key={d.id} flexDirection="row" flexWrap="wrap">
                <Text color={d.delivery === 'failed' ? 'red' : undefined}>
                  {d.id} → {d.answer}
                  {d.delivery === 'failed' ? ` (not delivered${d.askedBy ? ` to ${d.askedBy}` : ''}) ` : ''}
                </Text>
                {d.delivery === 'failed' && <Button key={`${d.id}-retry`} label="Retry" onPress={onBoard(() => retry($, d.id))} />}
                {d.delivery === 'failed' && (
                  <Button key={`${d.id}-dismiss`} label="Dismiss (I told it)" onPress={onBoard(() => dismiss($, d.id))} />
                )}
              </Box>
            ))}
            {unsentOwnerTasks.map(t => {
              const isFailed = t.lastChange?.delivery === 'failed'
              return (
                <Box key={t.id} flexDirection="row" flexWrap="wrap">
                  <Text color={isFailed ? 'red' : undefined}>
                    {t.id} → {t.lastChange?.summary}
                    {isFailed ? ` (not delivered${t.postedBy ? ` to ${t.postedBy}` : ''}) ` : ''}
                  </Text>
                  {isFailed && <Button key={`${t.id}-retry`} label="Retry" onPress={onBoard(() => retryOwnerChange($, t.id))} />}
                  {isFailed && (
                    <Button key={`${t.id}-dismiss`} label="Dismiss (I told it)" onPress={onBoard(() => dismissOwnerChange($, t.id))} />
                  )}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  // A one-line reminder above the prompt while anything waits, so an unanswered decision cannot scroll away.
  // The band holds one tree, so this draws alongside what the plugins beneath drew instead of over it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const allDecisions: BoardDecision[] = await read($, decisions)
    const allTasks: BoardTask[] = await read($, tasks)
    const allOwnerTasks: BoardOwnerTask[] = await read($, ownerTasks)
    const lit: string[] = await read($, litIds)
    const waitingDecisions = allDecisions.filter(d => d.answer === undefined)
    const waitingOwnerTasks = allOwnerTasks.filter(t => !t.isDone)
    const waiting = waitingDecisions.length
    const forYou = waitingOwnerTasks.length
    const running = allTasks.filter(t => t.status === 'in_progress').length
    if (e.props.hasSurvey || (waiting + forYou === 0 && running === 0)) return below
    const isLit = [...waitingDecisions, ...waitingOwnerTasks].some(item => lit.includes(item.id))
    const forYouText = forYou === 0 ? '' : ` · ${forYou} task${forYou === 1 ? '' : 's'} for you`

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box key="board">
          <Text {...(isLit ? LIT_STYLE : { color: waiting + forYou > 0 ? 'yellow' : undefined })}>
            Board: {waiting} decision{waiting === 1 ? '' : 's'} waiting{forYouText} · {running} in progress{' '}
          </Text>
          <Button key="open" label="Open board" onPress={() => void openBoard($)} />
        </Box>
        {below}
      </Box>
    )
  })
}
