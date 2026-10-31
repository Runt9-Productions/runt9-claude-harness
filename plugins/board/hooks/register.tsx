import type { Register } from 'claude-code'

import {
  MAIN,
  countCall,
  fillOldActivityRows,
  isCommitResult,
  isMainOutsideTurn,
  refreshFromAgentList,
  resetChecklistCount,
  setActivity,
  setStatus,
  startNamedAgent,
} from './activity'
import { askDecision, endSendNowQueue, markSeen, openBoard, resetFlashAndHotkeys } from './decisions'
import { setOwnerTask } from './owner-tasks'
import { renderAbovePrompt, renderPane } from './pane'
import { bind, noteToolUseId, prune, save } from './persistence'
import { readBoard, setTask } from './tasks'
import { ASK_DECISION, READ_BOARD, SET_OWNER_TASK, SET_STATUS, SET_TASK } from './tools'
import type { AskDecisionInput, SetOwnerTaskInput, SetStatusInput, SetTaskInput } from './tools'

// Each file declares the atoms it reads or updates, with the same key and initial value. The loader refuses `read`
// or `update` on an atom imported from another file, and declarations with one key share one value at run time.
// Past an import it follows `$` only into a function declaration, so a function in another file that takes `$` is
// never an arrow function.

// The same id as PANE in decisions.ts, spelled again here: the loader reads a matcher's requestId from this file's
// source, and reads an imported constant as unknown.
const PANE = 'board'
const REFRESH_MS = 10_000

// Carried by the mod rather than CLAUDE.md, so removing the mod removes the instruction too.
const GUIDANCE = {
  id: 'board:guidance',
  scope: 'session',
  text:
    'The board mod is loaded. Post each decision whose answer changes what you do next with ' +
    'mcp__board__ask_decision (load it through ToolSearch), one call per decision even when several are pending, ' +
    'instead of asking it in a reply or with AskUserQuestion, since the board lets the owner add a note to an ' +
    'answer. A page your instructions ask for, such as a plan or a question page, still goes where they say. Then ' +
    'keep working on whatever does not depend on the answers. When you need the owner to do something rather than choose, such as ' +
    're-review PRs or try a change by hand, post it with mcp__board__set_owner_task. Track your own multi-step work ' +
    'with mcp__board__set_task, giving it a checklist of its phases to tick as you go, and keep a one-line ' +
    'status saying what you are doing with mcp__board__set_status. Call mcp__board__read_board after a ' +
    'compaction, and before taking up a task another agent may hold.',
} as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const tool of [ASK_DECISION, SET_OWNER_TASK, SET_TASK, SET_STATUS, READ_BOARD]) await $.tool.register(tool)
    await $.command.register({ name: 'board', description: 'Open the Board pane' })
    await bind($)
    await resetFlashAndHotkeys($)
    await fillOldActivityRows($)
    // Also captures a board built before a hot reload.
    await save($)
    await prune($)
    // Module timers stop on a reload and register runs again, so this never runs twice.
    $.clock.every(REFRESH_MS, () => void refreshFromAgentList($))
    return next(e)
  })

  // Activity is observed, never reported: it stays current however far into a session the model is.
  on('tool.call', async ($, e, next) => {
    // Another plugin's own call is not the model working, and a nudge on it reaches only that plugin.
    if (next.origin.plugin !== 'engine') return next(e)
    if (!e.agentId && e.tool_use_id) noteToolUseId(e.tool_use_id)
    if (e.tool.startsWith('mcp__board__')) return next(e)
    const agentId = e.agentId ?? MAIN
    // No turn.complete follows a call made outside a turn to set Claude idle again, so the main loop
    // counts as working only inside one.
    if (agentId === MAIN && (await isMainOutsideTurn($))) return next(e)
    await setActivity($, agentId, { state: 'working' })
    const result = await next(e)
    // A permission prompt that held this call is resolved once the call returns.
    await setActivity($, agentId, { state: 'working', permissionTool: undefined })
    const isCommit = e.tool === 'Bash' && !result.isError && isCommitResult(result.result)
    const nudge = await countCall($, agentId, isCommit)
    // The context reaches only the loop that made this call, so the nudge lands on that agent alone.
    if (!nudge || 'deny' in result) return result
    return { ...result, context: [...(result.context ?? []), nudge] }
  })

  // A named agent starts with the Agent call's short description as its status. Not $.agent.list()'s description:
  // for a teammate that is its whole prompt. The tool call, not agent.spawn, because it is the one known to fire
  // for a teammate.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const result = await next(e)
    if ('deny' in result || !e.name) return result
    await startNamedAgent($, e.name, e.description)
    return result
  })

  // Binding is right whichever loop the turn runs in. The main loop works from here rather than from its first request,
  // so Send now is not offered in between.
  on('turn.start', async ($, e, next) => {
    await bind($)
    if (e.agentId === undefined) await setActivity($, MAIN, { state: 'working' })
    return next(e)
  })

  // Fires per model request of every loop, so it means both "this loop is working" and "this request carries
  // whatever answer was already appended to this loop".
  on('turn.step', async function* ($, e, next) {
    await setActivity($, e.agentId ?? MAIN, { state: 'working' })
    await markSeen($, e.agentId)
    if (e.agentId === undefined) endSendNowQueue()
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setActivity($, e.agentId ?? MAIN, { state: 'idle' })
    // Records this turn's tool_use ids, which is what lets a moved conversation find this board.
    if (!e.agentId) await save($)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await setActivity($, e.agent_id ?? MAIN, { state: 'permission', permissionTool: e.tool_name })
    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await bind($)
    const opened = await openBoard($)
    return { text: opened.isPlaced ? 'Board opened.' : 'Board is waiting for room to open.' }
  })

  // The engine does not hold a call to its schema, and types written outside an interactive session carry none for
  // these tools, so each input is taken as its type unchecked.
  on('tool.call', { tool: 'mcp__board__ask_decision' }, async ($, e) => {
    const input = e as unknown as AskDecisionInput
    return { result: await askDecision($, e.agentId, input) }
  })

  on('tool.call', { tool: 'mcp__board__set_owner_task' }, async ($, e) => {
    const input = e as unknown as SetOwnerTaskInput
    return { result: await setOwnerTask($, e.agentId, input) }
  })

  on('tool.call', { tool: 'mcp__board__set_task' }, async ($, e) => {
    const input = e as unknown as SetTaskInput
    const callerId = e.agentId ?? MAIN
    await resetChecklistCount($, callerId)
    return { result: await setTask($, callerId, input) }
  })

  on('tool.call', { tool: 'mcp__board__read_board' }, async ($, e) => {
    return { result: await readBoard($, e.agentId ?? MAIN) }
  })

  on('tool.call', { tool: 'mcp__board__set_status' }, async ($, e) => {
    const input = e as unknown as SetStatusInput
    await setStatus($, e.agentId ?? MAIN, input.status.trim())
    return { result: 'Status set.' }
  })

  // Only where a surface draws: with none, nobody can answer, and the model would post to a pane nobody sees.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (e.surfaces.length === 0) return result
    return { sections: [...result.sections, GUIDANCE] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => renderPane($, e))

  // A one-line reminder above the prompt while anything waits, so an unanswered decision cannot scroll away.
  // The band holds one tree, so this draws alongside what the plugins beneath drew instead of over it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => renderAbovePrompt($, e, await next(e)))
}
