import type { PromptOrigin, PromptSubmitInput, Register, SessionRateLimit, ToolSpec } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { EpochMs, WindowPeriods } from '../types'

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const ATTACH_INTERVAL_MS = 15 * MINUTE_MS
const ALERT_PERCENT = 90

const WINDOW_LABELS: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '1wk', spend_limit: 'spend' }

const PLAN_USAGE: ToolSpec = {
  name: 'plan_usage',
  description: "The account's plan usage now: each usage window's percent used and when it resets, in local time.",
}

const lastAttachedAt = atom({ plugin: 'session-context', key: 'lastAttachedAt' } as const, null)
const lastLineHadUsage = atom({ plugin: 'session-context', key: 'lastLineHadUsage' } as const, false)
const lastUserMessageAt = atom({ plugin: 'session-context', key: 'lastUserMessageAt' } as const, null)
const windowsPastAlert = atom({ plugin: 'session-context', key: 'windowsPastAlert' } as const, {})

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

// 14:32
function clockTime(date: Date): string {
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

// getTimezoneOffset counts minutes west of UTC, so UTC+02:00 is -120.
function utcOffset(date: Date): string {
  const eastMinutes = -date.getTimezoneOffset()
  const sign = eastMinutes < 0 ? '-' : '+'
  const magnitude = Math.abs(eastMinutes)
  const hours = twoDigits(Math.floor(magnitude / MINUTES_PER_HOUR))
  const minutes = twoDigits(magnitude % MINUTES_PER_HOUR)
  return `UTC${sign}${hours}:${minutes}`
}

// Local time: Wednesday 2026-11-04 14:32 (UTC+02:00).
function localTime(now: EpochMs): string {
  const date = new Date(now)
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  const day = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
  return `Local time: ${weekday} ${day} ${clockTime(date)} (${utcOffset(date)}).`
}

// 2 h 5 min, 40 min, or less than 1 min.
function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / MINUTE_MS)
  if (totalMinutes < 1) return 'less than 1 min'
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (hours === 0) return `${minutes} min`
  return `${hours} h ${minutes} min`
}

// 16:00 on today's local date, Mon 09:00 on any other.
function resetTime(resetsAt: string, now: EpochMs): string {
  const reset = new Date(resetsAt)
  const isToday = reset.toDateString() === new Date(now).toDateString()
  if (isToday) return clockTime(reset)
  const weekday = reset.toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${clockTime(reset)}`
}

// 5h 52% (resets 16:00), or 5h 52% from a window that gives no reset time.
function windowUsage(window: SessionRateLimit, now: EpochMs): string {
  const usage = `${WINDOW_LABELS[window.kind] ?? window.kind} ${window.percentUsed}%`
  if (window.resetsAt === undefined) return usage
  return `${usage} (resets ${resetTime(window.resetsAt, now)})`
}

// Plan usage: 5h 52% (resets 16:00), 1wk 31% (resets Mon 09:00).
function planUsage(windows: readonly SessionRateLimit[], now: EpochMs): string {
  const usages = windows.map(window => windowUsage(window, now))
  return `Plan usage: ${usages.join(', ')}.`
}

// Local time: Wednesday 2026-11-04 14:32 (UTC+02:00). The user's previous message was 2 h 5 min ago. Plan usage: 5h 52% (resets 16:00).
function timeNote(now: EpochMs, userMessageAt: EpochMs | null, windows: readonly SessionRateLimit[]): string {
  const parts = [localTime(now)]
  if (userMessageAt !== null) parts.push(`The user's previous message was ${duration(now - userMessageAt)} ago.`)
  if (windows.length > 0) parts.push(planUsage(windows, now))
  return parts.join(' ')
}

// Plan usage passed 90%: 5h 91% (resets 16:00).
function alertNote(windows: readonly SessionRateLimit[], now: EpochMs): string {
  const usages = windows.map(window => windowUsage(window, now))
  return `Plan usage passed ${ALERT_PERCENT}%: ${usages.join(', ')}.`
}

