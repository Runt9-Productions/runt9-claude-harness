import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { AgentInfo, CommandRunInput, On, PromptOrigin } from 'claude-code'

// Type-aware oxlint holds several GB for each test file that calls `on`, so every test of this plugin stays in this file.

const SESSION_KEY = 'session:test-session'

type PostedDecision = { question: string; context?: string; options: { label: string }[] }

type Away = {
  submitted: string[]
  toasts: string[]
  /** Every status line the mod set, '' for a cleared one. */
  statuses: string[]
  store: Map<string, unknown>
  clock: MockClock
  session: { id: string }
  /** The text of each row the mod appended to the conversation, oldest first. */
  appended: () => string[]
  /** What $.agent.list() answers. */
  agents: AgentInfo[]
  /** The context window's fill as $.session.usage() reports it. */
  usage: { percent: number }
  /** Each decision posted to the board, oldest first. */
  decisions: PostedDecision[]
  /** Set, the board refuses every post with this reason. */
  board: { failure?: string }
  /** Where each /handoff run came from. */
  handoffs: PromptOrigin[]
  /** The file system $.fs reads and writes, by absolute path. */
  files: Map<string, string>
  /** What $.session.root() answers. */
  root: string
}

const ROOT = '/work/repo'

const LOCAL_SETTINGS = `${ROOT}/.claude/settings.local.json`

const HOLD_KEY = `sandbox:${ROOT}`

/** The engine nouns the mod calls, answered in memory; `seed` is what the store holds before the test starts. */
function engine(on: On, seed: Record<string, unknown> = {}): Away {
  const session = mock.session(on)
  const away: Away = {
    submitted: [],
    toasts: [],
    statuses: [],
    store: new Map(Object.entries(seed)),
    clock: mock.clock(on),
    session: { id: 'test-session' },
    appended: () =>
      session
        .appended()
        .filter(row => row.door === 'note')
        .map(row => row.message.content.map(block => (block.type === 'text' ? block.text : '')).join('')),
    agents: [],
    usage: { percent: 10 },
    decisions: [],
    board: {},
    handoffs: [],
    files: new Map(),
    root: ROOT,
  }
  on('session.root', () => ({ value: away.root }) as never)
  on('fs.exists', ($, e) => ({ value: away.files.has((e as { path: string }).path) }) as never)
  on('fs.read', ($, e) => {
    const { path } = e as { path: string }
    const text = away.files.get(path)
    if (text === undefined) throw new Error(`ENOENT: ${path}`)
    return { value: text } as never
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as { path: string; text: string }
    away.files.set(path, text)
    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: away.agents }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000, percent: away.usage.percent } } }) as never)
  // As board answers: the decision's id first, then text meant for the loop that asked. A live session adds `text` to
  // a plugin's own call answered by a hook, and the kit does not, so it is given here.
  on('tool.call', { tool: 'mcp__board__ask_decision' }, ($, e) => {
    if (away.board.failure !== undefined) return { deny: away.board.failure }
    away.decisions.push(e as unknown as PostedDecision)
    const answer = `Posted D${away.decisions.length}. The answer will arrive as a message; do not wait for it.`
    return { result: answer, text: answer } as never
  })
  // Any other tool, as core would run it.
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('command.run', { command: 'handoff' }, ($, e) => {
    away.handoffs.push(e.origin)
    return { text: 'Handoff requested.' }
  })
  // The prompt waits on the owner, so no decision comes back.
  on('classic.PermissionRequest', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  on('session.id', () => ({ value: away.session.id }) as never)
  on('store.get', ($, e) => ({ value: away.store.get((e as { key: string }).key) }) as never)
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    away.store.set(key, value)
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    away.store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...away.store.keys()] }) as never)
  on('ui.status', ($, e) => {
    away.statuses.push((e as { text?: string }).text ?? '')
    return { value: undefined } as never
  })
  on('ui.toast', ($, e) => {
    away.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    away.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'the summary', toolUses: [] }] }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    yield* []
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  // What the other plugins draw in the band; away draws its line beneath it.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'the other band') as never
  })
  return away
}

const rulesSent = (away: Away, mode: string) => away.appended().filter(text => text.startsWith(`[mode: ${mode}]`)).length

const returnReports = (away: Away) => away.submitted.filter(text => text.startsWith('[return]')).length

