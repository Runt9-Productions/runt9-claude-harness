/** Milliseconds since the epoch, as `$.clock.now()` gives them. */
export type EpochMs = number

/**
 * The windows at or past 90% when the last prompt entered, by kind, each with the reset time that names its period,
 * or null for a window that gives none.
 */
export type WindowPeriods = Readonly<Record<string, string | null>>

declare module 'claude-code' {
  interface PluginState {
    'session-context': {
      /** When the time last reached the model beside a prompt; null before the first time. */
      lastAttachedAt: EpochMs | null
      /** Whether that line carried the plan's usage; false before the first. */
      lastLineHadUsage: boolean
      /** When the user's last message entered the session; null before the first. */
      lastUserMessageAt: EpochMs | null
      windowsPastAlert: WindowPeriods
    }
  }
}
