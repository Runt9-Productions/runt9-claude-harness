import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { BoardActivity, BoardDelivery, BoardOwnerChange, BoardOwnerTask, BoardTaskStatus } from '../types'
import { editItems, progressText } from './checklist'
import { agentLabel, deliver, flash, notPosterText, openBoard, tellPoster } from './decisions'
import { bind, nextId, retireIds, save } from './persistence'
import type { SetOwnerTaskInput } from './tools'

const ownerTasks = atom({ plugin: 'board', key: 'ownerTasks' } as const, [])
const activity = atom({ plugin: 'board', key: 'activity' } as const, [])

const NEW_OWNER_TASK_REFUSAL = 'Nothing posted: a new task for the owner needs a title.'

/** Posts a task for the owner, or updates one, for the calling loop; `agentId` is absent for the main session. */
export async function setOwnerTask($: EngineInterface, agentId: string | undefined, input: SetOwnerTaskInput): Promise<string> {
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

export const OWNER_STATUS_TEXT: Record<OwnerTaskStatus, string> = { pending: 'not started', in_progress: 'started', done: 'done' }

/** Drawn with the task list's marks and colors. */
export function ownerTaskStatus(task: BoardOwnerTask): OwnerTaskStatus {
  if (task.isDone) return 'done'
  if (task.isStartPressed || task.items.some(i => i.isTicked)) return 'in_progress'
  return 'pending'
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
export async function toggleItem($: EngineInterface, id: string, label: string) {
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
export async function toggleStart($: EngineInterface, id: string) {
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

export async function completeOwnerTask($: EngineInterface, id: string) {
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

export async function retryOwnerChange($: EngineInterface, id: string) {
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
export async function dismissOwnerChange($: EngineInterface, id: string) {
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
