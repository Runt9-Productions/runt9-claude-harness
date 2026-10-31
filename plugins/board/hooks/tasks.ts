import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { BoardActivity, BoardDecision, BoardItem, BoardOwnerTask, BoardTask, BoardTaskStatus } from '../types'
import { MAIN, agentLabel, isPresent, releaseAbandoned } from './activity'
import { editItems, hasNoItemText, missingLabels, progressText } from './checklist'
import { asOption } from './decisions'
import { OWNER_STATUS_TEXT, ownerTaskStatus } from './owner-tasks'
import { bind, nextId, retireIds, save } from './persistence'
import { MAX_NOTE_CHARS } from './tools'
import type { SetTaskInput } from './tools'

export const OPEN_ORDER: BoardTaskStatus[] = ['in_progress', 'blocked', 'pending']

// Declared again in each file that uses them, since the loader refuses an imported atom (register.tsx has the rule).
const decisions = atom({ plugin: 'board', key: 'decisions' } as const, [])
const tasks = atom({ plugin: 'board', key: 'tasks' } as const, [])
const ownerTasks = atom({ plugin: 'board', key: 'ownerTasks' } as const, [])
const activity = atom({ plugin: 'board', key: 'activity' } as const, [])

/** The holder as another agent reads it. */
function holderName(rows: readonly BoardActivity[], holderId: string): string {
  return agentLabel(rows, holderId) ?? 'the main session'
}

/** Who holds the task once it moves to `status`: in_progress claims it, blocked keeps the claim, the rest release it. */
function holderAfter(status: BoardTaskStatus, callerId: string, current: string | undefined): string | undefined {
  if (status === 'in_progress') return callerId
  if (status === 'blocked') return current
  return undefined
}

const NEW_TASK_REFUSAL = 'Nothing changed: a new task needs a title and a status.'

/** Applies one set_task call for the calling loop and returns what the model reads back. */
export async function setTask($: EngineInterface, callerId: string, input: SetTaskInput): Promise<string> {
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
export async function readBoard($: EngineInterface, callerId: string): Promise<string> {
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

export async function clearDone($: EngineInterface) {
  await bind($)
  const all: BoardTask[] = await read($, tasks)
  await retireIds($, 'T', all.filter(t => t.status === 'done').map(t => t.id))
  await update($, tasks, current => current.filter(t => t.status !== 'done'))
  await save($)
}
