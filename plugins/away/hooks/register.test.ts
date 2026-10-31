import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { AgentInfo, CommandRunInput, CommandSpec, On, PromptOrigin } from 'claude-code'

// Type-aware oxlint holds several GB for each test file that calls `on`, so every test of this plugin stays in this file.

const SESSION_KEY = 'session:test-session'

type PostedDecision = { question: string; context?: string; options: { label: string }[] }

type World = {
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
  /** Each text $.fs.write wrote, oldest first. */
  writes: string[]
  /** What $.session.root() answers. */
  root: string
  /** The root of the repository $.session.repo() answers. */
  repoRoot: string
  /** What `--settings` and managed settings hold, as $.settings.read({ source }) answers. */
  sources: { flag: Record<string, unknown>; policy: Record<string, unknown> }
  /** Each slash command the mod registered. */
  commands: CommandSpec[]
}

const ROOT = '/work/repo'

const LOCAL_SETTINGS = `${ROOT}/.claude/settings.local.json`

const HOLD_KEY = `sandbox:${ROOT}`

const HELD_ROOT_KEY = 'held:test-session'

/** The engine nouns the mod calls, answered in memory; `seed` is what the store holds before the test starts. */
function buildWorld(on: On, seed: Record<string, unknown> = {}): World {
  const session = mock.session(on)
  const world: World = {
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
    writes: [],
    root: ROOT,
    repoRoot: ROOT,
    sources: { flag: {}, policy: {} },
    commands: [],
  }
  on('session.root', () => ({ value: world.root }) as never)
  on('session.repo', () => ({ value: { root: world.repoRoot, remote: null, internal: false, repository: null } }) as never)
  on('settings.read', ($, e) => ({ value: world.sources[(e as { source: 'flag' | 'policy' }).source] }) as never)
  on('process.run', ($, e) => {
    const [command, , path] = (e as { argv: string[] }).argv
    if (command !== 'rm' || path === undefined || !world.files.has(path)) return { value: { exitCode: 1, stdout: '', stderr: 'no such file' } } as never
    world.files.delete(path)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', ($, e) => ({ value: world.files.has((e as { path: string }).path) }) as never)
  on('fs.read', ($, e) => {
    const { path } = e as { path: string }
    const text = world.files.get(path)
    if (text === undefined) throw new Error(`ENOENT: ${path}`)
    return { value: text } as never
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as { path: string; text: string }
    world.files.set(path, text)
    world.writes.push(text)
    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: world.agents }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000, percent: world.usage.percent } } }) as never)
  // As board answers: the decision's id first, then text meant for the loop that asked.
  on('tool.call', { tool: 'mcp__board__ask_decision' }, ($, e) => {
    if (world.board.failure !== undefined) return { deny: world.board.failure }
    world.decisions.push(e as unknown as PostedDecision)
    return { result: `Posted D${world.decisions.length}. The answer will arrive as a message; do not wait for it.` } as never
  })
  // Any other tool, as core would run it.
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('command.run', { command: 'handoff' }, ($, e) => {
    world.handoffs.push(e.origin)
    return { text: 'Handoff requested.' }
  })
  // The prompt waits on the owner, so no decision comes back.
  on('classic.PermissionRequest', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('turn.complete', () => ({ text: '' }))
  on('session.id', () => ({ value: world.session.id }) as never)
  on('store.get', ($, e) => ({ value: world.store.get((e as { key: string }).key) }) as never)
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    world.store.set(key, value)
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    world.store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...world.store.keys()] }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    world.commands.push(e as CommandSpec)
    return { value: { command: (e as CommandSpec).name } } as never
  })
  on('ui.status', ($, e) => {
    world.statuses.push((e as { text?: string }).text ?? '')
    return { value: undefined } as never
  })
  on('ui.toast', ($, e) => {
    world.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    world.submitted.push(e.text)
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
  return world
}

const rulesSent = (world: World, mode: string) => world.appended().filter(text => text.startsWith(`[mode: ${mode}]`)).length

const returnReports = (world: World) => world.submitted.filter(text => text.startsWith('[return]')).length

// Promise<unknown> on purpose: with the dependencies' contracts laid beside this mod's types, type-aware oxlint cannot
// resolve claude-code's result types and fails every await of the command's promise.
const runCommand = ($: Engine, args: string): Promise<unknown> =>
  $.command.run({ command: 'mode', args, origin: { kind: 'composer' } } as CommandRunInput)

async function setMode($: Engine, world: World, args: string): Promise<string> {
  const result = await runCommand($, args)
  // A prompt the mod submits waits for the command's hook to return, on a timer.
  await world.clock.advance(10)
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
  const world = buildWorld(on)
  expect(await setMode($, world, 'away')).toBe('Mode: away.')
  expect(world.statuses.at(-1)).toBe('away')
  expect(world.store.get(SESSION_KEY)).toBe('away')
  expect(rulesSent(world, 'away')).toBe(1)

  expect(await setMode($, world, 'away')).toBe('Already away.')
  expect(rulesSent(world, 'away')).toBe(1)
})

