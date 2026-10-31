import { expect, test } from 'claude-code/testing'
import type { AgentInfo, PromptComposeInput } from 'claude-code'

import { PHASES, PROBE_CALLER, SCOUT, SET_TASK, SPAWN_SCOUT, WORKER, complete, composeNothingBeneath, engine, mountPane, resultText, step } from './test-support'

test('the guidance is added only where a surface draws', async ($, on) => {
  engine(on)
  composeNothingBeneath(on)
  const compose: PromptComposeInput = { model: 'opus', promptModel: 'opus', surfaces: [], tools: [], outputStyle: null, traits: [] }
  const headless = await $.prompt.compose(compose)
  expect(JSON.stringify(headless)).not.toContain('board:guidance')
  const drawn = await $.prompt.compose({ ...compose, surfaces: ['terminal'] })
  expect(JSON.stringify(drawn)).toContain('board:guidance')
})

const WORKER_CALL = { tool: 'Read', file_path: 'notes.md', agentId: 'worker' }
function isNudge(result: unknown): boolean {
  return JSON.stringify(result).includes('[board]')
}

test('a teammate is nudged once when its status reaches the call limit, and again only after a new status', async ($, on) => {
  engine(on, { agents: [WORKER] })
  const nudged: boolean[] = []
  for (let i = 0; i < 21; i++) nudged.push(isNudge(await $.tool.call(WORKER_CALL as never)))
  // The 20th call is the first stale one; the 21st is not nudged again.
  expect(nudged.indexOf(true)).toBe(19)
  expect(nudged.filter(Boolean).length).toBe(1)

  // A new status starts the count again and earns a nudge of its own.
  await $.tool.call({ tool: 'mcp__board__set_status', status: 'reading notes', agentId: 'worker' } as never)
  const afterStatus: boolean[] = []
  for (let i = 0; i < 20; i++) afterStatus.push(isNudge(await $.tool.call(WORKER_CALL as never)))
  expect(afterStatus.indexOf(true)).toBe(19)
})

test('with no surface, as in claude -p, neither the main session nor a teammate is nudged', async ($, on) => {
  engine(on, { surfaces: [], agents: [WORKER] })
  // The main session is mid-turn, so its own calls count.
  await step($)
  const main: unknown[] = []
  const teammate: unknown[] = []
  for (let i = 0; i < 20; i++) {
    main.push(await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never))
    teammate.push(await $.tool.call(WORKER_CALL as never))
  }
  expect(main.some(isNudge), 'the main session was nudged').toBe(false)
  expect(teammate.some(isNudge), 'the teammate was nudged').toBe(false)
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

test("another plugin's own tool calls do not spend the main session's nudge", { plugins: [PROBE_CALLER] }, async ($, on) => {
  engine(on)
  // The main session is mid-turn, so its own calls count.
  await step($)
  const { text } = await $.command.run({ command: 'probe', args: '' } as never)
  expect(text).not.toContain('[board]')
  // None of the plugin's calls counted, so the nudge is still the main session's 20th own call.
  const own: boolean[] = []
  for (let i = 0; i < 20; i++) own.push(isNudge(await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as never)))
  expect(own.indexOf(true)).toBe(19)
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