// Promise<unknown> on purpose: with the dependencies' contracts laid beside this mod's types, type-aware oxlint cannot
// resolve claude-code's result types and fails every await of the command's promise.
const runCommand = ($: Engine, args: string): Promise<unknown> =>
  $.command.run({ command: 'mode', args, origin: { kind: 'composer' } } as CommandRunInput)

async function setMode($: Engine, away: Away, args: string): Promise<string> {
  const result = await runCommand($, args)
  // A prompt the mod submits waits for the command's hook to return, on a timer.
  await away.clock.advance(10)
  return (result as { text: string }).text
}

const mainTurnStart = ($: Engine) => $.turn.start({ text: 'go', turnId: 't1' })

/** One model request, read to its end; `agentId` makes it a teammate's. */
async function step($: Engine, index: number, agentId?: string) {
  for await (const _chunk of $.turn.step({ turnId: 't1', index, model: 'opus', messageCount: 1, agentId })) {
    // Drained only so the step completes.
  }
}

const compact = ($: Engine, agentId?: string) =>
  $.session.compact({ trigger: 'manual', agentId, messages: [{ role: 'user', text: 'the work so far', toolUses: [] }] })

test('/mode away shows in the status line, is kept for the session, and sends the away rules once', async ($, on) => {
  const away = engine(on)
  const savedAt = away.clock.now()
  expect(await setMode($, away, 'away')).toBe('Mode: away.')
  expect(away.statuses.at(-1)).toBe('away')
  expect(away.store.get(SESSION_KEY)).toEqual({ mode: 'away', savedAt, sandboxRoot: ROOT })
  expect(rulesSent(away, 'away')).toBe(1)

  expect(await setMode($, away, 'away')).toBe('Already away.')
  expect(rulesSent(away, 'away')).toBe(1)
})

test('/mode present clears the status line and the stored mode, and sends the present rules', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'distracted')
  await setMode($, away, 'present')
  expect(away.statuses.at(-1)).toBe('')
  expect(away.store.has(SESSION_KEY)).toBe(false)
  expect(rulesSent(away, 'present')).toBe(1)
})

test('an unknown mode is refused and changes nothing, and a bare /mode reports the mode', async ($, on) => {
  const away = engine(on)
  expect(await setMode($, away, 'asleep')).toContain('Unknown mode "asleep"')
  expect(away.store.size).toBe(0)
  expect(away.appended()).toEqual([])
  expect(await setMode($, away, '')).toContain('Mode: present.')
})

test('only the 20 most recently saved sessions keep a stored mode, and other keys are left alone', async ($, on) => {
  const old = Array.from({ length: 25 }, (_, i) => [`session:old-${i}`, { mode: 'away', savedAt: i }])
  const away = engine(on, { ...Object.fromEntries(old), 'other:key': true })
  await away.clock.set(1_000)
  await setMode($, away, 'away')
  expect([...away.store.keys()].filter(key => key.startsWith('session:')).length).toBe(20)
  expect(away.store.has(SESSION_KEY)).toBe(true)
  expect(away.store.has('session:old-5')).toBe(false)
  expect(away.store.has('session:old-6')).toBe(true)
  expect(away.store.has('other:key')).toBe(true)
})

test('rules the session refuses to append are toasted, so the owner can pass them on', async ($, on) => {
  on('session.append', { door: 'note' }, () => ({ deny: 'no running loop' }))
  const away = engine(on)
  await setMode($, away, 'away')
  expect(rulesSent(away, 'away')).toBe(0)
  expect(away.toasts).toContain('The away rules did not reach Claude (no running loop); tell it yourself')
})

test('switching from away to present asks for the return report from the board; from distracted it does not', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'distracted')
  await setMode($, away, 'present')
  expect(returnReports(away)).toBe(0)

  await setMode($, away, 'away')
  await setMode($, away, 'present')
  expect(returnReports(away)).toBe(1)
  expect(away.submitted[0]).toContain('mcp__board__read_board')
  expect(away.submitted[0]).toContain('the decisions and the tasks for the owner')
})

test('coming back from away by way of distracted still asks for the return report, once', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await setMode($, away, 'distracted')
  await setMode($, away, 'present')
  expect(returnReports(away)).toBe(1)

  await setMode($, away, 'distracted')
  await setMode($, away, 'present')
  expect(returnReports(away)).toBe(1)
})

