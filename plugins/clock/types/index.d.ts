/** Milliseconds since the epoch, as `$.clock.now()` gives them. */
export type EpochMs = number

declare module 'claude-code' {
  interface PluginState {
    clock: {
      /** When the time last reached the model beside a prompt; null before the first time. */
      lastAttachedAt: EpochMs | null
      /** When the user's last message entered the session; null before the first. */
      lastUserMessageAt: EpochMs | null
    }
  }
}
