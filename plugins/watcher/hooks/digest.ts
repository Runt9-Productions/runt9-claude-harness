import type { ActivityItem, DigestPart, RefusalKind } from '../types'

/** A part of the record that comes from outside the agent's capture, such as the agent roster. */
export type RecordSection = { title: string; text: string }

/** `text` cut to `limit` characters, keeping its start and its end, where errors and totals tend to be. */
export function cut(text: string, limit: number): string {
  if (text.length <= limit) return text
  const half = Math.floor(limit / 2)
  const omitted = text.length - 2 * half
  return `${text.slice(0, half)} [${omitted} characters left out] ${text.slice(-half)}`
}

const REFUSALS: Record<RefusalKind, string> = {
  rule: 'refused by a permission rule',
  hook: 'refused by a settings hook',
  ask: 'refused at a permission ask',
  plugin: 'refused by a plugin',
  check: "refused by the tool's own check",
}

type Call = Extract<ActivityItem, { kind: 'call' }>

function outcome(call: Call): string {
  if (call.refusal !== undefined) return REFUSALS[call.refusal]
  if (call.exitCode !== undefined) return `exit ${call.exitCode}`
  return call.isError ? 'error' : 'ok'
}

function renderCall(call: Call, reads: ReadonlySet<DigestPart>): string {
  const shows = (part: DigestPart) => reads.has(part)
  const isOutcomeShown = shows('exits') || shows('results') || call.refusal !== undefined
  const label = isOutcomeShown ? `[call ${call.tool}, ${outcome(call)}]` : `[call ${call.tool}]`
  const head = shows('calls') ? `${label} ${call.input}` : label
  return shows('results') ? `${head}\n${call.result}` : head
}

const PART_SEPARATOR = '\n\n'

// What each item adds beyond its text: the blank line that joins it to the next.
const ITEM_SEPARATOR_CHARS = PART_SEPARATOR.length

// Room kept for the line saying how many items were left out.
const LEFT_OUT_MARK_CHARS = 80

// The outside sections together take at most this share of the record's cap, so the agent's own items keep the rest.
const OUTSIDE_SHARE = 0.5

const SECTION_CUT_MARK = ' [the rest left out to keep the record short]'

/** An item as the record shows it, and whether it is a prompt, which is kept over other items when cutting. */
type Rendered = { isPrompt: boolean; text: string }

function renderItem(item: ActivityItem, reads: ReadonlySet<DigestPart>): Rendered | undefined {
  if (item.kind === 'prompt') return reads.has('prompts') ? { isPrompt: true, text: `[prompt from ${item.from}]\n${item.text}` } : undefined
  if (item.kind === 'reply') return reads.has('replies') ? { isPrompt: false, text: `[reply]\n${item.text}` } : undefined
  const isCallRead = reads.has('calls') || reads.has('results') || reads.has('exits')
  return isCallRead ? { isPrompt: false, text: renderCall(item, reads) } : undefined
}

/** The item to drop next: the oldest that is not a prompt, else the oldest prompt but the latest; -1 when none is left. */
function nextToDrop(entries: readonly Rendered[]): number {
  const oldestOther = entries.findIndex(entry => !entry.isPrompt)
  if (oldestOther >= 0) return oldestOther
  const latestPrompt = entries.findLastIndex(entry => entry.isPrompt)
  return latestPrompt > 0 ? 0 : -1
}

/** The entries left once the oldest are dropped to fit `maxChars`, and how many were dropped. */
function fitted(entries: readonly Rendered[], maxChars: number): { kept: Rendered[]; dropped: number } {
  const kept = [...entries]
  let size = kept.reduce((total, entry) => total + entry.text.length + ITEM_SEPARATOR_CHARS, 0)
  while (size > maxChars) {
    const index = nextToDrop(kept)
    if (index < 0) break
    const [removed] = kept.splice(index, 1)
    size -= (removed?.text.length ?? 0) + ITEM_SEPARATOR_CHARS
  }
  return { kept, dropped: entries.length - kept.length }
}

const sizeOf = (texts: readonly string[]) => texts.reduce((total, text) => total + text.length + ITEM_SEPARATOR_CHARS, 0)

/**
 * Each item as the record shows it, leaving out the kinds `reads` does not name, and cut to `maxChars` with a line
 * saying how many older items were left out; empty when `reads` names none of the kinds present.
 */
function renderItems(items: readonly ActivityItem[], reads: ReadonlySet<DigestPart>, maxChars: number): string[] {
  const entries = items
    .map(item => renderItem(item, reads))
    .filter(entry => entry !== undefined)
  const isOver = sizeOf(entries.map(entry => entry.text)) > maxChars
  const { kept, dropped } = fitted(entries, isOver ? maxChars - LEFT_OUT_MARK_CHARS : maxChars)
  const texts = kept.map(entry => entry.text)
  return dropped === 0 ? texts : [`[${dropped} older items left out to keep the record short]`, ...texts]
}

/** Each section as the record shows it, in order, the ones past `budget` cut with a mark. */
function renderSections(sections: readonly RecordSection[], budget: number): string[] {
  const shown: string[] = []
  let left = budget
  for (const section of sections) {
    const text = `${section.title}:\n${section.text}`
    const room = Math.max(0, left - SECTION_CUT_MARK.length)
    const piece = text.length <= left ? text : `${text.slice(0, room)}${SECTION_CUT_MARK}`
    shown.push(piece)
    left = Math.max(0, left - piece.length - ITEM_SEPARATOR_CHARS)
  }
  return shown
}

/**
 * The record a judgment reads, within `maxChars`: who the agent is, its items, then the sections from outside its
 * capture, which together take at most half of it; undefined when `reads` shows none of the items. For a judgment
 * reading prompts, calls, exits and status:
 *
 *   Agent: the main session.
 *
 *   [prompt from person]
 *   Fix the failing parser test.
 *
 *   [call Bash, exit 1] {"command":"npm test"}
 *
 *   Agents:
 *   - scout (teammate): idle
 */
export function renderRecord(
  subject: string,
  items: readonly ActivityItem[],
  reads: ReadonlySet<DigestPart>,
  sections: readonly RecordSection[],
  maxChars: number,
): string | undefined {
  const outside = renderSections(sections, Math.floor(maxChars * OUTSIDE_SHARE))
  const room = maxChars - subject.length - sizeOf(outside)
  const shown = renderItems(items, reads, room)
  if (shown.length === 0) return undefined
  return [subject, ...shown, ...outside].join(PART_SEPARATOR)
}