test('a mode stored for the session is restored with a toast, and a return from it still reports', async ($, on) => {
  const away = engine(on, { [SESSION_KEY]: { mode: 'away', savedAt: 1 } })
  await mainTurnStart($)
  expect(away.statuses.at(-1)).toBe('away')
  expect(away.toasts).toContain('Restored away mode')

  await setMode($, away, 'present')
  expect(returnReports(away)).toBe(1)
})

test('a conversation moved to a new session id keeps its mode and is sent the rules again', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  away.session.id = 'moved-session'
  await mainTurnStart($)
  expect(away.store.get('session:moved-session')).toMatchObject({ mode: 'away' })
  expect(rulesSent(away, 'away')).toBe(2)
  expect(away.toasts.filter(toast => toast.startsWith('Restored'))).toEqual([])
})

test('after a compaction, the next turn is sent the rules again once, except in present', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await compact($)
  await mainTurnStart($)
  expect(rulesSent(away, 'away')).toBe(2)
  await mainTurnStart($)
  expect(rulesSent(away, 'away')).toBe(2)

  await setMode($, away, 'present')
  await compact($)
  await mainTurnStart($)
  expect(rulesSent(away, 'present')).toBe(1)
})

test("a compaction inside a turn is answered at the main loop's next request, never at a teammate's", async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'distracted')
  await compact($, 'worker-1')
  await step($, 0)
  expect(rulesSent(away, 'distracted')).toBe(1)

  await compact($)
  await step($, 1, 'worker-1')
  expect(rulesSent(away, 'distracted')).toBe(1)
  await step($, 2)
  expect(rulesSent(away, 'distracted')).toBe(2)
})

/** The band above the prompt. */
const mountBand = ($: Engine, hasSurvey = false) =>
  $.ui.mount({
    plugin: 'away',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 80 },
  } as never)

test("the band shows the mode beneath the other plugins' lines, with a button for each other mode", async ($, on) => {
  const away = engine(on)
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: 'the other band' })).toBeDefined()
  expect((await band.find({ type: 'Text', text: /Mode:/ }))?.text).toContain('Mode: present')
  expect(await band.find({ key: 'mode-present' })).toBeUndefined()
  await band.press({ key: 'mode-away' })
  expect(away.statuses.at(-1)).toBe('away')
  expect(await band.find({ key: 'mode-present' })).toBeDefined()
})

test('the band draws nothing of its own while a survey is up', async ($, on) => {
  engine(on)
  const band = await mountBand($, true)
  expect(await band.find({ type: 'Text', text: 'the other band' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Mode:/ })).toBeUndefined()
})

const continuations = (away: Away) => away.submitted.filter(text => text.includes('[away: continue]')).length

/** A prompt the mod submitted, as the engine starts its turn: opened by a line naming the plugin. */
const asDelivered = (prompt: string) => `The away plugin sent a message:\n${prompt}`

type TurnEnd = 'answer' | 'aborted' | 'error' | 'refusal'

function endTurn($: Engine, turnId: string, reason: TurnEnd = 'answer', agentId?: string) {
  const fields = { answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId, agentId }
  if (reason === 'refusal') return $.turn.complete({ ...fields, reason, refusal: { category: null, explanation: null } })
  return $.turn.complete({ ...fields, reason })
}

/** One main-loop turn that makes a tool call of the model's own, unless `hasToolCall` is false, then lets timers fire. */
async function mainTurn($: Engine, away: Away, turnId: string, options: { text?: string; hasToolCall?: boolean; end?: TurnEnd } = {}) {
  await $.turn.start({ text: options.text ?? 'go', turnId })
  if (options.hasToolCall !== false) await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await endTurn($, turnId, options.end)
  await away.clock.advance(10)
}

/** The continuation's own turn, started from the last prompt the mod submitted. */
const continuationTurn = ($: Engine, away: Away, turnId: string) => mainTurn($, away, turnId, { text: asDelivered(away.submitted.at(-1) ?? '') })

/** Stands in for handoff's state: `/set-phase <phase>` and `/set-ceiling <percent>` write what away reads. */
const HANDOFF: Plugin = {
  name: 'handoff',
  register(on) {
    on('command.run', { command: 'set-phase' }, async ($, e) => {
      await $.state.set({ plugin: 'handoff', key: 'phase' }, e.args as never)
      return { text: '' }
    })
    on('command.run', { command: 'set-ceiling' }, async ($, e) => {
      await $.state.set({ plugin: 'handoff', key: 'ceilingPercent' }, Number(e.args))
      return { text: '' }
    })
  },
}

