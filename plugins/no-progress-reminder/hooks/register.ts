import type { Register } from 'claude-code'

// The engine can rename this attachment kind in any release, and a renamed kind makes the hook match nothing
// without an error. If the reminder comes back, find its current name in a transcript's attachment rows.
const PROGRESS_REMINDER = 'silent_turn_reminder'

export const register: Register = on => {
  on('prompt.attachment', { type: PROGRESS_REMINDER }, () => ({ text: null }))
}
