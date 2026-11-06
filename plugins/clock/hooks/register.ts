import type { PromptOrigin, PromptSubmitInput, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { EpochMs } from '../types'

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const ATTACH_INTERVAL_MS = 15 * MINUTE_MS

const lastAttachedAt = atom({ plugin: 'clock', key: 'lastAttachedAt' } as const, null)
const lastUserMessageAt = atom({ plugin: 'clock', key: 'lastUserMessageAt' } as const, null)

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
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
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  return `Local time: ${weekday} ${day} ${time} (${utcOffset(date)}).`
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

// Local time: Wednesday 2026-11-04 14:32 (UTC+02:00). The user's previous message was 2 h 5 min ago.
function timeNote(now: EpochMs, userMessageAt: EpochMs | null): string {
  const time = localTime(now)
  if (userMessageAt === null) return time
  const elapsed = duration(now - userMessageAt)
  return `${time} The user's previous message was ${elapsed} ago.`
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
  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    const attachedAt: EpochMs | null = await read($, lastAttachedAt)
    const userMessageAt: EpochMs | null = await read($, lastUserMessageAt)
    const isDue = attachedAt === null || now - attachedAt >= ATTACH_INTERVAL_MS
    const note = isDue ? timeNote(now, userMessageAt) : undefined

    const result = await next(withNote(e, note))
    if (result.drop !== undefined) return result

    if (note !== undefined) await update($, lastAttachedAt, () => now)
    if (isUserMessage(e.origin)) await update($, lastUserMessageAt, () => now)
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