test('/mode present clears the status line and the stored mode, and sends the present rules', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'distracted')
  await setMode($, world, 'present')
  // The first command's bind clears the line too, so the last two show this switch cleared it.
  expect(world.statuses.slice(-2)).toEqual(['distracted', ''])
  expect(world.store.has(SESSION_KEY)).toBe(false)
  expect(rulesSent(world, 'present')).toBe(1)
})

test('an unknown mode is refused and changes nothing, and a bare /mode reports the mode', async ($, on) => {
  const world = buildWorld(on)
  expect(await setMode($, world, 'asleep')).toContain('Unknown mode "asleep"')
  expect(world.store.size).toBe(0)
  expect(world.appended()).toEqual([])
  await setMode($, world, 'distracted')
  expect(await setMode($, world, '')).toContain('Mode: distracted.')
})

test('rules the session refuses to append are toasted, so the owner can pass them on', async ($, on) => {
  on('session.append', { door: 'note' }, () => ({ deny: 'no running loop' }))
  const world = buildWorld(on)
  await setMode($, world, 'away')
  expect(rulesSent(world, 'away')).toBe(0)
  expect(world.toasts).toContain('The away rules did not reach Claude (no running loop); tell it yourself')
})

test('switching from away to present asks for the return report from the board; from distracted it does not', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'distracted')
  await setMode($, world, 'present')
  expect(returnReports(world)).toBe(0)

  await setMode($, world, 'away')
  await setMode($, world, 'present')
  expect(returnReports(world)).toBe(1)
  expect(world.submitted[0]).toContain('mcp__board__read_board')
  expect(world.submitted[0]).toContain('the decisions and the tasks for the owner')
})

test('coming back from away by way of distracted still asks for the return report, once', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await setMode($, world, 'distracted')
  await setMode($, world, 'present')
  expect(returnReports(world)).toBe(1)

  await setMode($, world, 'distracted')
  await setMode($, world, 'present')
  expect(returnReports(world)).toBe(1)
})

test('a mode stored for the session is restored with a toast, and a return from it still reports', async ($, on) => {
  const world = buildWorld(on, { [SESSION_KEY]: 'away' })
  await mainTurnStart($)
  expect(world.statuses.at(-1)).toBe('away')
  expect(world.toasts).toContain('Restored away mode')

  await setMode($, world, 'present')
  expect(returnReports(world)).toBe(1)
})

test('a conversation moved to a new session id keeps its mode and is sent the rules again', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  world.session.id = 'moved-session'
  await mainTurnStart($)
  expect(world.store.get('session:moved-session')).toBe('away')
  expect(rulesSent(world, 'away')).toBe(2)
  expect(world.toasts.filter(toast => toast.startsWith('Restored'))).toEqual([])
})

test('after a compaction, the next turn is sent the rules again once, except in present', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await compact($)
  await mainTurnStart($)
  expect(rulesSent(world, 'away')).toBe(2)
  await mainTurnStart($)
  expect(rulesSent(world, 'away')).toBe(2)

  await setMode($, world, 'present')
  await compact($)
  await mainTurnStart($)
  expect(rulesSent(world, 'present')).toBe(1)
})

