import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { BoardDecision, BoardOwnerTask, BoardTask } from '../types'

// Declared again in each file that uses them, since the loader refuses an imported atom (register.tsx has the rule).
const decisions = atom({ plugin: 'board', key: 'decisions' } as const, [])
const tasks = atom({ plugin: 'board', key: 'tasks' } as const, [])
const ownerTasks = atom({ plugin: 'board', key: 'ownerTasks' } as const, [])
const lastTaskNumber = atom({ plugin: 'board', key: 'lastTaskNumber' } as const, 0)
const lastDecisionNumber = atom({ plugin: 'board', key: 'lastDecisionNumber' } as const, 0)
const lastOwnerTaskNumber = atom({ plugin: 'board', key: 'lastOwnerTaskNumber' } as const, 0)

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

export function noteToolUseId(toolUseId: string) {
  recentToolUseIds = [...recentToolUseIds, toolUseId].slice(-KEPT_TOOL_USE_IDS)
}

export function boundSession(): string | undefined {
  return boundSessionId
}

async function sessionKey($: EngineInterface) {
  return `session:${await $.session.id()}`
}

async function loadSaved($: EngineInterface, key: string) {
  return (await $.store.get(key)) as SavedBoard | undefined
}

function isEmpty(b: SavedBoard | undefined): boolean {
  if (!b) return true
  return [b.decisions, b.tasks, b.ownerTasks].every(list => (list ?? []).length === 0)
}

// Decisions and tasks outlive the process, keyed by session id. Activity is not saved: it is meaningless
// after a restart. An empty board is not kept, so short sessions do not push real boards out of the store.
export async function save($: EngineInterface) {
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
export async function bind($: EngineInterface) {
  const id = await $.session.id()
  if (id === boundSessionId) return
  // Unset after a hot reload, when the state still belongs to this session. A change of id within one
  // process means another conversation, whose board is its own or one it carried over.
  if (boundSessionId !== undefined) {
    await writeBoard($, {})
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
export async function pressOnBoard($: EngineInterface, drawnFor: string | undefined, act: () => Promise<void>) {
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
  await writeBoard($, saved)
  await save($)
}

/** Replaces the board's state with `board`, a list or counter it lacks starting empty. */
async function writeBoard($: EngineInterface, board: SavedBoard) {
  await update($, decisions, () => board.decisions ?? [])
  await update($, tasks, () => board.tasks ?? [])
  await update($, ownerTasks, () => board.ownerTasks ?? [])
  await update($, lastTaskNumber, () => board.lastTaskNumber ?? 0)
  await update($, lastDecisionNumber, () => board.lastDecisionNumber ?? 0)
  await update($, lastOwnerTaskNumber, () => board.lastOwnerTaskNumber ?? 0)
}

export async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(k => k.startsWith('session:'))
  if (keys.length <= KEPT_SESSIONS) return
  const dated = await Promise.all(keys.map(async k => ({ k, at: (await loadSaved($, k))?.savedAt ?? 0 })))
  dated.sort((a, b) => b.at - a.at)
  for (const { k } of dated.slice(KEPT_SESSIONS)) await $.store.delete(k)
}

// ─── Ids ─────────────────────────────────────────────────────────────────────────────────────────────────

type IdPrefix = 'T' | 'D' | 'O'

function idNumber(id: string): number {
  return Number(id.slice(1)) || 0
}

/**
 * The next id with this prefix, from that prefix's own counter. Claude and the owner refer to items by id, so one
 * that was dropped or cleared is never reissued.
 */
export async function nextId($: EngineInterface, prefix: IdPrefix): Promise<string> {
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
export async function retireIds($: EngineInterface, prefix: IdPrefix, ids: readonly string[]) {
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
