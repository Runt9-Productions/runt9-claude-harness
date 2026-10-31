/** present: reading everything. distracted: on another monitor, glancing now and then. away: not at the computer. */
export type AttentionMode = 'present' | 'distracted' | 'away'

declare module 'claude-code' {
  interface PluginState {
    away: {
      mode: AttentionMode
      /** Whether the main loop's next turn or model request re-sends the mode's rules row, as after a compaction. */
      isRulesOwed: boolean
      /** Whether the owner has been away since the last return report, so switching to present asks for one. */
      isReportOwed: boolean
      /** Whether a fill at handoff's ceiling hands off: false from away's handoff until the fill drops below it. */
      isHandoffArmed: boolean
      /** The auto mode denials posted this session, each a JSON array of the loop, the tool and the category. */
      postedDenials: string[]
    }
  }
}