test("a compaction inside a turn is answered at the main loop's next request, and a teammate's compaction, turn or request is not", async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'distracted')
  await compact($, 'worker-1')
  await step($, 0)
  expect(rulesSent(world, 'distracted')).toBe(1)

  await compact($)
  await $.turn.start({ text: 'survey', turnId: 's1', agentId: 'worker-1' })
  await step($, 1, 'worker-1')
  expect(rulesSent(world, 'distracted')).toBe(1)
  await step($, 2)
  expect(rulesSent(world, 'distracted')).toBe(2)
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
  const world = buildWorld(on)
  const band = await mountBand($)
  const lines = async () => (await band.findAll({ type: 'Text' })).map(found => found.text)
  const buttons = async () => (await band.findAll({ type: 'Button' })).map(found => found.key)
  expect(await lines()).toEqual(['the other band', 'Mode: present '])
  expect(await buttons()).toEqual(['mode-distracted', 'mode-away'])
  await band.press({ key: 'mode-away' })
  expect(world.statuses.at(-1)).toBe('away')
  expect(await buttons()).toEqual(['mode-present', 'mode-distracted'])
})

test('the band draws nothing of its own while a survey is up', async ($, on) => {
  buildWorld(on)
  const band = await mountBand($, true)
  expect(await band.find({ type: 'Text', text: 'the other band' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Mode:/ })).toBeUndefined()
})

const continuations = (world: World) => world.submitted.filter(text => text.includes('[away: continue]')).length

/** A prompt the mod submitted, as the engine starts its turn: opened by a line naming the plugin. */
const asDelivered = (prompt: string) => `The away plugin sent a message:\n${prompt}`

type TurnEnd = 'answer' | 'aborted' | 'error' | 'refusal'

function endTurn($: Engine, turnId: string, reason: TurnEnd = 'answer', agentId?: string) {
  const fields = { answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId, agentId }
  if (reason === 'refusal') return $.turn.complete({ ...fields, reason, refusal: { category: null, explanation: null } })
  return $.turn.complete({ ...fields, reason })
}

/** One main-loop turn that makes a tool call of the model's own, unless `hasToolCall` is false, then lets timers fire. */
async function mainTurn($: Engine, world: World, turnId: string, options: { text?: string; hasToolCall?: boolean; end?: TurnEnd } = {}) {
  await $.turn.start({ text: options.text ?? 'go', turnId })
  if (options.hasToolCall !== false) await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await endTurn($, turnId, options.end)
  await world.clock.advance(10)
}

/** The continuation's own turn, started from the last prompt the mod submitted. */
const continuationTurn = ($: Engine, world: World, turnId: string) => mainTurn($, world, turnId, { text: asDelivered(world.submitted.at(-1) ?? '') })

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
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await mainTurn($, world, 't1')
  expect(continuations(world)).toBe(1)

  // A subagent's turn inside the continuation's own leaves it marked as the continuation's.
  await $.turn.start({ text: asDelivered(world.submitted.at(-1) ?? ''), turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await $.turn.start({ text: 'survey', turnId: 's1', agentId: 'scout-1' })
  await endTurn($, 's1', 'answer', 'scout-1')
  await endTurn($, 't2')
  await world.clock.advance(10)
  expect(continuations(world)).toBe(1)

  await mainTurn($, world, 't3')
  expect(continuations(world)).toBe(2)
})

test('a turn is not continued while distracted, or after the owner returns', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'distracted')
  await mainTurn($, world, 't1')
  await setMode($, world, 'present')
  await mainTurn($, world, 't2')
  expect(continuations(world)).toBe(0)
})

