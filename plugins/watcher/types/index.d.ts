/** When the judge looks: at a turn's end, or at a named event. */
export type Trigger = 'turn-end' | 'refusal' | 'teammate-idle' | 'compaction' | 'commit' | 'secret-match'

/** nudge: a hidden message to the agent judged. flag: a board decision for the owner. both: each of them. */
export type Audience = 'nudge' | 'flag' | 'both'

/** Which agents a check judges: the main session, its teammates, or all of them. */
export type AgentScope = 'main' | 'teammates' | 'all'

/** One part of what the judge is shown, as a check's `reads` names it. */
export type DigestPart = 'prompts' | 'replies' | 'calls' | 'results' | 'exits' | 'status' | 'shared' | 'notes' | 'plan'

/** A check file, after its frontmatter was checked. */
export type Check = {
  /** The file's name without `.md`. */
  name: string
  triggers: readonly Trigger[]
  audience: Audience
  agents: AgentScope
  reads: readonly DigestPart[]
  /** An alias such as `haiku`, or a full model id. */
  model: string
  /** The file's body: what the judge looks for, and what counts as raising it. */
  criteria: string
}

/** How a refused call was refused: a permission rule, a settings hook, an ask nobody granted, a plugin, or a tool's own check. */
export type RefusalKind = 'rule' | 'hook' | 'ask' | 'plugin' | 'check'

/** One thing an agent was told or did, as captured. `seq` orders an agent's items and never repeats. */
export type ActivityItem =
  | {
      kind: 'prompt'
      seq: number
      /** Who sent it, as the record names them: `person`, `lead` or `another agent`. */
      from: string
      text: string
    }
  | { kind: 'reply'; seq: number; text: string }
  | {
      kind: 'call'
      seq: number
      tool: string
      /** The tool's arguments as JSON. */
      input: string
      /** The result or error text the agent read. */
      result: string
      isError: boolean
      /** A shell command's exit code, when its error text gives one. */
      exitCode?: number
      refusal?: RefusalKind
      /** The file a file-editing tool changed, as the call named it. */
      edited?: string
    }

/** One agent's capture since the oldest item still kept. */
export type AgentActivity = {
  items: readonly ActivityItem[]
  nextSeq: number
  /** Per trigger, the `seq` of the first item its last judgment did not see. */
  judgedUpTo: Partial<Record<Trigger, number>>
  /** The plan files the agent has read, as the calls named them, latest last. */
  planFiles: readonly string[]
}

/** How sure the judge is of a verdict, least first. */
export type Confidence = 'low' | 'medium' | 'high'

/** A summary a check raised for an agent and was delivered, which later judgments of that check are shown. */
export type RaisedSummary = { check: string; summary: string }

/** What keeps one agent's findings quiet: what was raised before, and when each nudge and flag went out. */
export type AgentQuiet = {
  /** Oldest first, a bounded number per check. */
  raised: readonly RaisedSummary[]
  /** Epoch ms of each nudge in the last hour. */
  nudgedAt: readonly number[]
  /** Epoch ms of each flag in the last hour. */
  flaggedAt: readonly number[]
}

/** A flag posted to the board whose answer the watcher has not yet read. */
export type PostedFlag = {
  /** The board's id for it, `D<n>`. */
  decisionId: string
  check: string
  summary: string
  evidence: string
  /** Who "Send to the session" tells, as the owner reads it: `the main session`, or `the teammate "scout"`. */
  recipient: string
  /** The recipient's loop: the agent judged, or an idle teammate's lead; absent for the main session. */
  agentId?: string
  /** The teammate's name when the recipient is its lead. */
  teammate?: string
}

/** A finding a session's watcher delivered, as other sessions read it. */
export type SharedFinding = {
  check: string
  summary: string
  /** Who it was about: `the main session`, or `the teammate "scout"`. */
  subject: string
}

/**
 * What one session's watcher keeps in `$.store` under `session:<id>`, for other sessions on the machine to read and
 * for its own flags to outlive a restart.
 */
export type SessionEntry = {
  /** The repository's main working tree, absent outside a repository. */
  repository?: string
  /** The working tree the session runs in; a worktree's own, so it differs from `repository` there. */
  top?: string
  branch?: string
  /** One line on what the person asked the session to do, from its first judgment that read their prompts. */
  goal?: string
  /** The files its agents changed, relative to `top` when inside it, latest last. */
  files: readonly string[]
  /** Latest last. */
  findings: readonly SharedFinding[]
  /** The flags on the board whose answers have not been read yet. */
  flags: readonly PostedFlag[]
  /** Epoch ms of the last write. */
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    watcher: {
      /** Every check in force, by name, once precedence and disabling are applied. */
      checks: readonly Check[]
      /** Each agent's capture: `main` for the main session, else the agent's id. */
      activity: StateFamily<AgentActivity>
      /** Each judged agent's quiet record, keyed as `activity` is. */
      quiet: StateFamily<AgentQuiet>
      /** Whether the main loop is inside a turn, so "Send to the session" knows to start one. */
      isMainInTurn: boolean
    }
  }
}