const setHandoff = ($: Engine, command: 'set-phase' | 'set-ceiling', value: string | number): Promise<unknown> =>
  $.command.run({ command, args: String(value), origin: { kind: 'composer' } } as CommandRunInput)

const WORKER: AgentInfo = { id: 'worker-1', name: 'worker', description: 'Survey the parser', type: 'teammate', status: 'running' }

/** Another plugin whose `probe` command makes a tool call of its own. */
const CALLER: Plugin = {
  name: 'caller',
  register(on) {
    on('command.run', { command: 'probe' }, async $ => {
      await $.tool.call({ tool: 'Read', file_path: 'notes.md' })
      return { text: 'probed' }
    })
  },
}

test("while away, a main turn that called a tool is continued once, and the continuation's own turn is not", async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await mainTurn($, away, 't1')
  expect(continuations(away)).toBe(1)

  // A subagent's turn inside the continuation's own leaves it marked as the continuation's.
  await $.turn.start({ text: asDelivered(away.submitted.at(-1) ?? ''), turnId: 't2' })
  await $.turn.start({ text: 'survey', turnId: 's1', agentId: 'scout-1' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await endTurn($, 's1', 'answer', 'scout-1')
  await endTurn($, 't2')
  await away.clock.advance(10)
  expect(continuations(away)).toBe(1)

  await mainTurn($, away, 't3')
  expect(continuations(away)).toBe(2)
})

test('a turn is not continued while distracted, or after the owner returns', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'distracted')
  await mainTurn($, away, 't1')
  await setMode($, away, 'present')
  await mainTurn($, away, 't2')
  expect(continuations(away)).toBe(0)
})

test("a turn with no tool call of the main model's own is not continued", { plugins: [CALLER] }, async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await mainTurn($, away, 't1', { hasToolCall: false })

  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md', agentId: 'scout-1' } as never)
  await $.command.run({ command: 'probe', args: '', origin: { kind: 'composer' } } as never)
  await endTurn($, 't2')
  await away.clock.advance(10)
  expect(continuations(away)).toBe(0)
})

test('an interrupted or refused turn is not continued, and one ending while a handoff runs is neither continued nor handed off', { plugins: [HANDOFF] }, async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await mainTurn($, away, 't1', { end: 'aborted' })
  await mainTurn($, away, 't2', { end: 'refusal' })
  await setHandoff($, 'set-phase', 'writing')
  await setHandoff($, 'set-ceiling', 60)
  away.usage.percent = 75
  await mainTurn($, away, 't3')
  expect(continuations(away)).toBe(0)
  expect(away.handoffs).toEqual([])

  await setHandoff($, 'set-phase', 'idle')
  away.usage.percent = 10
  await mainTurn($, away, 't4')
  expect(continuations(away)).toBe(1)
})

test('a turn that ends while a teammate the main loop spawned is mid-run is not continued; one idle does not hold it', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  away.agents.push({ ...WORKER, spawnedBy: 'caller' }, { ...WORKER, id: 'nested-1', parentId: 'worker-0' })
  away.agents.push(WORKER)
  await mainTurn($, away, 't1')
  expect(continuations(away)).toBe(0)

  away.agents.pop()
  away.agents.push({ ...WORKER, status: 'idle' })
  await mainTurn($, away, 't2')
  expect(continuations(away)).toBe(1)
})

test('only one continuation is outstanding: a turn ending before its own turn starts is not continued as well', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await mainTurn($, away, 't1')
  await mainTurn($, away, 't2')
  expect(continuations(away)).toBe(1)

  await continuationTurn($, away, 't3')
  await mainTurn($, away, 't4')
  expect(continuations(away)).toBe(2)
})

test('a turn ended by an API error is continued a minute later, and not when a handoff or the owner comes first', { plugins: [HANDOFF] }, async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  await mainTurn($, away, 't1', { hasToolCall: false, end: 'error' })
  await away.clock.advance(59_000)
  expect(continuations(away)).toBe(0)
  await away.clock.advance(1_000)
  expect(continuations(away)).toBe(1)

  await continuationTurn($, away, 't2')
  await mainTurn($, away, 't3', { end: 'error' })
  await setHandoff($, 'set-phase', 'writing')
  await away.clock.advance(60_000)
  expect(continuations(away)).toBe(1)

  // The continuation the handoff held back never entered, so it holds back no later one.
  await setHandoff($, 'set-phase', 'idle')
  await mainTurn($, away, 't4')
  expect(continuations(away)).toBe(2)

  await continuationTurn($, away, 't5')
  await mainTurn($, away, 't6', { end: 'error' })
  await setMode($, away, 'present')
  await away.clock.advance(60_000)
  expect(continuations(away)).toBe(2)
})