test('/mode runs mid-turn, and a /mode present typed during an away turn neither refuses its prompts nor continues it', async ($, on) => {
  const world = buildWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(world.commands.find(command => command.name === 'mode')?.immediate).toBe(true)

  await setMode($, world, 'away')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await setMode($, world, 'present')
  expect(await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm publish' } })).toEqual({})
  await endTurn($, 't1')
  await world.clock.advance(10)
  expect(continuations(world)).toBe(0)
})

test("a turn with no tool call of the main model's own is not continued", { plugins: [CALLER] }, async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await mainTurn($, world, 't1', { hasToolCall: false })

  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md', agentId: 'scout-1' } as never)
  await $.command.run({ command: 'probe', args: '', origin: { kind: 'composer' } } as never)
  await endTurn($, 't2')
  await world.clock.advance(10)
  expect(continuations(world)).toBe(0)
})

test('an interrupted or refused turn is not continued, and one ending while a handoff runs is neither continued nor handed off', { plugins: [HANDOFF] }, async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await mainTurn($, world, 't1', { end: 'aborted' })
  await mainTurn($, world, 't2', { end: 'refusal' })
  await setHandoff($, 'set-phase', 'writing')
  await setHandoff($, 'set-ceiling', 60)
  world.usage.percent = 75
  await mainTurn($, world, 't3')
  expect(continuations(world)).toBe(0)
  expect(world.handoffs).toEqual([])

  await setHandoff($, 'set-phase', 'idle')
  world.usage.percent = 10
  await mainTurn($, world, 't4')
  expect(continuations(world)).toBe(1)
})

test('a turn that ends while a teammate the main loop spawned is mid-run is not continued; one idle or ended does not hold it', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  world.agents.push({ ...WORKER, spawnedBy: 'caller' }, { ...WORKER, id: 'nested-1', parentId: 'worker-0' })
  world.agents.push(WORKER)
  await mainTurn($, world, 't1')
  expect(continuations(world)).toBe(0)

  world.agents.pop()
  world.agents.push({ ...WORKER, status: 'idle' }, { ...WORKER, id: 'worker-2', status: 'completed' })
  await mainTurn($, world, 't2')
  expect(continuations(world)).toBe(1)
})

test('only one continuation is outstanding: a turn ending before its own turn starts is not continued as well', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await mainTurn($, world, 't1')
  await mainTurn($, world, 't2')
  expect(continuations(world)).toBe(1)

  await continuationTurn($, world, 't3')
  await mainTurn($, world, 't4')
  expect(continuations(world)).toBe(2)
})

test('a turn ended by an API error is continued a minute later, and not when a handoff or the owner comes first', { plugins: [HANDOFF] }, async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await mainTurn($, world, 't1', { hasToolCall: false, end: 'error' })
  await world.clock.advance(59_000)
  expect(continuations(world)).toBe(0)
  await world.clock.advance(1_000)
  expect(continuations(world)).toBe(1)

  await continuationTurn($, world, 't2')
  await mainTurn($, world, 't3', { end: 'error' })
  await setHandoff($, 'set-phase', 'writing')
  await world.clock.advance(60_000)
  expect(continuations(world)).toBe(1)

  // The continuation the handoff held back never entered, so it holds back no later one.
  await setHandoff($, 'set-phase', 'idle')
  await mainTurn($, world, 't4')
  expect(continuations(world)).toBe(2)

  await continuationTurn($, world, 't5')
  await mainTurn($, world, 't6', { end: 'error' })
  await setMode($, world, 'present')
  await world.clock.advance(60_000)
  expect(continuations(world)).toBe(2)
})

const PUBLISH = { tool_name: 'Bash', tool_input: { command: 'npm publish' } }

test('while away a permission prompt is refused and posted with its decision id; while distracted it waits for the owner', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'distracted')
  expect(await $.classic.PermissionRequest(PUBLISH)).toEqual({})
  expect(world.decisions).toEqual([])

  await setMode($, world, 'away')
  const refused = await $.classic.PermissionRequest(PUBLISH)
  expect(refused.decision?.behavior).toBe('deny')
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('posted to the board as D1')
  expect(world.decisions[0]?.question).toContain('Bash call needed a permission prompt while you were away')
  expect(world.decisions[0]?.question).toContain('npm publish')
})

