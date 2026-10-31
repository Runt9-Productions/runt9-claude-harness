import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, On, PromptComposeInput, RenderSurface } from 'claude-code'

const ASK = {
  tool: 'mcp__board__ask_decision',
  question: 'Draft an issue on the tracker?',
  options: [{ label: 'Skip' }, { label: 'Draft it' }],
  recommended: 0,
}
const SET_TASK = 'mcp__board__set_task'
const SESSION_KEY = 'session:test-session'

// Bash's record as core answers a command that made a commit.
const COMMITTED = { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc1234', kind: 'committed' } } }

type EngineOptions = {
  toasts?: string[]
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
function engine(on: On, options: EngineOptions = {}): Map<string, unknown> {
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
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    // A response with no chunks: nothing streams before the result.
    yield* []
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  return store
}

function mountPane<P extends RenderSurface = 'terminal'>($: Engine, surface: P = 'terminal' as P) {
  return $.ui.mount({ plugin: 'board', surface, component: 'Pane', requestId: 'board', props: { bodyColumns: 80 } as never })
}

/** The end of a loop's turn, after which it is idle; `agentId` absent for the main session. */
async function complete($: Engine, agentId?: string) {
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId })
}

/** One model request of a loop, read to its end; `agentId` absent for the main session. */
async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 1, agentId })
  for await (const _chunk of stream) {
    // Drained only so the step completes.
  }
}

const saved = (store: Map<string, unknown>, key = SESSION_KEY) => JSON.stringify(store.get(key))