const PUBLISH = { tool_name: 'Bash', tool_input: { command: 'npm publish' } }

test('while away a permission prompt is refused and posted with its decision id; while distracted it waits for the owner', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'distracted')
  expect(await $.classic.PermissionRequest(PUBLISH)).toEqual({})
  expect(away.decisions).toEqual([])

  await setMode($, away, 'away')
  const refused = await $.classic.PermissionRequest(PUBLISH)
  expect(refused.decision?.behavior).toBe('deny')
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('posted to the board as D1')
  expect(away.decisions[0]?.question).toContain('Bash call needed a permission prompt while you were away')
  expect(away.decisions[0]?.question).toContain('npm publish')
})

test("a teammate's refused prompt says its answer goes by way of the main session, in the refusal and the decision", async ($, on) => {
  const away = engine(on)
  away.agents.push(WORKER)
  await setMode($, away, 'away')
  const refused = await $.classic.PermissionRequest({ ...PUBLISH, agent_id: WORKER.id })
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('goes to your lead')
  expect(away.decisions[0]?.question).toMatch(/^worker's Bash call/)
  expect(away.decisions[0]?.context).toBe('The answer goes to the main session, which relays it to worker.')
})

test('a refused board tool is not posted, and a post the board refuses is named in the refusal', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  const board = await $.classic.PermissionRequest({ tool_name: 'mcp__board__set_task', tool_input: {} })
  expect(board.decision?.behavior).toBe('deny')
  expect(away.decisions).toEqual([])

  away.board.failure = 'the board is not loaded'
  const refused = await $.classic.PermissionRequest(PUBLISH)
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('the board is not loaded')
})

test('auto mode denials are posted outside present, once per loop, tool and category', async ($, on) => {
  const away = engine(on)
  const exfiltration = 'Denied by the classifier [Data Exfiltration]: sends files out'
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_1', reason: exfiltration })
  expect(away.decisions).toEqual([])

  await setMode($, away, 'distracted')
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_2', reason: exfiltration })
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_3', reason: `${exfiltration}, again` })
  expect(away.decisions.length).toBe(1)
  expect(away.decisions[0]?.question).toBe(`Auto mode denied Claude's Bash call [Data Exfiltration]: {"command":"npm publish"}`)

  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_4', reason: 'Denied [Irreversible Change]' })
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_5', reason: exfiltration, agent_id: 'worker-1' })
  expect(away.decisions.length).toBe(3)
})

test('past the ceiling while away, the running turn is asked once to end, then away runs /handoff', { plugins: [HANDOFF] }, async ($, on) => {
  const away = engine(on)
  await setHandoff($, 'set-ceiling', 60)
  await setMode($, away, 'away')
  away.usage.percent = 60
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await step($, 0)
  await step($, 1)
  expect(away.appended().filter(text => text.startsWith('[away: end turn]')).length).toBe(1)

  await endTurn($, 't1')
  await away.clock.advance(10)
  expect(away.handoffs).toEqual([{ kind: 'plugin', name: 'away' }])
  // Handed off rather than continued.
  expect(continuations(away)).toBe(0)
})

test('the ceiling hands off again only after the fill has dropped below it, and never while distracted', { plugins: [HANDOFF] }, async ($, on) => {
  const away = engine(on)
  await setHandoff($, 'set-ceiling', 60)
  await setMode($, away, 'away')
  away.usage.percent = 75
  await mainTurn($, away, 't1')
  await mainTurn($, away, 't2')
  expect(away.handoffs.length).toBe(1)

  away.usage.percent = 59
  await mainTurn($, away, 't3')
  away.usage.percent = 61
  await mainTurn($, away, 't4')
  expect(away.handoffs.length).toBe(2)

})

test('past the ceiling while distracted, the turn is neither asked to end nor handed off', { plugins: [HANDOFF] }, async ($, on) => {
  const away = engine(on)
  await setHandoff($, 'set-ceiling', 60)
  await setMode($, away, 'distracted')
  away.usage.percent = 90
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 0)
  await endTurn($, 't1')
  await away.clock.advance(10)
  expect(away.appended().filter(text => text.startsWith('[away: end turn]'))).toEqual([])
  expect(away.handoffs).toEqual([])
})