test("a teammate's refused prompt says its answer goes by way of the main session, in the refusal and the decision", async ($, on) => {
  const world = buildWorld(on)
  world.agents.push(WORKER)
  await setMode($, world, 'away')
  const refused = await $.classic.PermissionRequest({ ...PUBLISH, agent_id: WORKER.id })
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('goes to your lead')
  expect(world.decisions[0]?.question).toMatch(/^worker's Bash call/)
  expect(world.decisions[0]?.context).toBe('The answer goes to the main session, which relays it to worker.')
})

test('a refused prompt is posted once per loop, tool and input, and a repeat names the decision already posted', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  await $.classic.PermissionRequest(PUBLISH)
  const again = await $.classic.PermissionRequest(PUBLISH)
  expect(again.decision?.behavior === 'deny' ? again.decision.message : '').toContain('It was posted to the board as D1')
  expect(world.decisions.length).toBe(1)

  await $.classic.PermissionRequest({ ...PUBLISH, agent_id: 'worker-1' })
  await $.classic.PermissionRequest({ ...PUBLISH, tool_name: 'PowerShell' })
  await $.classic.PermissionRequest({ ...PUBLISH, tool_input: { command: 'npm test' } })
  expect(world.decisions.length).toBe(4)
})

test('an AskUserQuestion prompt while away is refused with the way to ask on the board, and nothing is posted', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  const refused = await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } })
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('Post each question as a board decision')
  expect(world.decisions).toEqual([])
})

test('a refused board tool is not posted, and a post the board refuses is named in the refusal', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  const board = await $.classic.PermissionRequest({ tool_name: 'mcp__board__set_task', tool_input: {} })
  expect(board.decision?.behavior).toBe('deny')
  expect(world.decisions).toEqual([])

  world.board.failure = 'the board is not loaded'
  const refused = await $.classic.PermissionRequest(PUBLISH)
  expect(refused.decision?.behavior === 'deny' ? refused.decision.message : '').toContain('the board is not loaded')
})

test('auto mode denials are posted outside present, once per loop, tool and category', async ($, on) => {
  const world = buildWorld(on)
  const exfiltration = 'Denied by the classifier [Data Exfiltration]: sends files out'
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_1', reason: exfiltration })
  expect(world.decisions).toEqual([])

  await setMode($, world, 'distracted')
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_2', reason: exfiltration })
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_3', reason: `${exfiltration}, again` })
  expect(world.decisions.length).toBe(1)
  expect(world.decisions[0]?.question).toBe(`Auto mode denied Claude's Bash call [Data Exfiltration]: {"command":"npm publish"}`)

  await setMode($, world, 'away')
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_4', reason: 'Denied [Irreversible Change]' })
  await $.classic.PermissionDenied({ ...PUBLISH, tool_use_id: 'toolu_5', reason: exfiltration, agent_id: 'worker-1' })
  await $.classic.PermissionDenied({ tool_name: 'Write', tool_input: { file_path: 'notes.md' }, tool_use_id: 'toolu_6', reason: exfiltration })
  expect(world.decisions.length).toBe(4)
})

test('past the ceiling while away, the running turn is asked once to end, then away runs /handoff', { plugins: [HANDOFF] }, async ($, on) => {
  const world = buildWorld(on)
  await setHandoff($, 'set-ceiling', 60)
  await setMode($, world, 'away')
  world.usage.percent = 60
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)
  await step($, 0)
  await step($, 1)
  expect(world.appended().filter(text => text.startsWith('[away: end turn]')).length).toBe(1)

  await endTurn($, 't1')
  await world.clock.advance(10)
  expect(world.handoffs).toEqual([{ kind: 'plugin', name: 'away' }])
  // Handed off rather than continued.
  expect(continuations(world)).toBe(0)
})