function isPastAlert(window: SessionRateLimit): boolean {
  return window.percentUsed >= ALERT_PERCENT
}

// A window's reset time names its period, so a later one is a new period that may cross 90% again. A window that
// gives none rearms only by falling back under 90%.
function periodsOf(windows: readonly SessionRateLimit[]): WindowPeriods {
  return Object.fromEntries(windows.map(window => [window.kind, window.resetsAt ?? null]))
}

function isAlertDue(window: SessionRateLimit, alerted: WindowPeriods): boolean {
  if (!isPastAlert(window)) return false
  return alerted[window.kind] !== (window.resetsAt ?? null)
}

// The tool's answer: the local time, then the usage, so a reset at 16:00 reads against today's date.
function usageReport(now: EpochMs, windows: readonly SessionRateLimit[]): string {
  if (windows.length === 0) {
    return 'No plan usage figures: they arrive with the first model response, and an account off a subscription has none.'
  }
  return `${localTime(now)} ${planUsage(windows, now)}`
}

// The figures arrive with the first model response, so a line sent before then is sent again once they exist.
function isTimeLineDue(attachedAt: EpochMs | null, now: EpochMs, isUsageOwed: boolean): boolean {
  if (attachedAt === null) return true
  if (now - attachedAt >= ATTACH_INTERVAL_MS) return true
  return isUsageOwed
}

// A prompt is the user's message when the person driving the session sent it from any client, or a plugin passed on
// their own words. With no default case, a kind the engine adds fails tsc here until it is sorted into one side.
function isUserMessage(origin: PromptOrigin): boolean {
  switch (origin.kind) {
    case 'composer':
    case 'bridge':
    case 'sdk':
    case 'slack-ping':
      return true
    case 'plugin':
      return origin.asUser === true
    case 'task-notification':
    case 'scheduled-trigger':
    case 'peer':
    case 'peer-send-message':
    case 'projects-relay':
    case 'channel':
    case 'coordinator':
    case 'observer':
    case 'observer-activity':
    case 'auto-continuation':
    case 'unclassified':
      return false
  }
}

function withNote(prompt: PromptSubmitInput, note: string | undefined): PromptSubmitInput {
  if (note === undefined) return prompt
  const context = [...(prompt.context ?? []), note]
  return { ...prompt, context }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register(PLAN_USAGE)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__session-context__plan_usage' }, async $ => {
    const now = await $.clock.now()
    const { rateLimits } = await $.session.usage()
    return { result: usageReport(now, rateLimits) }
  })

  // The time line shows every window's figure, so a window past 90% on its prompt needs no line of its own.
  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    const { rateLimits } = await $.session.usage()
    const attachedAt: EpochMs | null = await read($, lastAttachedAt)
    const hadUsage: boolean = await read($, lastLineHadUsage)
    const userMessageAt: EpochMs | null = await read($, lastUserMessageAt)
    const alerted: WindowPeriods = await read($, windowsPastAlert)
    const hasUsage = rateLimits.length > 0
    const isTimeDue = isTimeLineDue(attachedAt, now, hasUsage && !hadUsage)
    const alertsDue = rateLimits.filter(window => isAlertDue(window, alerted))
    let note: string | undefined
    if (isTimeDue) note = timeNote(now, userMessageAt, rateLimits)
    else if (alertsDue.length > 0) note = alertNote(alertsDue, now)

    const result = await next(withNote(e, note))
    if (result.drop !== undefined) return result

    if (isTimeDue) {
      await update($, lastAttachedAt, () => now)
      await update($, lastLineHadUsage, () => hasUsage)
    }
    if (isUserMessage(e.origin)) await update($, lastUserMessageAt, () => now)
    const pastAlert = rateLimits.filter(isPastAlert)
    await update($, windowsPastAlert, () => periodsOf(pastAlert))
    return result
  })

  // The summary may leave out the last note, so the next prompt carries the time again.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const isMainConversation = e.agentId === undefined
    const didCompact = result.skip === undefined && e.trigger !== 'precompute'
    if (isMainConversation && didCompact) await update($, lastAttachedAt, () => null)
    return result
  })
}
