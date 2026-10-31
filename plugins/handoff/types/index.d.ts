/**
 * idle: nothing under way. queued: the handoff prompt waits for the running turn to end. writing: its own turn
 * runs. compacting: the compaction is running, or waiting for a turn that started meanwhile to end.
 */
export type HandoffPhase = 'idle' | 'queued' | 'writing' | 'compacting'

declare module 'claude-code' {
  interface PluginState {
    handoff: {
      /** Written on every session.start and turn.start as well as on each change, so it is never unset. */
      phase: HandoffPhase
      /** The compaction message Claude passed to compact_with, until the compaction uses it. */
      message: string
      /** The id of the turn the handoff prompt started, while writing; '' otherwise. */
      turnId: string
      /** The id the current handoff's prompt carries, so its turn can be told from one quoting it; '' while idle. */
      nonce: string
      /** The context window's fill as a whole percentage, as of the last session start, turn end or compaction. */
      percent: number
      /**
       * Whether the away plugin started the current handoff, so nobody is there to confirm: it compacts without a
       * message, resumes the work without waiting, and tells Claude when it fails. False while no handoff runs.
       */
      isUnattended: boolean
      /** The fill, as a whole percentage, at which the away plugin hands off. Unset until a session.start or turn.start. */
      ceilingPercent: number
    }
  }
}