test('the ceiling hands off again only after the fill has dropped below it', { plugins: [HANDOFF] }, async ($, on) => {
  const world = buildWorld(on)
  await setHandoff($, 'set-ceiling', 60)
  await setMode($, world, 'away')
  world.usage.percent = 75
  await mainTurn($, world, 't1')
  await mainTurn($, world, 't2')
  expect(world.handoffs.length).toBe(1)

  world.usage.percent = 59
  await mainTurn($, world, 't3')
  world.usage.percent = 61
  await mainTurn($, world, 't4')
  expect(world.handoffs.length).toBe(2)
})

test('past the ceiling while distracted, the turn is neither asked to end nor handed off', { plugins: [HANDOFF] }, async ($, on) => {
  const world = buildWorld(on)
  await setHandoff($, 'set-ceiling', 60)
  await setMode($, world, 'distracted')
  world.usage.percent = 90
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 0)
  await endTurn($, 't1')
  await world.clock.advance(10)
  expect(world.appended().filter(text => text.startsWith('[away: end turn]'))).toEqual([])
  expect(world.handoffs).toEqual([])
})


const localSettings = (world: World): unknown => JSON.parse(world.files.get(LOCAL_SETTINGS) ?? 'null')

const writeLocalSettings = (world: World, settings: unknown) => world.files.set(LOCAL_SETTINGS, JSON.stringify(settings))

const AWAY_SANDBOX = { enabled: true, autoAllowBashIfSandboxed: false }

const OWN_SANDBOX = { enabled: false, autoAllowBashIfSandboxed: true }

const OWN_SETTINGS = { permissions: { allow: ['Bash(ls)'] }, sandbox: { ...OWN_SANDBOX, network: { allowedDomains: ['example.com'] } } }

/** A hold no session took through away, as the store keeps it. */
const heldBy = (holders: string[], earlier: unknown = { enabled: false }) => ({ holders, earlier, isFileCreated: false })

test('away turns the sandbox on with auto-allow off, keeping every other key, and leaving it puts back both values found', async ($, on) => {
  const world = buildWorld(on)
  writeLocalSettings(world, OWN_SETTINGS)
  await setMode($, world, 'away')
  expect(localSettings(world)).toEqual({ ...OWN_SETTINGS, sandbox: { ...OWN_SETTINGS.sandbox, ...AWAY_SANDBOX } })
  expect(world.store.get(HOLD_KEY)).toEqual({ holders: ['test-session'], earlier: OWN_SANDBOX, isFileCreated: false })
  // The repository root's file is this one, so nothing above it sets the sandbox off.
  expect(world.toasts).toEqual([])

  await setMode($, world, 'present')
  expect(localSettings(world)).toEqual(OWN_SETTINGS)
  expect(world.store.has(HOLD_KEY)).toBe(false)
})

test('keys away added are removed again, with a sandbox object they leave empty, and a file away created is deleted', async ($, on) => {
  const world = buildWorld(on)
  await setMode($, world, 'away')
  expect(localSettings(world)).toEqual({ sandbox: AWAY_SANDBOX })
  await setMode($, world, 'present')
  expect(world.files.has(LOCAL_SETTINGS)).toBe(false)

  const network = { sandbox: { network: { allowedDomains: ['example.com'] } } }
  writeLocalSettings(world, network)
  await setMode($, world, 'away')
  await setMode($, world, 'present')
  expect(localSettings(world)).toEqual(network)

  writeLocalSettings(world, {})
  await setMode($, world, 'away')
  await setMode($, world, 'present')
  expect(localSettings(world)).toEqual({})
})

test('a local settings file that does not hold a JSON object is left untouched, and the owner is told the sandbox is off', async ($, on) => {
  const world = buildWorld(on)
  world.files.set(LOCAL_SETTINGS, '{ "sandbox": ')
  await setMode($, world, 'away')
  expect(world.files.get(LOCAL_SETTINGS)).toBe('{ "sandbox": ')
  expect(world.toasts).toContain(`The sandbox is off while away: ${LOCAL_SETTINGS} does not hold a JSON object`)
  expect(world.store.has(HOLD_KEY)).toBe(false)
  expect(world.statuses.at(-1)).toBe('away')
})

const WORKTREE_ROOT = '/work/worktree'

