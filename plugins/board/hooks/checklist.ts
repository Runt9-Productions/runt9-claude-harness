import type { BoardItem } from '../types'
import type { ItemRename } from './tools'

/**
 * 2 of 3 ticked; not yet: PR 13.
 */
export function progressText(items: readonly BoardItem[]): string | undefined {
  if (items.length === 0) return undefined
  const unticked = items.filter(i => !i.isTicked).map(i => i.label)
  if (unticked.length === 0) return `All ${items.length} ticked.`
  const ticked = items.length - unticked.length
  return `${ticked} of ${items.length} ticked; not yet: ${unticked.join(', ')}.`
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
export function editItems(items: readonly BoardItem[], edits: ItemEdits, canChangeTicked: boolean): BoardItem[] | string {
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
export function hasNoItemText(labels: readonly string[]): string {
  const listed = labels.map(label => `"${label}"`).join(', ')
  return `has no item ${listed}. List it in items to add it.`
}

export function missingLabels(items: readonly BoardItem[], labels: readonly string[]): string[] {
  return labels.map(l => l.trim()).filter(label => !items.some(i => i.label === label))
}
