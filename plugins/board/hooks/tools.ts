import type { ToolSpec } from 'claude-code'

import type { BoardOption, BoardTaskStatus } from '../types'

// Each tool's input type sits beside its schema, and nothing checks that the two agree: change both together.

export const ASK_DECISION: ToolSpec = {
  name: 'ask_decision',
  description:
    'Post a decision for the owner to the Board pane instead of asking it in a reply. Returns at once with the ' +
    "decision's id; keep working on whatever does not depend on it. The answer arrives later as a message " +
    'starting "[board]"; an idle teammate receives it as a message from team-lead. Use for any question whose answer changes what you do next. Options are 2 to 4 short ' +
    'labels; put the recommended one first and set recommended to 0. Pass the id of a decision still waiting to ' +
    'reword it: what you omit is kept, and new options replace the old ones and their recommended. Pass the id ' +
    'with withdraw true to take back a question that no longer applies; the owner is told with a toast. Only the ' +
    'agent that posted a decision, or the main session, can reword or withdraw it, and a poster whose decision the ' +
    'main session changes is told with a "[board]" message.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Omit to post a new decision; pass the returned id to reword or withdraw it.' },
      question: { type: 'string', description: 'The decision, standing alone without session context.' },
      context: { type: 'string', description: 'One or two lines: what each option costs.' },
      options: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, description: { type: 'string' } },
          required: ['label'],
        },
      },
      recommended: { type: 'integer', minimum: 0 },
      withdraw: { type: 'boolean', description: 'With the id: remove the decision from the board unanswered.' },
    },
  },
}
export type AskDecisionInput = {
  id?: string
  question?: string
  context?: string
  options?: BoardOption[]
  recommended?: number
  withdraw?: boolean
}

export const MAX_NOTE_CHARS = 200

export type ItemRename = { from: string; to: string }

const ITEM_PROPERTIES = {
  items: { type: 'array', items: { type: 'string' }, description: 'Checklist items to add, each a short label.' },
  remove: { type: 'array', items: { type: 'string' }, description: 'Labels of items to take off the checklist.' },
  rename: {
    type: 'array',
    items: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
    description: 'Items to relabel, each keeping its tick.',
  },
}

export const SET_TASK: ToolSpec = {
  name: 'set_task',
  description:
    'Add or update a task on the Board pane so the owner can see progress at a glance. Omit id to add a task, ' +
    'with a title and a status; pass the returned id to update it, where anything omitted is kept. Setting ' +
    'in_progress claims the task for you, and is refused while another ' +
    'agent holds it; any other change is allowed to any agent, and done, pending or dropped releases it. Use blocked when it waits on an owner decision, and ' +
    'dropped (with the id) to remove a task that should not have been added or no longer applies. ' +
    'Give a checklist of items to track the phases of one piece of work on one task (build, tests, review, PR, merge), ' +
    'then tick each by its label as you finish it. An item already listed is not added again. One call applies ' +
    'items, remove, rename, then tick and untick, in that order, so it can add an item and tick it; a call naming a ' +
    'label not on the list changes nothing. The result and read_board say what is still unticked.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'blocked', 'done', 'dropped'] },
      note: {
        type: 'string',
        maxLength: MAX_NOTE_CHARS,
        description: 'What the title cannot carry: a blocker, where the work lives, the next step. Omit to keep the note; "" clears it.',
      },
      ...ITEM_PROPERTIES,
      tick: { type: 'array', items: { type: 'string' }, description: 'Labels of items to mark finished.' },
      untick: { type: 'array', items: { type: 'string' }, description: 'Labels of items to mark unfinished again.' },
    },
  },
}
export type SetTaskInput = {
  id?: string
  title?: string
  status?: BoardTaskStatus | 'dropped'
  note?: string
  items?: string[]
  remove?: string[]
  rename?: ItemRename[]
  tick?: string[]
  untick?: string[]
}

export const SET_STATUS: ToolSpec = {
  name: 'set_status',
  description:
    'Set your one-line status on the Board pane: what you are doing now, in plain words the owner can read at ' +
    'a glance, such as "tracing why the cache misses after a restart". Update it whenever your focus changes. Every ' +
    'agent sets its own, the lead included.',
  inputSchema: {
    type: 'object',
    properties: { status: { type: 'string' } },
    required: ['status'],
  },
}
export type SetStatusInput = { status: string }

export const SET_OWNER_TASK: ToolSpec = {
  name: 'set_owner_task',
  description:
    'Post a task for the owner to the Board pane: something you need them to do rather than choose, such as ' +
    're-reviewing PRs, writing a note only they can write, or trying a change by hand. Returns at once with its id; ' +
    'keep working on whatever does not depend on it. Give a checklist of items when the task has separable parts ' +
    '(one per PR, say). The owner ticks items and presses Start and Done on the pane, and each tick, untick, Start and the ' +
    'Done arrive later as a message starting "[board]" that lists what is still unticked, so you can act on each part ' +
    'as it is ticked; an idle teammate receives it as a message from team-lead. Pass the id to update it, where ' +
    'anything omitted is kept: a new title, a new description, more items (one already listed is not added again), ' +
    'or items removed or renamed, except one the owner has ticked. Pass the id with withdraw true to take back a ' +
    'task that no longer applies; the owner is told with a toast. Only the agent that posted a task, or the main ' +
    'session, can update or withdraw it, and a poster whose task the main session withdraws is told with a ' +
    '"[board]" message. Only the owner ' +
    'ticks items or completes it. For a choice between options use ask_decision, and for your own work set_task.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Omit to post a new task; pass the returned id to update or withdraw it.' },
      title: { type: 'string', description: 'What the owner is to do, standing alone without session context.' },
      description: {
        type: 'string',
        description: 'What the title cannot carry: where to look, what done means. Omit to keep it; "" clears it.',
      },
      ...ITEM_PROPERTIES,
      withdraw: { type: 'boolean', description: 'With the id: remove the task from the board before the owner finishes it.' },
    },
  },
}
export type SetOwnerTaskInput = {
  id?: string
  title?: string
  description?: string
  items?: string[]
  remove?: string[]
  rename?: ItemRename[]
  withdraw?: boolean
}

export const READ_BOARD: ToolSpec = {
  name: 'read_board',
  description:
    'List the open tasks, with who holds each and its note, and the decisions and tasks waiting on the owner. Call it to ' +
    'get back on track after a compaction, and before taking up a task other agents may hold.',
  inputSchema: { type: 'object', properties: {} },
}