const WORKTREE_SETTINGS = `${WORKTREE_ROOT}/.claude/settings.local.json`

test('going away toasts each value above the session root\'s file that undoes the sandbox or its prompts, and no other', async ($, on) => {
  const world = buildWorld(on)
  world.root = WORKTREE_ROOT
  writeLocalSettings(world, { sandbox: { enabled: false } })
  world.sources.flag = { sandbox: { autoAllowBashIfSandboxed: true } }
  world.sources.policy = { sandbox: { enabled: true, autoAllowBashIfSandboxed: false } }
  await setMode($, world, 'away')
  expect(JSON.parse(world.files.get(WORKTREE_SETTINGS) ?? 'null')).toEqual({ sandbox: AWAY_SANDBOX })
  expect(world.toasts).toEqual([
    `${LOCAL_SETTINGS} sets sandbox.enabled to false, which wins over ${WORKTREE_SETTINGS}, so the sandbox stays off while away`,
    `--settings sets sandbox.autoAllowBashIfSandboxed to true, which wins over ${WORKTREE_SETTINGS}, so sandboxed Bash runs without a prompt while away`,
  ])
})

test('leaving away for distracted puts the sandbox back too, and distracted from present leaves the settings alone', async ($, on) => {
  const world = buildWorld(on)
  const ownText = '{"sandbox":{"enabled":false}}'
  world.files.set(LOCAL_SETTINGS, ownText)
  await setMode($, world, 'distracted')
  expect(world.files.get(LOCAL_SETTINGS)).toBe(ownText)

  await setMode($, world, 'away')
  expect(localSettings(world)).toEqual({ sandbox: AWAY_SANDBOX })
  await setMode($, world, 'distracted')
  expect(localSettings(world)).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(HOLD_KEY)).toBe(false)
})

test('sessions sharing a root keep the sandbox on until the last leaves away, which puts back the values from before the first', async ($, on) => {
  const world = buildWorld(on, { [HOLD_KEY]: heldBy(['other-session']), 'session:other-session': 'away', 'held:other-session': ROOT })
  writeLocalSettings(world, { sandbox: AWAY_SANDBOX })
  const heldText = world.files.get(LOCAL_SETTINGS)
  await setMode($, world, 'away')
  expect(world.store.get(HOLD_KEY)).toEqual(heldBy(['other-session', 'test-session']))
  // Nothing to change, so the owner's own formatting stays.
  expect(world.files.get(LOCAL_SETTINGS)).toBe(heldText)

  await setMode($, world, 'present')
  expect(world.store.get(HOLD_KEY)).toEqual(heldBy(['other-session']))
  expect(localSettings(world)).toEqual({ sandbox: AWAY_SANDBOX })

  // The other session, still away, resumed in this process.
  world.session.id = 'other-session'
  await mainTurnStart($)
  await setMode($, world, 'present')
  expect(localSettings(world)).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(HOLD_KEY)).toBe(false)
})

test('a session starting present on a held root is told, and /mode present there puts back the values a session that died away left', async ($, on) => {
  const world = buildWorld(on, { [HOLD_KEY]: heldBy(['dead-session']) })
  writeLocalSettings(world, { sandbox: AWAY_SANDBOX })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(world.toasts).toEqual([`The sandbox is held on in ${ROOT} for a session that is away or ended while away; /mode present puts it back`])

  expect(await setMode($, world, 'present')).toContain('put back')
  expect(localSettings(world)).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(HOLD_KEY)).toBe(false)
  expect(await setMode($, world, 'present')).toBe('Already present.')
})

test('a settings file broken while away keeps the earlier values, for /mode present to put back once it is fixed', async ($, on) => {
  const world = buildWorld(on)
  writeLocalSettings(world, { sandbox: { enabled: false } })
  await setMode($, world, 'away')
  world.files.set(LOCAL_SETTINGS, '[]')
  await setMode($, world, 'present')
  expect(world.toasts).toContain(`The sandbox stays on until /mode present can put it back: ${LOCAL_SETTINGS} does not hold a JSON object`)
  expect(world.store.get(HOLD_KEY)).toEqual(heldBy([]))

  writeLocalSettings(world, { sandbox: AWAY_SANDBOX })
  await setMode($, world, 'present')
  expect(localSettings(world)).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(HOLD_KEY)).toBe(false)
})

