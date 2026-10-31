import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { ASK, PHASES, READ_BOARD, SCOUT, SESSION_KEY, SET_TASK, SPAWN_SCOUT, WORKER, engine, mountPane, resultText, saved } from './test-support'

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