const localSettings = (away: Away): unknown => JSON.parse(away.files.get(LOCAL_SETTINGS) ?? 'null')

const writeLocalSettings = (away: Away, settings: unknown) => away.files.set(LOCAL_SETTINGS, JSON.stringify(settings))

const OWN_SETTINGS = { permissions: { allow: ['Bash(ls)'] }, sandbox: { enabled: false, network: { allowedDomains: ['example.com'] } } }

test('away turns the sandbox on in the local settings, keeping every other key, and leaving it puts back the value found', async ($, on) => {
  const away = engine(on)
  writeLocalSettings(away, OWN_SETTINGS)
  await setMode($, away, 'away')
  expect(localSettings(away)).toEqual({ ...OWN_SETTINGS, sandbox: { ...OWN_SETTINGS.sandbox, enabled: true } })
  expect(away.store.get(HOLD_KEY)).toEqual({ holders: ['test-session'], earlier: false })

  await setMode($, away, 'present')
  expect(localSettings(away)).toEqual(OWN_SETTINGS)
  expect(away.store.has(HOLD_KEY)).toBe(false)
})

test('a key away added is removed again, with a sandbox object it leaves empty, and a missing file counts as empty', async ($, on) => {
  const away = engine(on)
  await setMode($, away, 'away')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: true } })
  await setMode($, away, 'present')
  expect(localSettings(away)).toEqual({})

  const network = { sandbox: { network: { allowedDomains: ['example.com'] } } }
  writeLocalSettings(away, network)
  await setMode($, away, 'away')
  await setMode($, away, 'present')
  expect(localSettings(away)).toEqual(network)
})

test('a local settings file that does not hold a JSON object is left untouched, and the owner is told the sandbox is off', async ($, on) => {
  const away = engine(on)
  away.files.set(LOCAL_SETTINGS, '{ "sandbox": ')
  await setMode($, away, 'away')
  expect(away.files.get(LOCAL_SETTINGS)).toBe('{ "sandbox": ')
  expect(away.toasts).toContain(`The sandbox is off while away: ${LOCAL_SETTINGS} does not hold a JSON object`)
  expect(away.store.has(HOLD_KEY)).toBe(false)
  expect(away.statuses.at(-1)).toBe('away')
})

test('leaving away for distracted puts the sandbox back too, and distracted from present leaves the settings alone', async ($, on) => {
  const away = engine(on)
  const ownText = '{"sandbox":{"enabled":false}}'
  away.files.set(LOCAL_SETTINGS, ownText)
  await setMode($, away, 'distracted')
  expect(away.files.get(LOCAL_SETTINGS)).toBe(ownText)

  await setMode($, away, 'away')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: true } })
  await setMode($, away, 'distracted')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(HOLD_KEY)).toBe(false)
})

test('sessions sharing a root keep the sandbox on until the last leaves away, which puts back the value from before the first', async ($, on) => {
  const away = engine(on, { [HOLD_KEY]: { holders: ['other-session'], earlier: false }, 'session:other-session': { mode: 'away', savedAt: 1 } })
  writeLocalSettings(away, { sandbox: { enabled: true } })
  const heldText = away.files.get(LOCAL_SETTINGS)
  await setMode($, away, 'away')
  expect(away.store.get(HOLD_KEY)).toEqual({ holders: ['other-session', 'test-session'], earlier: false })
  // Nothing to change, so the owner's own formatting stays.
  expect(away.files.get(LOCAL_SETTINGS)).toBe(heldText)

  await setMode($, away, 'present')
  expect(away.store.get(HOLD_KEY)).toEqual({ holders: ['other-session'], earlier: false })
  expect(localSettings(away)).toEqual({ sandbox: { enabled: true } })

  // The other session, still away, resumed in this process.
  away.session.id = 'other-session'
  await mainTurnStart($)
  await setMode($, away, 'present')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(HOLD_KEY)).toBe(false)
})

test('/mode present typed while present puts back the value a session that died away left on', async ($, on) => {
  const away = engine(on, { [HOLD_KEY]: { holders: ['dead-session'], earlier: false } })
  writeLocalSettings(away, { sandbox: { enabled: true } })
  expect(await setMode($, away, 'present')).toContain('put back')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(HOLD_KEY)).toBe(false)

  expect(await setMode($, away, 'present')).toBe('Already present.')
})