test('a conversation moved to a new session id while away moves its hold with no write in between, and one resumed distracted gives it up', async ($, on) => {
  const world = buildWorld(on, { 'session:resumed-session': 'distracted' })
  await setMode($, world, 'away')
  world.session.id = 'moved-session'
  await mainTurnStart($)
  expect(world.store.get(HOLD_KEY)).toMatchObject({ holders: ['moved-session'] })
  // One write, so the file never held the sandbox off while away.
  expect(world.writes.map(text => JSON.parse(text) as unknown)).toEqual([{ sandbox: AWAY_SANDBOX }])

  world.session.id = 'resumed-session'
  await mainTurnStart($)
  expect(world.files.has(LOCAL_SETTINGS)).toBe(false)
  expect(world.store.has(HOLD_KEY)).toBe(false)
})

test('a session whose root moved while away puts the sandbox back under the root it held, not the new one', async ($, on) => {
  const world = buildWorld(on)
  writeLocalSettings(world, { sandbox: { enabled: false } })
  await setMode($, world, 'away')
  world.root = WORKTREE_ROOT
  await setMode($, world, 'present')
  expect(localSettings(world)).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(HOLD_KEY)).toBe(false)
  expect(world.files.has(WORKTREE_SETTINGS)).toBe(false)
})

test("a session's root moved mid-turn while away takes the hold with it at the main loop's next request, not a teammate's", async ($, on) => {
  const world = buildWorld(on)
  writeLocalSettings(world, { sandbox: { enabled: false } })
  await setMode($, world, 'away')
  await mainTurnStart($)
  await step($, 0)
  world.root = WORKTREE_ROOT
  await step($, 1, 'scout-1')
  expect(world.files.has(WORKTREE_SETTINGS)).toBe(false)

  await step($, 2)
  expect(JSON.parse(world.files.get(WORKTREE_SETTINGS) ?? 'null')).toEqual({ sandbox: AWAY_SANDBOX })
  expect(world.store.get(`sandbox:${WORKTREE_ROOT}`)).toMatchObject({ holders: ['test-session'] })
  expect(world.store.get(HELD_ROOT_KEY)).toBe(WORKTREE_ROOT)
  expect(localSettings(world)).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(HOLD_KEY)).toBe(false)
})

test('a session restarted away under another root gives up the hold it left in the old one', async ($, on) => {
  const world = buildWorld(on, { [SESSION_KEY]: 'away', [HELD_ROOT_KEY]: WORKTREE_ROOT, [`sandbox:${WORKTREE_ROOT}`]: heldBy(['test-session']) })
  world.files.set(WORKTREE_SETTINGS, JSON.stringify({ sandbox: AWAY_SANDBOX }))
  await mainTurnStart($)
  expect(JSON.parse(world.files.get(WORKTREE_SETTINGS) ?? 'null')).toEqual({ sandbox: { enabled: false } })
  expect(world.store.has(`sandbox:${WORKTREE_ROOT}`)).toBe(false)
  expect(localSettings(world)).toEqual({ sandbox: AWAY_SANDBOX })
  expect(world.store.get(HELD_ROOT_KEY)).toBe(ROOT)
})

test('a session restarted away turns the sandbox on again where the owner turned it off', async ($, on) => {
  const world = buildWorld(on, { [SESSION_KEY]: 'away', [HELD_ROOT_KEY]: ROOT, [HOLD_KEY]: heldBy(['test-session']) })
  writeLocalSettings(world, { sandbox: { enabled: false } })
  await mainTurnStart($)
  expect(localSettings(world)).toEqual({ sandbox: AWAY_SANDBOX })
  expect(world.store.get(HOLD_KEY)).toEqual(heldBy(['test-session']))
})
