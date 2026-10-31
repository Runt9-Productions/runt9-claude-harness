export type BoardOption = { label: string; description?: string }

/**
 * sending: the answer is being delivered to the asking loop. sent: delivered, no model request has carried it yet.
 * seen: a request of that loop has. failed: neither the append nor a message reached it, so no agent was told.
 */
export type BoardDelivery = 'sending' | 'sent' | 'seen' | 'failed'

export type BoardDecision = {
  id: string
  question: string
  context?: string
  options: BoardOption[]
  /** Index into options of the option the model recommends. */
  recommended?: number
  /** The loop that asked, which the answer is delivered to; absent when the main session asked. */
  agentId?: string
  /** The asking agent's name as the pane shows it; absent when the main session asked. */
  askedBy?: string
  answer?: string
  /** What the owner has typed in the note box so far; sent along with the option they press. */
  note?: string
  /** Absent until answered. */
  delivery?: BoardDelivery
}

export type BoardTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done'

export type BoardTask = {
  id: string
  title: string
  status: BoardTaskStatus
  /** What the title cannot carry, such as a blocker or the next step. */
  note?: string
  /** The loop that claimed it by setting it in_progress ('main' for the main session); absent when nobody holds it. */
  holderId?: string
  /** Ticked by agents through set_task, never from the pane. Absent when empty. */
  items?: BoardItem[]
}

/** One checklist item. A task's items are ticked by agents; a task for the owner's, only by the owner. */
export type BoardItem = { label: string; isTicked: boolean }

/** Something an agent needs the owner to do rather than choose. Only the owner ticks its items or completes it. */
export type BoardOwnerTask = {
  id: string
  title: string
  description?: string
  items: BoardItem[]
  /** Whether the owner pressed Start and has not pressed Unstart since. Any ticked item also counts the task started. */
  isStartPressed?: boolean
  isDone: boolean
  /** The loop that posted it, which every tick and the Done are delivered to; absent when the main session posted. */
  agentId?: string
  /** The posting agent's name as the pane shows it; absent when the main session posted. */
  postedBy?: string
  /** Absent until the owner first ticks an item or presses Done. */
  lastChange?: BoardOwnerChange
}

/** The owner's latest change to a task for the owner, and how far its message to the poster has got. */
export type BoardOwnerChange = {
  /** As the pane lists it until the poster has read it, such as `ticked "PR 12"` or `done`. */
  summary: string
  /** The message to the poster, kept so Retry sends the same text. */
  message: string
  delivery: BoardDelivery
}

/** One loop's current activity: the main session (agentId 'main') or a subagent or teammate. */
export type BoardActivity = {
  agentId: string
  label: string
  state: 'working' | 'idle' | 'permission'
  /** What the agent says it is doing, from set_status; a named agent starts with its Agent call's description. */
  status?: string
  /** Epoch ms the status was last set, or the row began if it never was. */
  statusAt: number
  callsSinceStatus: number
  /** Milliseconds spent working since the status was set, up to the start of the current state. */
  workedMsSinceStatus: number
  /** True once the agent was nudged about this status; set_status clears it. */
  isNudged: boolean
  /** Tool calls since the agent last called set_task or was last reminded of its unticked items. */
  callsSinceChecklist: number
  /** The tool a permission prompt is holding, while state is 'permission'. */
  permissionTool?: string
  /** Epoch ms the current state began. */
  since: number
}

declare module 'claude-code' {
  interface PluginState {
    board: {
      decisions: BoardDecision[]
      tasks: BoardTask[]
      ownerTasks: BoardOwnerTask[]
      /** The highest task number issued, so a dropped or cleared task's id is never reused. */
      lastTaskNumber: number
      /** The highest decision number issued, kept apart from tasks' so each prefix counts on its own. */
      lastDecisionNumber: number
      /** The highest task-for-the-owner number issued. */
      lastOwnerTaskNumber: number
      /** Whether the pane lists done tasks or only counts them. */
      isDoneShown: boolean
      /** The tasks and tasks for the owner whose details the owner has expanded on the pane. */
      expandedNotes: string[]
      activity: BoardActivity[]
      /** Epoch ms of the last clock tick; writing it redraws elapsed times. */
      now: number
      /** The newly posted decisions whose line is drawn inverted at this point of their flash. */
      litIds: string[]
    }
  }
}
