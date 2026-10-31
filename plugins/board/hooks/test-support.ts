import { mock } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { AgentInfo, On, RenderSurface } from 'claude-code'

// Type-aware oxlint holds about 5 GB for each file that calls `on`, and adds the files up, so the tests register
// their hooks only through the helpers in this file. One more such file can exhaust a CI runner.

export const ASK = {
  tool: 'mcp__board__ask_decision',
  question: 'Draft an issue on the tracker?',
  options: [{ label: 'Skip' }, { label: 'Draft it' }],
  recommended: 0,
}
export const SET_TASK = 'mcp__board__set_task'
export const SESSION_KEY = 'session:test-session'

// Bash's record as core answers a command that made a commit.
const COMMITTED = { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } }

type EngineOptions = {
  toasts?: string[]
  /** Collects the text of each prompt the mod submits. */
  submitted?: string[]
  /** What the store holds before the test's first call. */
  seed?: Record<string, unknown>
  /** tool_use ids the session's transcript holds, which tie it to a board saved under another id. */
  transcriptToolUseIds?: string[]
  /** Read on every clock.now and session.id, so a test can move either. */
  time?: { ms: number }
  /** Answers the clock in place of `time`, timers included. */
  clock?: MockClock
  session?: { id: string }
  /** What $.agent.list() answers. */
  agents?: AgentInfo[]
  /** Refuses the mod's own appends, as a loop that is not running does. Otherwise the kit stores them. */
  isAppendRefused?: boolean
  /** What $.session.surfaces() answers; empty as in `claude -p`. */
  surfaces?: string[]
}

/** The engine nouns the mod calls, answered in memory. Returns the store so a test can read it. */
export function engine(on: On, options: EngineOptions = {}): Map<string, unknown> {
  const { toasts = [], seed = {}, transcriptToolUseIds = [], time = { ms: 1_000 }, clock, session = { id: 'test-session' }, agents = [] } = options
  const { isAppendRefused = false, surfaces = ['terminal'] } = options
  if (isAppendRefused) on('session.append', { door: 'note' }, () => ({ deny: 'the loop is not running' }))
  const store = new Map<string, unknown>(Object.entries(seed))
  const toolUses = transcriptToolUseIds.map(id => ({ tool_use_id: id, tool: 'Bash', input: {} }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '', toolUses }] }) as never)
  on('session.id', () => ({ value: session.id }) as never)
  on('session.surfaces', () => ({ value: surfaces }) as never)
  if (!clock) on('clock.now', () => ({ value: time.ms }) as never)
  on('agent.list', () => ({ value: agents }) as never)
  // Any tool the mod does not answer itself, as core would run it.
  on('tool.call', ($, e) => {
    const isCommit = (e as { command?: string }).command?.startsWith('git commit') ?? false
    return { result: isCommit ? COMMITTED : 'ran' } as never
  })
  on('store.get', ($, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...store.keys()] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => {
    options.submitted?.push(e.text)
    return { text: e.text }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    // A response with no chunks: nothing streams before the result.
    yield* []
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  return store
}

export function mountPane<P extends RenderSurface = 'terminal'>($: Engine, surface: P = 'terminal' as P) {
  return $.ui.mount({ plugin: 'board', surface, component: 'Pane', requestId: 'board', props: { bodyColumns: 80 } as never })
}

/** The end of a loop's turn, after which it is idle; `agentId` absent for the main session. */
export async function complete($: Engine, agentId?: string) {
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId })
}

/** One model request of a loop, read to its end; `agentId` absent for the main session. */
export async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1, agentId })
  for await (const _chunk of stream) {
    // Drained only so the step completes.
  }
}

export const saved = (store: Map<string, unknown>, key = SESSION_KEY) => JSON.stringify(store.get(key))

// A teammate's own calls carry an id that differs from the `name@session` one its spawn answered.
export const SCOUT: AgentInfo = {
  id: 'ascout-1',
  teammateId: 'scout@team',
  name: 'scout',
  description: 'A long brief that should never reach the board',
  type: 'teammate',
  status: 'running',
}
export const SPAWN_SCOUT = { tool: 'Agent', description: 'Survey the parser', prompt: SCOUT.description, name: 'scout' }

export const READ_BOARD = { tool: 'mcp__board__read_board' }
export const WORKER: AgentInfo = { id: 'worker', teammateId: 'worker@team', name: 'worker', description: 'Worker', type: 'teammate', status: 'running' }
export const resultText = (result: unknown) => JSON.stringify(result)

export const PHASES = ['build', 'tests', 'PR']

export const OWNER_TASK = { tool: 'mcp__board__set_owner_task', title: 'Re-review the PRs', items: ['PR 11', 'PR 12', 'PR 13'] }

/**
 * Answers `session.send` as the engine does for an agent: delivered to any agent `agents` lists, one that has ended
 * by resuming it, and refused for one it does not list. Returns every message the mod tried to send, refused or not,
 * so a send that must never happen is seen even where nobody could receive it.
 */
export function captureSends(on: On, agents: readonly AgentInfo[] = []): { to: string; text: string }[] {
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: e.to, text: e.text })
    if (!agents.some(a => a.id === e.to || a.name === e.to)) return { isDelivered: false, reason: `no agent named ${e.to}` }
    return { isDelivered: true }
  })
  return sent
}

/** Holds the first `session.send` until the returned release runs, then refuses it; every later send is delivered. */
export function holdFirstSend(on: On): () => void {
  let releaseFirst = () => {}
  const firstHeld = new Promise<void>(resolve => (releaseFirst = resolve))
  let calls = 0
  on('session.send', async () => {
    calls += 1
    if (calls === 1) {
      await firstHeld
      return { isDelivered: false, reason: 'gone' }
    }
    return { isDelivered: true }
  })
  return releaseFirst
}

/** Answers every render that reaches beneath the board with an empty box, where the kit's bottom hook would throw. */
export function drawEmptyBeneath(on: On) {
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
}

/** Answers `prompt.compose` beneath the board with no sections, where the kit's bottom hook would throw. */
export function composeNothingBeneath(on: On) {
  on('prompt.compose', () => ({ sections: [] }) as never)
}

/** Another plugin whose `probe` command makes 20 tool calls of its own and answers with their results. */
export const PROBE_CALLER: Plugin = {
  name: 'caller',
  register(on) {
    on('command.run', { command: 'probe' }, async $ => {
      const results: unknown[] = []
      for (let i = 0; i < 20; i++) results.push(await $.tool.call({ tool: 'Read', file_path: 'notes.md' }))
      return { text: JSON.stringify(results) }
    })
  },
}

/** Reads back each row the mod appended, with the loop it went to (`undefined` for the main session). */
export function captureAppends(on: On): () => { to: string | undefined; text: string }[] {
  const session = mock.session(on)
  return () =>
    session
      .appended()
      .filter(row => row.door === 'note')
      .map(row => ({
        to: row.agentId,
        text: row.message.content.map(block => (block.type === 'text' ? block.text : '')).join(''),
      }))
}
