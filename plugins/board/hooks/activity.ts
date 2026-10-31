import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface } from 'claude-code'

import type { BoardActivity, BoardTask } from '../types'
import { bind, save } from './persistence'

export const MAIN = 'main'

// Declared again in each file that uses them, since the loader refuses an imported atom (register.tsx has the rule).
const tasks =atom({ plugin: 'board', key: 'tasks' } as const, [])
const activity = atom({ plugin: 'board', key: 'activity' } as const, [])
const now = atom({ plugin: 'board', key: 'now' } as const, 0)

// A status this old, by tool calls or by working time, earns its agent one nudge. Starting points, expected to be tuned.
const STALE_CALLS = 20
const STALE_MS = 10 * 60_000
// An agent holding an in-progress task with unticked items is reminded of them this often, and after each commit.
const CHECKLIST_CALLS = STALE_CALLS

// Each named spawn's Agent call description, until $.agent.list() lists the loop that name runs as.
const pendingStarts = new Map<string, string>()

export async function setActivity($: EngineInterface, agentId: string, patch: Partial<BoardActivity>) {
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

/** The loop's name as the pane shows it; undefined for the main session, which each caller names in its own words. */
export function agentLabel(rows: readonly BoardActivity[], agentId: string | undefined): string | undefined {
  if (agentId === undefined || agentId === MAIN) return undefined
  return rows.find(a => a.agentId === agentId)?.label ?? agentId
}

/** A new status starts its staleness count again. */
export async function setStatus($: EngineInterface, agentId: string, status: string) {
  await setActivity($, agentId, { status, statusAt: await $.clock.now(), callsSinceStatus: 0, workedMsSinceStatus: 0, isNudged: false })
}

/** Rows kept across a hot reload may predate the current row shape: fill what they lack, keep their status. */
export async function fillOldActivityRows($: EngineInterface) {
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
}

/** Whether the main loop is outside a turn: no row yet, or idle since its last turn completed. */
export async function isMainOutsideTurn($: EngineInterface): Promise<boolean> {
  const rows: BoardActivity[] = await read($, activity)
  const main = rows.find(a => a.agentId === MAIN)
  return !main || main.state === 'idle'
}

export async function startNamedAgent($: EngineInterface, name: string, description: string) {
  pendingStarts.set(name, description)
  await applyStarts($, await $.agent.list())
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
export async function countCall($: EngineInterface, agentId: string, isCommit: boolean): Promise<string | undefined> {
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
export function isCommitResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false
  const { gitOperation } = result as { gitOperation?: { commit?: unknown } }
  return gitOperation?.commit !== undefined
}

/** A set_task call is the agent tending its checklist, so the reminder starts its count again. */
export async function resetChecklistCount($: EngineInterface, agentId: string) {
  await update($, activity, all => all.map(a => (a.agentId === agentId ? { ...a, callsSinceChecklist: 0 } : a)))
}

// Runs on the clock: names agents by their labels, drops the ones that have gone, and moves `now`,
// which redraws every elapsed time.
export async function refreshFromAgentList($: EngineInterface) {
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

export function elapsed(fromMs: number, toMs: number): string {
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

// ─── Releasing abandoned tasks ───────────────────────────────────────────────────────────────────────────

// Statuses $.agent.list() keeps listing a loop under once it has ended. A copy is in the away plugin; change both.
const ENDED_STATUSES = new Set(['completed', 'failed', 'killed'])

/** Whether the loop is still there to work what it holds. The main session always is. */
export function isPresent(agents: readonly AgentInfo[], holderId: string): boolean {
  if (holderId === MAIN) return true
  return agents.some(a => a.id === holderId && !ENDED_STATUSES.has(a.status))
}

/** Releases every claim whose holder has ended or is no longer listed. */
export async function releaseAbandoned($: EngineInterface, agents: readonly AgentInfo[]) {
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