test('a settings file broken while away keeps the earlier value, for /mode present to put back once it is fixed', async ($, on) => {
  const away = engine(on)
  writeLocalSettings(away, { sandbox: { enabled: false } })
  await setMode($, away, 'away')
  away.files.set(LOCAL_SETTINGS, '[]')
  await setMode($, away, 'present')
  expect(away.toasts).toContain(`The sandbox stays on until /mode present can put it back: ${LOCAL_SETTINGS} does not hold a JSON object`)
  expect(away.store.get(HOLD_KEY)).toEqual({ holders: [], earlier: false })

  writeLocalSettings(away, { sandbox: { enabled: true } })
  await setMode($, away, 'present')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(HOLD_KEY)).toBe(false)
})

test('a conversation moved to a new session id while away moves its hold, and one resumed distracted gives it up', async ($, on) => {
  const away = engine(on, { 'session:resumed-session': { mode: 'distracted', savedAt: 1 } })
  await setMode($, away, 'away')
  away.session.id = 'moved-session'
  await mainTurnStart($)
  expect(away.store.get(HOLD_KEY)).toEqual({ holders: ['moved-session'] })
  expect(localSettings(away)).toEqual({ sandbox: { enabled: true } })

  away.session.id = 'resumed-session'
  await mainTurnStart($)
  expect(localSettings(away)).toEqual({})
  expect(away.store.has(HOLD_KEY)).toBe(false)
})

const MOVED_ROOT = '/work/worktree'

const MOVED_SETTINGS = `${MOVED_ROOT}/.claude/settings.local.json`

test('a session whose root moved while away puts the sandbox back under the root it held, not the new one', async ($, on) => {
  const away = engine(on)
  writeLocalSettings(away, { sandbox: { enabled: false } })
  await setMode($, away, 'away')
  away.root = MOVED_ROOT
  await setMode($, away, 'present')
  expect(localSettings(away)).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(HOLD_KEY)).toBe(false)
  expect(away.files.has(MOVED_SETTINGS)).toBe(false)
})

test("a session's root moved mid-turn while away takes the hold with it at the main loop's next request, not a teammate's", async ($, on) => {
  const away = engine(on)
  writeLocalSettings(away, { sandbox: { enabled: false } })
  await setMode($, away, 'away')
  await mainTurnStart($)
  await step($, 0)
  away.root = MOVED_ROOT
  await step($, 1, 'scout-1')
  expect(away.files.has(MOVED_SETTINGS)).toBe(false)

  await step($, 2)
  expect(JSON.parse(away.files.get(MOVED_SETTINGS) ?? 'null')).toEqual({ sandbox: { enabled: true } })
  expect(away.store.get(`sandbox:${MOVED_ROOT}`)).toEqual({ holders: ['test-session'] })
  expect(away.store.get(SESSION_KEY)).toMatchObject({ sandboxRoot: MOVED_ROOT })
  expect(localSettings(away)).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(HOLD_KEY)).toBe(false)
})

test('a session restarted away under another root gives up the hold it left in the old one', async ($, on) => {
  const away = engine(on, {
    [SESSION_KEY]: { mode: 'away', savedAt: 1, sandboxRoot: MOVED_ROOT },
    [`sandbox:${MOVED_ROOT}`]: { holders: ['test-session'], earlier: false },
  })
  away.files.set(MOVED_SETTINGS, JSON.stringify({ sandbox: { enabled: true } }))
  await mainTurnStart($)
  expect(JSON.parse(away.files.get(MOVED_SETTINGS) ?? 'null')).toEqual({ sandbox: { enabled: false } })
  expect(away.store.has(`sandbox:${MOVED_ROOT}`)).toBe(false)
  expect(localSettings(away)).toEqual({ sandbox: { enabled: true } })
  expect(away.store.get(SESSION_KEY)).toMatchObject({ sandboxRoot: ROOT })
})

test('a session restarted away turns the sandbox on again where the owner turned it off', async ($, on) => {
  const away = engine(on, { [SESSION_KEY]: { mode: 'away', savedAt: 1 }, [HOLD_KEY]: { holders: ['test-session'], earlier: false } })
  writeLocalSettings(away, { sandbox: { enabled: false } })
  await mainTurnStart($)
  expect(localSettings(away)).toEqual({ sandbox: { enabled: true } })
  expect(away.store.get(HOLD_KEY)).toEqual({ holders: ['test-session'], earlier: false })
})
