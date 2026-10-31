import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { ASK, OWNER_TASK, READ_BOARD, SCOUT, SESSION_KEY, SPAWN_SCOUT, WORKER, captureAppends, captureSends, engine, mountPane, resultText, saved, step } from './test-support'

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