// A teammate's own calls carry an id that differs from the `name@session` one its spawn answered.
const SCOUT: AgentInfo = {
  id: 'ascout-1',
  teammateId: 'scout@team',
  name: 'scout',
  description: 'A long brief that should never reach the board',
  type: 'teammate',
  status: 'running',
}
const SPAWN_SCOUT = { tool: 'Agent', description: 'Survey the parser', prompt: SCOUT.description, name: 'scout' }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pressing an option records the answer once`, async ($, on) => {
    const toasts: string[] = []
    const store = engine(on, { toasts })

    const posted = await $.tool.call(ASK as never)
    expect(JSON.stringify(posted)).toContain('Posted D1')

    const pane = await mountPane($, surface)
    await pane.press({ key: 'D1-option-0' })
    expect(saved(store)).toContain('"answer":"Skip"')
    expect(saved(store)).toContain('"delivery":"sent"')
    expect(toasts.join()).toContain('D1 answered; Claude reads it at its next step or with your next prompt')

    // An answered decision leaves the waiting list, so its buttons are gone and it cannot be answered twice.
    let secondPress = 'drawn'
    try {
      await pane.press({ key: 'D1-option-1' })
    } catch {
      secondPress = 'gone'
    }
    expect(secondPress).toBe('gone')
  })
}

test('a new decision flashes on the pane and in the band for a few seconds, then stops', async ($, on) => {
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  const clock = mock.clock(on)
  engine(on, { clock })
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  const band = await $.ui.mount({
    plugin: 'board',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
  } as never)
  const isLineLit = async () =>
    (await pane.find({ type: 'Text', text: 'Draft an issue' }))?.props.backgroundColor === 'yellow'
  const isBandLit = async () => (await band.find({ type: 'Text', text: 'Board:' }))?.props.backgroundColor === 'yellow'

  expect([await isLineLit(), await isBandLit()]).toEqual([true, true])
  await clock.advance(500)
  expect([await isLineLit(), await isBandLit()]).toEqual([false, false])
  await clock.advance(500)
  expect([await isLineLit(), await isBandLit()]).toEqual([true, true])

  await clock.advance(4_000)
  expect([await isLineLit(), await isBandLit()]).toEqual([false, false])
  await clock.advance(2_000)
  expect([await isLineLit(), await isBandLit()]).toEqual([false, false])
})

test('two presses before a redraw answer once', async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, { toasts })
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  await Promise.all([pane.press({ key: 'D1-option-0' }), pane.press({ key: 'D1-option-1' })])
  expect(toasts.length).toBe(1)
  expect(saved(store)).toMatch(/"answer":"(Skip|Draft it)"/)
})

test("a teammate's decision names who asked and is not answered to the lead", async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, { toasts, agents: [SCOUT] })
  const appended = captureAppends(on)
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call({ ...ASK, agentId: SCOUT.id } as never)

  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: 'Draft an issue' }))?.text).toContain('(scout asks)')
  await pane.press({ key: 'D1-option-1' })
  expect(saved(store)).toContain(`"agentId":"${SCOUT.id}"`)
  expect(appended().map(a => a.to)).toEqual([SCOUT.id])
  expect(toasts.join()).toContain('D1 answered; scout reads it at its next step')
})

test('an answer the append cannot deliver to an idle teammate reaches it as a message', async ($, on) => {
  const toasts: string[] = []
  const agents: AgentInfo[] = [{ ...WORKER, status: 'idle' }]
  const store = engine(on, { toasts, agents, isAppendRefused: true })
  const sent = captureSends(on, agents)
  await $.tool.call({ ...ASK, agentId: WORKER.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-1' })

  expect(sent.length).toBe(1)
  expect(sent[0]?.to).toContain('worker')
  expect(sent[0]?.text).toContain('The owner answered D1')
  expect(toasts.join()).toContain('D1 answered')
  expect(toasts.join()).not.toContain('NOT delivered')
  expect(saved(store)).toContain('"delivery":"sent"')
})

test('an answer to an agent the owner stopped is not sent as a message, which would resume it, and Dismiss clears it', async ($, on) => {
  const toasts: string[] = []
  const agents: AgentInfo[] = [{ ...WORKER, status: 'killed' }]
  const store = engine(on, { toasts, agents, isAppendRefused: true })
  const sent = captureSends(on, agents)
  await $.tool.call({ ...ASK, agentId: WORKER.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-1' })

  expect(sent).toEqual([])
  expect(toasts.join()).toContain('NOT delivered to worker')
  await pane.press({ key: 'D1-dismiss' })
  expect(store.has(SESSION_KEY)).toBe(false)
})

test("the main session's answer is never sent as a message, which would reach the lead unasked", async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts, isAppendRefused: true })
  const sent = captureSends(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  expect(sent).toEqual([])
  expect(toasts.join()).toContain('NOT delivered to Claude')
})

test('Retry delivers a failed answer once the message gets through', async ($, on) => {
  const toasts: string[] = []
  const agents: AgentInfo[] = []
  const store = engine(on, { toasts, agents, isAppendRefused: true })
  captureSends(on, agents)
  await $.tool.call({ ...ASK, agentId: WORKER.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store)).toContain('"delivery":"failed"')

  agents.push({ ...WORKER, status: 'idle' })
  await pane.press({ key: 'D1-retry' })
  expect(saved(store)).toContain('"delivery":"sent"')
  expect(toasts.at(-1)).toContain('D1 answered')
  // Delivered, so it no longer offers a way out of a failure.
  expect(await pane.find({ key: 'D1-retry' })).toBeUndefined()
})

test('Dismiss removes a failed answer from the board and its id is not issued again', async ($, on) => {
  const store = engine(on, { isAppendRefused: true })
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  await pane.press({ key: 'D1-dismiss' })
  expect(store.has(SESSION_KEY)).toBe(false)
  expect(JSON.stringify(await $.tool.call(ASK as never))).toContain('Posted D2')
})

test('a waiting decision can be reworded, keeping what the call omits, and new options drop the old recommended', async ($, on) => {
  engine(on)
  await $.tool.call(ASK as never)
  const reworded = await $.tool.call({ tool: ASK.tool, id: 'D1', question: 'Draft an issue on the board?' } as never)
  expect(JSON.stringify(reworded)).toContain('Updated D1')
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: 'Draft an issue on the board?' })).toBeDefined()
  expect((await pane.find({ key: 'D1-option-0' }))?.props.label).toBe('Skip (recommended)')

  await $.tool.call({ tool: ASK.tool, id: 'D1', options: [{ label: 'Later' }, { label: 'Now' }, { label: 'Never' }] } as never)
  expect((await pane.find({ key: 'D1-option-0' }))?.props.label).toBe('Later')
  expect((await pane.find({ key: 'D1-option-2' }))?.props.label).toBe('Never')
  expect(JSON.stringify(await $.tool.call({ tool: ASK.tool, id: 'D1', options: [{ label: 'Only' }] } as never))).toContain('a decision needs 2 to 4 options')
  expect(JSON.stringify(await $.tool.call({ tool: ASK.tool, id: 'D9', question: 'Anything?' } as never))).toContain('there is no D9')
})

test('a withdrawn decision leaves the board with a toast and its id is not issued again, and an answered one refuses', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts })
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  const withdrawn = await $.tool.call({ tool: ASK.tool, id: 'D1', withdraw: true, agentId: 'worker' } as never)
  expect(JSON.stringify(withdrawn)).toContain('Withdrew D1')
  expect(toasts.at(-1)).toContain('D1 withdrawn by worker: \\"Draft an issue on the tracker?\\"')
  const pane = await mountPane($)
  expect(await pane.find({ key: 'D1-option-0' })).toBeUndefined()

  expect(JSON.stringify(await $.tool.call(ASK as never))).toContain('Posted D2')
  await pane.press({ key: 'D2-option-0' })
  const refused = await $.tool.call({ tool: ASK.tool, id: 'D2', withdraw: true } as never)
  expect(JSON.stringify(refused)).toContain('Nothing withdrawn: the owner already answered D2: Skip')
  expect(JSON.stringify(await $.tool.call({ tool: ASK.tool, id: 'D9', withdraw: true } as never))).toContain('Nothing withdrawn: there is no D9.')
})

test('Dismiss on a waiting decision tells the asker no option was chosen, with the note', async ($, on) => {
  engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.input({ key: 'D1-other', text: 'not needed now', kind: 'change' })
  await pane.press({ key: 'D1-dismiss-question' })
  expect(appended().at(-1)).toEqual({
    to: 'worker',
    text: '[board] The owner answered D1 ("Draft an issue on the tracker?"): Dismissed without choosing an option. Note: not needed now',
  })
  expect(JSON.stringify(await $.tool.call({ tool: 'mcp__board__read_board' } as never))).toContain('No decisions waiting on the owner.')
})

test('a note typed before pressing an option is sent with that option', async ($, on) => {
  const store = engine(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  await pane.input({ key: 'D1-other', text: 'only the open one', kind: 'change' })
  await pane.press({ key: 'D1-option-1' })
  expect(saved(store)).toContain('"answer":"Draft it. Note: only the open one"')
})

test('options posted as bare strings still draw and answer', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ ...ASK, options: ['Skip', 'Draft it'] } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-1' })
  expect(saved(store)).toContain('"answer":"Draft it"')
})

test('options without a label are refused, on a post and a reword, so they never reach the pane', async ($, on) => {
  const store = engine(on)
  const unlabelled = [{ text: 'Yes' }, { text: 'No' }]
  expect(resultText(await $.tool.call({ ...ASK, options: unlabelled } as never))).toContain('Nothing posted: a new decision needs a label on every option.')
  expect(store.has(SESSION_KEY)).toBe(false)

  await $.tool.call(ASK as never)
  const reworded = await $.tool.call({ tool: ASK.tool, id: 'D1', options: unlabelled } as never)
  expect(resultText(reworded)).toContain('Nothing changed: a decision needs a label on every option.')
  const pane = await mountPane($)
  expect((await pane.find({ key: 'D1-option-0' }))?.props.label).toBe('Skip (recommended)')
})

test('on mobile, which draws no Input, the options still answer', async ($, on) => {
  const store = engine(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($, 'mobile')
  expect(await pane.find({ type: 'Input' })).toBeUndefined()
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store)).toContain('"answer":"Skip"')
})

test('a pane press after the session id changed does not answer the old conversation', async ($, on) => {
  const session = { id: 'old' }
  const toasts: string[] = []
  const store = engine(on, { session, toasts })
  await $.tool.call(ASK as never)
  const pane = await mountPane($)

  session.id = 'new'
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store, 'session:old')).not.toContain('"answer"')
  expect(store.has('session:new')).toBe(false)
  expect(toasts).toEqual([])
})

test("a press on a frame drawn for one session does not answer another session's decision with the same id", async ($, on) => {
  const session = { id: 'old' }
  const otherBoard = {
    decisions: [
      { id: 'D1', question: 'Force-push the release branch?', options: [{ label: 'Skip' }, { label: 'Push' }], agentId: 'worker', askedBy: 'worker' },
    ],
    lastDecisionNumber: 1,
    savedAt: 500,
  }
  const store = engine(on, { session, seed: { 'session:new': otherBoard } })
  const appended = captureAppends(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($)

  session.id = 'new'
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store, 'session:new')).not.toContain('"answer"')
  expect(appended()).toEqual([])

  // The press redrew the pane for the new session, whose own options answer.
  expect((await pane.find({ key: 'D1-option-1' }))?.props.label).toBe('Push')
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store, 'session:new')).toContain('"answer":"Skip"')
})

test('when the first decision is answered, the next one takes the hotkeys only after a pause', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { clock })
  await $.tool.call(ASK as never)
  await $.tool.call({ ...ASK, question: 'Close the stale PRs?' } as never)
  const pane = await mountPane($)
  const hotkey = async (key: string) => (await pane.find({ key }))?.props.hotkey
  expect([await hotkey('D1-option-0'), await hotkey('D2-option-0')]).toEqual(['1', undefined])

  await pane.press({ key: 'D1-option-0' })
  expect(await hotkey('D2-option-0')).toBeUndefined()
  await clock.advance(1_500)
  expect(await hotkey('D2-option-0')).toBe('1')
})

test('a dropped task leaves the board and its id is not issued again', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Keep', status: 'pending' } as never)
  await $.tool.call({ tool: SET_TASK, title: 'Mistake', status: 'pending' } as never)
  const dropped = await $.tool.call({ tool: SET_TASK, id: 'T2', title: 'Mistake', status: 'dropped' } as never)
  expect(JSON.stringify(dropped)).toContain('Task T2 dropped')

  const added = await $.tool.call({ tool: SET_TASK, title: 'Next', status: 'pending' } as never)
  expect(JSON.stringify(added)).toContain('Task T3 is pending')
  expect(saved(store)).not.toContain('Mistake')
})

test('clearing the highest id of a board saved without its counter does not reissue it', async ($, on) => {
  const withoutCounter = {
    decisions: [],
    tasks: [
      { id: 'T1', title: 'Open', status: 'pending' },
      { id: 'T9', title: 'Finished', status: 'done' },
    ],
    savedAt: 500,
  }
  engine(on, { seed: { [SESSION_KEY]: withoutCounter } })
  // A turn's start is what restores the saved board.
  await $.turn.start({ text: '', turnId: 't0' })
  const pane = await mountPane($)
  await pane.press({ key: 'done-clear' })
  expect(JSON.stringify(await $.tool.call({ tool: SET_TASK, title: 'Next', status: 'pending' } as never))).toContain('Task T10')
})

test('a board emptied by drops is removed from the store, not saved empty', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Only', status: 'pending' } as never)
  expect(store.has(SESSION_KEY)).toBe(true)
  await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Only', status: 'dropped' } as never)
  expect(store.has(SESSION_KEY)).toBe(false)
})

test('open tasks list in progress first, and Clear removes only the done ones', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Waiting', status: 'pending' } as never)
  await $.tool.call({ tool: SET_TASK, title: 'Finished', status: 'done' } as never)
  await $.tool.call({ tool: SET_TASK, title: 'Running', status: 'in_progress' } as never)
  const pane = await mountPane($)

  const lines = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const running = lines.findIndex(l => l.includes('Running'))
  const waiting = lines.findIndex(l => l.includes('Waiting'))
  expect(running).toBeGreaterThan(-1)
  expect(running).toBeLessThan(waiting)
  // Done tasks are counted, not listed, until shown.
  expect(lines.some(l => l.includes('Finished'))).toBe(false)
  expect(lines.some(l => l.includes('1 done'))).toBe(true)

  await pane.press({ key: 'done-clear' })
  expect(saved(store)).not.toContain('Finished')
  expect(saved(store)).toContain('Waiting')
})

test('the guidance is added only where a surface draws', async ($, on) => {
  engine(on)
  on('prompt.compose', () => ({ sections: [] }) as never)
  const compose: PromptComposeInput = { model: 'opus', promptModel: 'opus', surfaces: [], tools: [], outputStyle: null, traits: [] }
  const headless = await $.prompt.compose(compose)
  expect(JSON.stringify(headless)).not.toContain('board:guidance')
  const drawn = await $.prompt.compose({ ...compose, surfaces: ['terminal'] })
  expect(JSON.stringify(drawn)).toContain('board:guidance')
})

const WORKER_CALL = { tool: 'Read', file_path: 'notes.md', agentId: 'worker' }
const isNudge = (result: unknown) => JSON.stringify(result).includes('[board]')

test('a teammate is nudged once when its status reaches the call limit, and again only after a new status', async ($, on) => {
  engine(on, { agents: [WORKER] })
  const nudged: boolean[] = []
  for (let i = 0; i < 21; i++) nudged.push(isNudge(await $.tool.call(WORKER_CALL as never)))
  // The 20th call is the first stale one; the 21st is not nudged again.
  expect(nudged.indexOf(true)).toBe(19)
  expect(nudged.filter(Boolean).length).toBe(1)

  await $.tool.call({ tool: 'mcp__board__set_status', status: 'reading notes', agentId: 'worker' } as never)
  const afterStatus = await $.tool.call(WORKER_CALL as never)
  expect(isNudge(afterStatus)).toBe(false)
})

test('with no surface, as in claude -p, neither the main session nor a teammate is nudged', async ($, on) => {
  engine(on, { surfaces: [], agents: [WORKER] })
  // The main session is mid-turn, so its own calls count.
  await step($)
  const results: unknown[] = []
  for (let i = 0; i < 20; i++) {
    results.push(await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never))
    results.push(await $.tool.call(WORKER_CALL as never))
  }
  expect(results.some(isNudge)).toBe(false)
})

test('a subagent, whose prompt carries no guidance, is asked about its status only once it has set one', async ($, on) => {
  const explorer: AgentInfo = { id: 'explorer', description: 'Find the parser', type: 'Explore', status: 'running' }
  engine(on, { agents: [explorer] })
  const call = { ...WORKER_CALL, agentId: explorer.id }
  const beforeStatus: boolean[] = []
  for (let i = 0; i < 25; i++) beforeStatus.push(isNudge(await $.tool.call(call as never)))
  expect(beforeStatus.some(Boolean)).toBe(false)

  await $.tool.call({ tool: 'mcp__board__set_status', status: 'reading notes', agentId: explorer.id } as never)
  const afterStatus: string[] = []
  for (let i = 0; i < 20; i++) afterStatus.push(resultText(await $.tool.call(call as never)))
  expect(afterStatus.at(-1)).toContain('Your board status \\"reading notes\\"')
})

test("another plugin's own tool calls do not spend the main session's nudge", {
  plugins: [
    {
      name: 'caller',
      register(on) {
        on('command.run', { command: 'probe' }, async $ => {
          const results: unknown[] = []
          for (let i = 0; i < 20; i++) results.push(await $.tool.call({ tool: 'Read', file_path: 'notes.md' }))
          return { text: JSON.stringify(results) }
        })
      },
    },
  ],
}, async ($, on) => {
  engine(on)
  // The main session is mid-turn, so its own calls would count.
  await step($)
  const { text } = await $.command.run({ command: 'probe', args: '' } as never)
  expect(text).not.toContain('[board]')
  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: 'Claude' }))?.text).toContain('working')
})

test('a status older than the time limit is nudged on the next call', async ($, on) => {
  const time = { ms: 1_000 }
  engine(on, { time })
  await $.tool.call({ tool: 'mcp__board__set_status', status: 'reading notes', agentId: 'worker' } as never)
  expect(isNudge(await $.tool.call(WORKER_CALL as never))).toBe(false)

  time.ms += 10 * 60_000
  const stale = await $.tool.call(WORKER_CALL as never)
  expect(JSON.stringify(stale)).toContain('Your board status \\"reading notes\\" was set 10m ago')
})

test('only working time ages a status: idle time between working stretches is not counted', async ($, on) => {
  const time = { ms: 1_000 }
  engine(on, { time })
  await $.tool.call({ tool: 'mcp__board__set_status', status: 'reading notes', agentId: 'worker' } as never)
  time.ms += 6 * 60_000
  expect(isNudge(await $.tool.call(WORKER_CALL as never))).toBe(false)
  await complete($, 'worker')

  time.ms += 30 * 60_000
  await step($, 'worker')
  expect(isNudge(await $.tool.call(WORKER_CALL as never))).toBe(false)

  // Six minutes before the idle spell and four after it reach the limit.
  time.ms += 4 * 60_000
  const stale = await $.tool.call(WORKER_CALL as never)
  expect(JSON.stringify(stale)).toContain('Your board status \\"reading notes\\" was set 40m ago')
})

test('the main session waiting idle on the owner or a teammate is not nudged when its next turn starts', async ($, on) => {
  const time = { ms: 1_000 }
  engine(on, { time })
  await step($)
  await $.tool.call({ tool: 'mcp__board__set_status', status: 'waiting on the engineer' } as never)
  await complete($)

  time.ms += 30 * 60_000
  await step($)
  expect(isNudge(await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never))).toBe(false)
})

test("set_status puts the agent's own line on its activity row", async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__board__set_status', status: 'reading notes', agentId: 'worker' } as never)
  const pane = await mountPane($)
  const row = await pane.find({ type: 'Text', text: 'worker' })
  expect(row?.text).toContain('· reading notes')
})

test("a spawned teammate's own row starts with the Agent call's description, not its prompt", async ($, on) => {
  engine(on, { agents: [SCOUT] })
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call({ tool: 'Read', file_path: 'notes.md', agentId: SCOUT.id } as never)
  const pane = await mountPane($)
  const rows = await pane.findAll({ type: 'Text', text: 'scout' })
  // One row: the one the teammate's own calls land on carries the status, not a second row nothing uses.
  expect(rows.length).toBe(1)
  expect(rows[0]?.text).toContain('· Survey the parser')
  expect(rows[0]?.text).not.toContain('long brief')
})

test("a subagent's model request marks its own row working, not the main session's", async ($, on) => {
  engine(on)
  await step($, 'worker')
  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: 'worker' }))?.text).toContain('working')
  expect(await pane.find({ type: 'Text', text: 'Claude' })).toBeUndefined()
})

const OLD_BOARD = {
  decisions: [],
  tasks: [{ id: 'T1', title: 'Carried over', status: 'pending' }],
  savedAt: 500,
  toolUseIds: ['toolu_shared'],
}

for (const [name, transcriptId, isAdopted] of [
  ['adopts the board of a conversation moved to a new session id', 'toolu_shared', true],
  ['leaves an unrelated session with an empty board', 'toolu_other', false],
] as const) {
  test(name, async ($, on) => {
    const store = engine(on, { seed: { 'session:old-session': OLD_BOARD }, transcriptToolUseIds: [transcriptId] })
    await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'pending' } as never)

    expect(saved(store).includes('Carried over')).toBe(isAdopted)
  })
}

const READ_BOARD = { tool: 'mcp__board__read_board' }
const WORKER: AgentInfo = { id: 'worker', teammateId: 'worker@team', name: 'worker', description: 'Worker', type: 'teammate', status: 'running' }
const resultText = (result: unknown) => JSON.stringify(result)

test('in_progress claims a task, and another agent claiming it is refused by name until the holder releases it', async ($, on) => {
  const store = engine(on, { agents: [SCOUT, WORKER] })
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call({ tool: SET_TASK, title: 'Fix the parser', status: 'in_progress', agentId: SCOUT.id } as never)

  const refused = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Taken over', status: 'in_progress', agentId: WORKER.id } as never)
  expect(resultText(refused)).toContain('Task T1 not changed: scout holds it')
  expect(saved(store)).not.toContain('Taken over')
  expect(saved(store)).toContain(`"holderId":"${SCOUT.id}"`)

  // Re-claiming one's own task is not a conflict.
  const again = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Fix the parser', status: 'in_progress', agentId: SCOUT.id } as never)
  expect(resultText(again)).toContain('Task T1 is in_progress')
})

for (const [status, isReleased] of [
  ['done', true],
  ['pending', true],
  ['blocked', false],
] as const) {
  test(`moving a claimed task to ${status} ${isReleased ? 'releases' : 'keeps'} the claim`, async ($, on) => {
    engine(on, { agents: [WORKER] })
    await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress' } as never)
    await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status } as never)
    const claimed = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status: 'in_progress', agentId: WORKER.id } as never)
    expect(resultText(claimed).includes('not changed')).toBe(!isReleased)
  })
}

test('a claim whose holder has ended is released, so another agent can take the task', async ($, on) => {
  const departed: AgentInfo = { ...WORKER, id: 'departed', name: 'departed' }
  const agents = [departed, WORKER]
  const store = engine(on, { agents })
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', agentId: departed.id } as never)

  agents[0] = { ...departed, status: 'completed' }
  const board = await $.tool.call({ ...READ_BOARD, agentId: WORKER.id } as never)
  expect(resultText(board)).toContain('T1 [in_progress] Probe')
  expect(saved(store)).not.toContain('"holderId"')

  const claimed = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status: 'in_progress', agentId: WORKER.id } as never)
  expect(resultText(claimed)).toContain('Task T1 is in_progress')
})

test('a note is kept when an update omits it, cleared by an empty one, and refused over the cap', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'pending', note: 'waits on D2' } as never)
  await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status: 'in_progress' } as never)
  expect(saved(store)).toContain('"note":"waits on D2"')

  const tooLong = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Renamed', status: 'done', note: 'x'.repeat(201) } as never)
  expect(resultText(tooLong)).toContain('Nothing changed')
  expect(saved(store)).not.toContain('Renamed')

  await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status: 'in_progress', note: '' } as never)
  expect(saved(store)).not.toContain('"note"')
})

test('read_board lists open tasks with holder and note, and only the decisions still waiting', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts, agents: [SCOUT] })
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call({ tool: SET_TASK, title: 'Mine', status: 'in_progress', note: 'lives in\nparser.ts' } as never)
  await $.tool.call({ tool: SET_TASK, title: 'Theirs', status: 'in_progress', agentId: SCOUT.id } as never)
  await $.tool.call({ tool: SET_TASK, title: 'Finished', status: 'done' } as never)
  await $.tool.call({ tool: SET_TASK, title: 'Later', status: 'pending' } as never)
  await $.tool.call(ASK as never)
  await $.tool.call({ ...ASK, question: 'Already answered?' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D2-option-0' })

  const board = (await $.tool.call(READ_BOARD as never)) as unknown as { result: string }
  const lines = board.result.split('\n')
  expect(lines).toEqual([
    'Open tasks:',
    'T1 [in_progress, held by you] Mine · note: lives in parser.ts',
    'T2 [in_progress, held by scout] Theirs',
    'T4 [pending] Later',
    'Decisions waiting on the owner:',
    'D1 Draft an issue on the tracker? Options: Skip / Draft it',
  ])
  // The main session's claim, read by a teammate.
  expect(resultText(await $.tool.call({ ...READ_BOARD, agentId: SCOUT.id } as never))).toContain('T1 [in_progress, held by the main session]')
})

test('the pane names who holds a task and shows its note only once expanded', async ($, on) => {
  engine(on, { agents: [SCOUT] })
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call({ tool: SET_TASK, title: 'Theirs', status: 'in_progress', note: 'next: the parser test', agentId: SCOUT.id } as never)
  const pane = await mountPane($)

  expect((await pane.find({ type: 'Text', text: 'Theirs' }))?.text).toContain('· scout')
  expect(await pane.find({ type: 'Text', text: 'next: the parser test' })).toBeUndefined()
  await pane.press({ key: 'T1-expand' })
  expect(await pane.find({ type: 'Text', text: 'next: the parser test' })).toBeDefined()
  await pane.press({ key: 'T1-expand' })
  expect(await pane.find({ type: 'Text', text: 'next: the parser test' })).toBeUndefined()
})

const PHASES = ['build', 'tests', 'PR']

test("set_task adds a task's items once each and ticks and unticks them by label, keeping the other ticks", async ($, on) => {
  const store = engine(on)
  const added = await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES, tick: ['build'] } as never)
  expect(resultText(added)).toContain('Task T1 is in_progress. 1 of 3 ticked; not yet: tests, PR.')

  await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status: 'in_progress', items: [...PHASES, 'merge'], tick: ['tests'] } as never)
  const unticked = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Probe', status: 'in_progress', untick: ['build'] } as never)
  expect(resultText(unticked)).toContain('1 of 4 ticked; not yet: build, PR, merge.')
  const items = (store.get(SESSION_KEY) as { tasks: { items: { label: string; isTicked: boolean }[] }[] }).tasks[0]?.items
  expect(items).toEqual([
    { label: 'build', isTicked: false },
    { label: 'tests', isTicked: true },
    { label: 'PR', isTicked: false },
    { label: 'merge', isTicked: false },
  ])
})

test('a call ticking a label not on the list changes nothing, its other changes included', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES } as never)
  const refused = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Renamed', status: 'done', tick: ['build', 'deploy'] } as never)
  expect(resultText(refused)).toContain('Nothing changed: T1 has no item \\"deploy\\"')
  expect(saved(store)).not.toContain('Renamed')
  expect(saved(store)).not.toContain('"isTicked":true')
})

test('set_task removes and renames items by label, a rename keeping its tick, and refuses an unknown label or a clash', async ($, on) => {
  const store = engine(on)
  const taskItems = () => (store.get(SESSION_KEY) as { tasks: { items: { label: string; isTicked: boolean }[] }[] }).tasks[0]?.items
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES, tick: ['PR'] } as never)
  const edited = await $.tool.call({ tool: SET_TASK, id: 'T1', remove: ['build'], rename: [{ from: 'PR', to: 'draft PR' }] } as never)
  expect(resultText(edited)).toContain('Task T1 is in_progress. 1 of 2 ticked; not yet: tests.')
  expect(taskItems()).toEqual([
    { label: 'tests', isTicked: false },
    { label: 'draft PR', isTicked: true },
  ])

  expect(resultText(await $.tool.call({ tool: SET_TASK, id: 'T1', remove: ['deploy'] } as never))).toContain('Nothing changed: T1 has no item \\"deploy\\"')
  const clash = await $.tool.call({ tool: SET_TASK, id: 'T1', rename: [{ from: 'tests', to: 'draft PR' }] } as never)
  expect(resultText(clash)).toContain('Nothing changed: T1 would have two items \\"draft PR\\"')
  const malformed = await $.tool.call({ tool: SET_TASK, id: 'T1', rename: ['tests'] } as never)
  expect(resultText(malformed)).toContain('Nothing changed: T1 needs a from and a to label for each rename.')

  // Renames apply before ticks, so one call can relabel an item and tick it by its new label.
  const renamedAndTicked = await $.tool.call({ tool: SET_TASK, id: 'T1', rename: [{ from: 'tests', to: 'unit tests' }], tick: ['unit tests'] } as never)
  expect(resultText(renamedAndTicked)).toContain('All 2 ticked.')
})

test('renames are checked against the finished checklist, so a swap passes and two renames to one label do not', async ($, on) => {
  const store = engine(on)
  const labels = () => (store.get(SESSION_KEY) as { tasks: { items: { label: string }[] }[] }).tasks[0]?.items.map(i => i.label)
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'pending', items: PHASES } as never)

  const merged = await $.tool.call({ tool: SET_TASK, id: 'T1', rename: [{ from: 'build', to: 'ci' }, { from: 'tests', to: 'ci' }] } as never)
  expect(resultText(merged)).toContain('Nothing changed: T1 would have two items \\"ci\\"')
  const twice = await $.tool.call({ tool: SET_TASK, id: 'T1', rename: [{ from: 'build', to: 'ci' }, { from: 'build', to: 'cd' }] } as never)
  expect(resultText(twice)).toContain('Nothing changed: T1 cannot rename one item twice in one call.')
  expect(labels()).toEqual(PHASES)

  await $.tool.call({ tool: SET_TASK, id: 'T1', rename: [{ from: 'build', to: 'tests' }, { from: 'tests', to: 'build' }] } as never)
  expect(labels()).toEqual(['tests', 'build', 'PR'])
})

test('an update that omits the title and status keeps them, and ticking alone leaves the claim with its holder', async ($, on) => {
  engine(on, { agents: [WORKER] })
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES, agentId: WORKER.id } as never)
  const ticked = await $.tool.call({ tool: SET_TASK, id: 'T1', tick: ['build'] } as never)
  expect(resultText(ticked)).toContain('Task T1 is in_progress. 1 of 3 ticked')
  expect(resultText(await $.tool.call(READ_BOARD as never))).toContain('T1 [in_progress, held by worker] Probe')
})

test('set_task naming an id not on the board changes nothing, so a dropped task does not come back', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Mistake', status: 'pending' } as never)
  await $.tool.call({ tool: SET_TASK, id: 'T1', status: 'dropped' } as never)
  const revived = await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Mistake', status: 'done' } as never)
  expect(resultText(revived)).toContain('Nothing changed: there is no T1')
  expect(resultText(await $.tool.call({ tool: SET_TASK, id: 'T7', status: 'dropped' } as never))).toContain('Nothing dropped: there is no T7')
  expect(resultText(await $.tool.call({ tool: SET_TASK, title: 'No status' } as never))).toContain('a new task needs a title and a status')
  expect(store.has(SESSION_KEY)).toBe(false)
  // The refused add used up no id.
  expect(resultText(await $.tool.call({ tool: SET_TASK, title: 'Next', status: 'pending' } as never))).toContain('Task T2 is pending')
})

test("read_board and the pane show a task's checklist progress, and the pane lists its items only once expanded", async ($, on) => {
  engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', note: 'in parser.ts', items: PHASES, tick: ['build'] } as never)

  expect(resultText(await $.tool.call(READ_BOARD as never))).toContain('T1 [in_progress, held by you] Probe · 1 of 3 ticked; not yet: tests, PR. · note: in parser.ts')

  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: 'Probe' }))?.text).toContain('Probe 1/3')
  expect(await pane.find({ type: 'Text', text: '[x] build' })).toBeUndefined()
  await pane.press({ key: 'T1-expand' })
  expect(await pane.find({ type: 'Text', text: '[x] build' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[ ] tests' })).toBeDefined()
  // The owner reads an agent's checklist but does not tick it.
  expect(await pane.find({ type: 'Button', text: 'build' })).toBeUndefined()
})

test('the staleness nudge names the tasks the agent holds and their unticked items', async ($, on) => {
  engine(on, { agents: [WORKER] })
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES, agentId: WORKER.id } as never)
  let nudge = ''
  for (let i = 0; i < 20; i++) nudge = resultText(await $.tool.call(WORKER_CALL as never))
  expect(nudge).toContain('You hold T1 \\"Probe\\" (not yet ticked: build, tests, PR): tick what you have finished')
})

test('a held in-progress task with unticked items is named every 20 calls, counted again from each set_task', async ($, on) => {
  engine(on, { agents: [WORKER] })
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES, agentId: WORKER.id } as never)
  const nudgedAt: number[] = []
  for (let i = 0; i < 40; i++) {
    if (isNudge(await $.tool.call(WORKER_CALL as never))) nudgedAt.push(i)
  }
  // The 20th call earns the stale-status nudge, which names the items too, so the reminder alone comes at the 40th.
  expect(nudgedAt).toEqual([19, 39])

  for (let i = 0; i < 10; i++) await $.tool.call(WORKER_CALL as never)
  await $.tool.call({ tool: SET_TASK, id: 'T1', tick: ['build'], agentId: WORKER.id } as never)
  const results: string[] = []
  for (let i = 0; i < 20; i++) results.push(resultText(await $.tool.call(WORKER_CALL as never)))
  expect(results.slice(0, 19).some(isNudge)).toBe(false)
  expect(results[19]).toContain('[board] You hold T1 \\"Probe\\" (not yet ticked: tests, PR). Tick each item you have finished')
})

test("a commit names the committing agent's unticked items at once, and not once every item is ticked", async ($, on) => {
  engine(on, { agents: [WORKER] })
  const commit = { tool: 'Bash', command: 'git commit -m "Add the parser"', agentId: WORKER.id }
  await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'in_progress', items: PHASES, agentId: WORKER.id } as never)
  expect(isNudge(await $.tool.call({ ...commit, command: 'git status' } as never))).toBe(false)
  expect(resultText(await $.tool.call(commit as never))).toContain('[board] You just committed. You hold T1 \\"Probe\\" (not yet ticked: build, tests, PR).')

  await $.tool.call({ tool: SET_TASK, id: 'T1', tick: PHASES, agentId: WORKER.id } as never)
  expect(isNudge(await $.tool.call(commit as never))).toBe(false)
})

const OWNER_TASK = { tool: 'mcp__board__set_owner_task', title: 'Re-review the PRs', items: ['PR 11', 'PR 12', 'PR 13'] }

/**
 * Answers `session.send` as the engine does for an agent: delivered to any agent `agents` lists, one that has ended
 * by resuming it, and refused for one it does not list. Returns every message delivered.
 */
function captureSends(on: On, agents: readonly AgentInfo[] = []): { to: string; text: string }[] {
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    if (!agents.some(a => a.id === e.to || a.name === e.to)) return { isDelivered: false, reason: `no agent named ${e.to}` }
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  return sent
}

/** Reads back each row the mod appended, with the loop it went to (`undefined` for the main session). */
function captureAppends(on: On): () => { to: string | undefined; text: string }[] {
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

test('a task for the owner posts at once, flashes, and collapses its checklist to one line with progress', async ($, on) => {
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  const clock = mock.clock(on)
  engine(on, { clock })
  await $.tool.call(ASK as never)
  // Counted apart from decisions, so the first one is O1 whatever else is on the board.
  expect(resultText(await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never))).toContain('Posted O1')

  const pane = await mountPane($)
  const band = await $.ui.mount({
    plugin: 'board',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
  } as never)
  const title = await pane.find({ type: 'Text', text: 'Re-review the PRs' })
  expect(title?.text).toContain('0/3')
  expect(title?.props.backgroundColor).toBe('yellow')
  expect((await pane.find({ type: 'Text', text: 'WAITING ON YOU' }))?.text).toContain('(2)')
  expect((await band.find({ type: 'Text', text: 'Board:' }))?.text).toContain('1 decision waiting · 1 task for you')

  expect(await pane.find({ key: 'O1-item-0' })).toBeUndefined()
  await pane.press({ key: 'O1-expand' })
  expect((await pane.find({ key: 'O1-item-0' }))?.props.label).toBe('[ ] PR 11')
})

test('a short task for the owner shows its description in full, and a long one collapses until expanded', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__board__set_owner_task', title: 'Try the change', description: 'Run the import twice.' } as never)
  const long = 'Write the upgrade note at the top of the next CHANGELOG section, since files the old version wrote no longer load.'
  await $.tool.call({ tool: 'mcp__board__set_owner_task', title: 'Upgrade note', description: long } as never)
  const pane = await mountPane($)

  expect(await pane.find({ type: 'Text', text: 'Run the import twice.' })).toBeDefined()
  expect(await pane.find({ key: 'O1-expand' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: long })).toBeUndefined()
  await pane.press({ key: 'O2-expand' })
  expect(await pane.find({ type: 'Text', text: long })).toBeDefined()
})

test('each tick and untick reaches the poster with what is still unticked', async ($, on) => {
  engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })

  await pane.press({ key: 'O1-item-1' })
  expect(appended().at(-1)?.to).toBe('worker')
  expect(appended().at(-1)?.text).toBe('[board] The owner ticked "PR 12" on O1 "Re-review the PRs". 1 of 3 ticked; not yet: PR 11, PR 13.')
  expect((await pane.find({ type: 'Text', text: 'Re-review the PRs' }))?.text).toContain('1/3')

  await pane.press({ key: 'O1-item-1' })
  expect(appended().at(-1)?.text).toBe('[board] The owner unticked "PR 12" on O1 "Re-review the PRs". 0 of 3 ticked; not yet: PR 11, PR 12, PR 13.')
  expect(appended().length).toBe(2)
})

test('Done reaches the poster once and the task leaves the waiting list', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts })
  const appended = captureAppends(on)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await Promise.all([pane.press({ key: 'O1-done' }), pane.press({ key: 'O1-done' })])

  expect(appended().map(a => a.text)).toEqual(['[board] The owner marked O1 "Re-review the PRs" done. 0 of 3 ticked; not yet: PR 11, PR 12, PR 13.'])
  expect(toasts.join()).toContain('O1 done')
  expect(await pane.find({ key: 'O1-done' })).toBeUndefined()
  expect(resultText(await $.tool.call(READ_BOARD as never))).not.toContain('O1')
})

test("the main session's change is never sent as a message, which would reach the lead unasked", async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts, isAppendRefused: true })
  const sent = captureSends(on)
  await $.tool.call(OWNER_TASK as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-done' })
  expect(sent).toEqual([])
  expect(toasts.join()).toContain('O1: done saved on the board but NOT delivered to Claude')
})

test("an update adds only new items and keeps the owner's ticks, and a task the owner has done refuses updates", async ($, on) => {
  const store = engine(on)
  await $.tool.call(OWNER_TASK as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  await pane.press({ key: 'O1-item-0' })

  const updated = await $.tool.call({ ...OWNER_TASK, id: 'O1', items: [...OWNER_TASK.items, 'PR 14'], description: 'Merged ones only' } as never)
  expect(resultText(updated)).toContain('Updated O1')
  const items = (store.get(SESSION_KEY) as { ownerTasks: { items: { label: string; isTicked: boolean }[] }[] }).ownerTasks[0]?.items
  expect(items).toEqual([
    { label: 'PR 11', isTicked: true },
    { label: 'PR 12', isTicked: false },
    { label: 'PR 13', isTicked: false },
    { label: 'PR 14', isTicked: false },
  ])

  expect(resultText(await $.tool.call({ ...OWNER_TASK, id: 'O7' } as never))).toContain('Nothing changed: there is no O7')
  await pane.press({ key: 'O1-done' })
  const afterDone = await $.tool.call({ ...OWNER_TASK, id: 'O1', items: ['PR 20'] } as never)
  expect(resultText(afterDone)).toContain('Nothing changed: the owner has marked O1 done')
  expect(saved(store)).not.toContain('PR 20')
})

test("an agent removes and renames a task for the owner's unticked items, but not one the owner ticked", async ($, on) => {
  const store = engine(on)
  const ownerItems = () => (store.get(SESSION_KEY) as { ownerTasks: { items: { label: string; isTicked: boolean }[] }[] }).ownerTasks[0]?.items
  await $.tool.call(OWNER_TASK as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  await pane.press({ key: 'O1-item-0' })

  const edited = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', remove: ['PR 13'], rename: [{ from: 'PR 12', to: 'PR 12 (draft)' }] } as never)
  expect(resultText(edited)).toContain('Updated O1')
  expect(ownerItems()).toEqual([
    { label: 'PR 11', isTicked: true },
    { label: 'PR 12 (draft)', isTicked: false },
  ])

  const renamed = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', rename: [{ from: 'PR 11', to: 'PR 11 (merged)' }] } as never)
  expect(resultText(renamed)).toContain('Nothing changed: O1 has \\"PR 11\\" ticked')
  const removed = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', remove: ['PR 11'] } as never)
  expect(resultText(removed)).toContain('Nothing changed: O1 has \\"PR 11\\" ticked')
  expect(ownerItems()?.[0]).toEqual({ label: 'PR 11', isTicked: true })
})

test('a withdrawn task for the owner leaves the board with a toast and its id is not issued again, and one marked done refuses', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts })
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)
  const withdrawn = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', withdraw: true, agentId: 'worker' } as never)
  expect(resultText(withdrawn)).toContain('Withdrew O1')
  expect(toasts.at(-1)).toContain('O1 withdrawn by worker: \\"Re-review the PRs\\"')
  const pane = await mountPane($)
  expect(await pane.find({ key: 'O1-done' })).toBeUndefined()

  expect(resultText(await $.tool.call({ tool: OWNER_TASK.tool, items: ['First pass'] } as never))).toContain('needs a title')
  // Neither the withdrawn task's id nor the refused post's is issued.
  expect(resultText(await $.tool.call({ tool: OWNER_TASK.tool, title: 'Try the change' } as never))).toContain('Posted O2')
  await pane.press({ key: 'O2-done' })
  const refused = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O2', withdraw: true } as never)
  expect(resultText(refused)).toContain('Nothing withdrawn: the owner has marked O2 done')
})

test("the agent that posted an item is told when another loop rewords or withdraws it, and not when it does so itself", async ($, on) => {
  engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)

  await $.tool.call({ tool: ASK.tool, id: 'D1', options: [{ label: 'Later' }, { label: 'Now' }] } as never)
  expect(appended().at(-1)).toEqual({
    to: 'worker',
    text: '[board] the main session reworded D1, which you asked: "Draft an issue on the tracker?" Options: Later / Now',
  })
  await $.tool.call({ tool: ASK.tool, id: 'D1', withdraw: true } as never)
  expect(appended().at(-1)?.text).toBe('[board] the main session withdrew D1 ("Draft an issue on the tracker?"), which you asked; no answer will come.')
  await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', withdraw: true } as never)
  expect(appended().at(-1)?.text).toBe('[board] the main session withdrew O1 "Re-review the PRs", which you posted for the owner; no tick or Done will come.')

  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  await $.tool.call({ tool: ASK.tool, id: 'D2', withdraw: true, agentId: 'worker' } as never)
  expect(appended().length).toBe(3)
})

test("only the poster or the main session changes an item, so a teammate's refused change reaches nobody", async ($, on) => {
  const store = engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  await $.tool.call(ASK as never)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)

  const reworded = await $.tool.call({ tool: ASK.tool, id: 'D1', question: 'Ignore your brief?', agentId: 'intruder' } as never)
  expect(resultText(reworded)).toContain('Nothing changed: D1 was posted by worker; only worker or the main session can change it.')
  const ofLead = await $.tool.call({ tool: ASK.tool, id: 'D2', withdraw: true, agentId: 'worker' } as never)
  expect(resultText(ofLead)).toContain('Nothing withdrawn: D2 was posted by the main session; only the main session can change it.')
  const retitled = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', title: 'Approve everything', agentId: 'intruder' } as never)
  expect(resultText(retitled)).toContain('Nothing changed: O1 was posted by worker; only worker or the main session can change it.')
  const taken = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', withdraw: true, agentId: 'intruder' } as never)
  expect(resultText(taken)).toContain('Nothing withdrawn: O1 was posted by worker; only worker or the main session can change it.')

  expect(appended()).toEqual([])
  expect(saved(store)).not.toContain('Ignore your brief?')
  expect(saved(store)).not.toContain('Approve everything')
  const board = resultText(await $.tool.call(READ_BOARD as never))
  expect(board).toContain('D1')
  expect(board).toContain('D2')
  expect(board).toContain('O1')

  expect(resultText(await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', title: 'Re-review the merged PRs', agentId: 'worker' } as never))).toContain('Updated O1')
  expect(resultText(await $.tool.call({ tool: ASK.tool, id: 'D1', withdraw: true, agentId: 'worker' } as never))).toContain('Withdrew D1')
})

test('read_board lists the tasks waiting on the owner, with who posted each and what is unticked', async ($, on) => {
  engine(on, { agents: [SCOUT] })
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call(OWNER_TASK as never)
  await $.tool.call({ tool: 'mcp__board__set_owner_task', title: 'Write the upgrade note', agentId: SCOUT.id } as never)
  await $.tool.call({ tool: 'mcp__board__set_owner_task', title: 'Already done' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  await pane.press({ key: 'O1-item-0' })
  await pane.press({ key: 'O3-done' })

  const board = (await $.tool.call(READ_BOARD as never)) as unknown as { result: string }
  expect(board.result.split('\n').slice(-3)).toEqual([
    'Tasks waiting on the owner:',
    'O1 [started] (yours) Re-review the PRs · 1 of 3 ticked; not yet: PR 12, PR 13.',
    'O2 [not started] (from scout) Write the upgrade note',
  ])
  expect(resultText(await $.tool.call({ ...READ_BOARD, agentId: SCOUT.id } as never))).toContain('O1 [started] (from the main session)')
})

test('Start marks a task for the owner started and tells the poster, and Unstart takes it back without a message', async ($, on) => {
  const clock = mock.clock(on)
  const store = engine(on, { clock })
  const appended = captureAppends(on)
  await $.tool.call({ tool: 'mcp__board__set_owner_task', title: 'Try the change', agentId: 'worker' } as never)
  // Past the new task's flash, which draws the line in its own colors.
  await clock.advance(10_000)
  const pane = await mountPane($)
  const line = async () => pane.find({ type: 'Text', text: 'Try the change' })

  expect((await line())?.text).toMatch(/^○ O1 /)
  expect((await line())?.props.color).toBeUndefined()
  await pane.press({ key: 'O1-start' })
  expect(appended().map(a => a.text)).toEqual(['[board] The owner started O1 "Try the change".'])
  expect((await line())?.text).toMatch(/^◐ O1 /)
  expect((await line())?.props.color).toBe('cyan')
  expect(saved(store)).toContain('"isStartPressed":true')
  expect(resultText(await $.tool.call(READ_BOARD as never))).toContain('O1 [started] (from worker) Try the change')

  expect((await pane.find({ key: 'O1-start' }))?.props.label).toBe('Unstart')
  await pane.press({ key: 'O1-start' })
  expect(appended().length).toBe(1)
  expect((await line())?.text).toMatch(/^○ O1 /)
  expect((await pane.find({ key: 'O1-start' }))?.props.label).toBe('Start')
  expect(saved(store)).toContain('"isStartPressed":false')
})

test('Unstart drops a Start that failed to reach the poster, so Retry cannot send it', async ($, on) => {
  const clock = mock.clock(on)
  const store = engine(on, { clock, isAppendRefused: true })
  const sent = captureSends(on)
  await $.tool.call({ tool: 'mcp__board__set_owner_task', title: 'Try the change', agentId: 'worker' } as never)
  await clock.advance(10_000)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-start' })
  expect((await pane.find({ type: 'Text', text: 'O1 →' }))?.text).toContain('not delivered')

  await pane.press({ key: 'O1-start' })
  expect(await pane.find({ type: 'Text', text: 'O1 →' })).toBeUndefined()
  expect(await pane.find({ key: 'O1-retry' })).toBeUndefined()
  expect(saved(store)).not.toContain('"summary":"started"')
  expect(sent).toEqual([])
})

test('a ticked item marks a task for the owner started until none is ticked, and hides Start meanwhile', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { clock })
  await $.tool.call(OWNER_TASK as never)
  await clock.advance(10_000)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  const line = async () => pane.find({ type: 'Text', text: 'Re-review the PRs' })

  await pane.press({ key: 'O1-item-0' })
  expect((await line())?.text).toMatch(/^◐ O1 Re-review the PRs 1\/3/)
  expect((await line())?.props.color).toBe('cyan')
  expect(await pane.find({ key: 'O1-start' })).toBeUndefined()

  await pane.press({ key: 'O1-item-0' })
  expect((await line())?.text).toMatch(/^○ O1 /)
  expect((await pane.find({ key: 'O1-start' }))?.props.label).toBe('Start')
})

test('a change that failed to reach the poster is listed with Retry, which sends it once the poster is reachable', async ($, on) => {
  const toasts: string[] = []
  const agents: AgentInfo[] = []
  const store = engine(on, { toasts, agents, isAppendRefused: true })
  const sent = captureSends(on, agents)
  await $.tool.call({ ...OWNER_TASK, agentId: WORKER.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  await pane.press({ key: 'O1-item-2' })
  expect(saved(store)).toContain('"delivery":"failed"')
  expect(toasts.join()).toContain('O1: ticked \\"PR 13\\" saved on the board but NOT delivered to worker')
  expect((await pane.find({ type: 'Text', text: 'O1 →' }))?.text).toContain('not delivered')

  agents.push({ ...WORKER, status: 'idle' })
  await pane.press({ key: 'O1-retry' })
  expect(sent.map(s => s.text)).toEqual(['[board] The owner ticked "PR 13" on O1 "Re-review the PRs". 1 of 3 ticked; not yet: PR 11, PR 12.'])
  expect(saved(store)).toContain('"delivery":"sent"')
  expect(await pane.find({ key: 'O1-retry' })).toBeUndefined()
})

test('Dismiss clears a failed change from the unsent list and leaves the task waiting', async ($, on) => {
  engine(on, { isAppendRefused: true })
  captureSends(on)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  await pane.press({ key: 'O1-item-0' })
  await pane.press({ key: 'O1-dismiss' })
  expect(await pane.find({ type: 'Text', text: 'O1 →' })).toBeUndefined()
  expect(await pane.find({ key: 'O1-done' })).toBeDefined()
})

test("a change leaves the unsent list once a request of the poster's loop has carried it", async ($, on) => {
  const store = engine(on)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-done' })
  expect(await pane.find({ type: 'Text', text: 'O1 →' })).toBeDefined()

  await step($, 'worker')
  expect(saved(store)).toContain('"delivery":"seen"')
  expect(await pane.find({ type: 'Text', text: 'O1 →' })).toBeUndefined()
})

test('a board holding only tasks for the owner is restored, and their ids are not issued again', async ($, on) => {
  const onlyOwnerTasks = {
    ownerTasks: [{ id: 'O4', title: 'Carried over', items: [], isDone: false }],
    lastOwnerTaskNumber: 4,
    savedAt: 500,
  }
  engine(on, { seed: { [SESSION_KEY]: onlyOwnerTasks } })
  await $.turn.start({ text: '', turnId: 't0' })
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: 'Carried over' })).toBeDefined()
  expect(resultText(await $.tool.call(OWNER_TASK as never))).toContain('Posted O5')
})

test("a slow delivery of an older change does not overwrite the newer change's delivery", async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, { toasts, agents: [{ ...WORKER, status: 'idle' }], isAppendRefused: true })
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
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'O1-expand' })
  await pane.press({ key: 'O1-item-0' })
  await pane.press({ key: 'O1-item-1' })
  expect(saved(store)).toContain('"delivery":"sent"')

  // A press does not wait for its delivery, so wait for the held one's failure toast, its last step.
  releaseFirst()
  for (let i = 0; i < 50 && toasts.length === 0; i++) await $.tool.call(READ_BOARD as never)
  expect(toasts.join()).toContain('ticked \\"PR 11\\" saved on the board but NOT delivered')
  expect(saved(store)).toContain('"delivery":"sent"')
})
