import { expect, test } from 'claude-code/testing'
import type { SessionAppendInput, ToolCallResult } from 'claude-code'

import { HELPER, JUDGE_PROMPT, ROOT, SCOUT, bashResult, carried, checkFile, endTurn, engine, prompt, recordOf, reply } from './test-support'

test('one call per model carries every check subscribed to the trigger and to that kind of agent', async ($, on) => {
  const world = engine(on, {
    alpha: checkFile('turn-end', 'prompts'),
    bravo: checkFile('turn-end, commit', 'prompts', 'main'),
    charlie: checkFile('turn-end', 'prompts', 'all', 'sonnet'),
    delta: checkFile('commit', 'prompts'),
    echo: checkFile('turn-end', 'prompts', 'teammates'),
  })
  await prompt($, 'Rename the parser module.')
  await endTurn($, world)
  expect(world.calls.map(call => ({ model: call.model, checks: carried(call) }))).toEqual([
    { model: 'haiku', checks: ['alpha', 'bravo'] },
    { model: 'sonnet', checks: ['charlie'] },
  ])
  expect(world.calls[0]?.prompt).toStartWith(JUDGE_PROMPT)
  expect(world.calls[0]?.prompt).toContain('Criteria of a synthetic check.')
})

test('where a surface draws the judgment, from reading its inputs on, waits for the hook to return, and a run with none is judged only when the setting asks, before it returns', async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts') })
  const turnEnd = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
  const judgeReads = () => world.reads.filter(path => path.endsWith('/judge.md'))
  await prompt($, 'FIRST-ASK')
  await $.turn.complete({ ...turnEnd, turnId: 'synthetic-turn-1' })
  expect(world.calls).toEqual([])
  expect(judgeReads()).toEqual([])
  await world.clock.advance(10)
  expect(world.calls).toHaveLength(1)
  expect(judgeReads()).toHaveLength(1)

  world.surfaces = []
  await prompt($, 'SECOND-ASK')
  await $.turn.complete({ ...turnEnd, turnId: 'synthetic-turn-2' })
  await world.clock.advance(10)
  expect(world.calls).toHaveLength(1)

  world.settings = '{ "judgeHeadless": true }'
  await prompt($, 'THIRD-ASK')
  await $.turn.complete({ ...turnEnd, turnId: 'synthetic-turn-3' })
  expect(world.calls).toHaveLength(2)
})

test("an unstamped prompt is the person's only as the main session's own prompt in a run with no surface, and the goal is asked only of the person's", async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts') }, [SCOUT])
  world.settings = '{ "judgeHeadless": true }'
  await prompt($, 'TERMINAL-ASK', undefined, 'unclassified')
  await endTurn($, world)
  expect(recordOf(world.calls[0])).toContain('[prompt from another agent]\nTERMINAL-ASK')
  expect(world.calls[0]?.prompt).not.toContain('## Goal')

  world.surfaces = []
  const unstamped = (text: string): SessionAppendInput['message'] => ({ type: 'user', role: 'user', content: [{ type: 'text', text }] })
  await prompt($, 'OPERATOR-ASK', undefined, 'unclassified')
  await $.session.append({ message: { ...unstamped('META-NOTICE'), isMeta: true }, door: 'prompt', origin: { kind: 'unclassified' }, uuid: crypto.randomUUID() })
  await $.session.append({ message: unstamped('MID-TURN-DELIVERY'), door: 'delivery', origin: { kind: 'unclassified' }, uuid: crypto.randomUUID() })
  await endTurn($, world)
  const record = recordOf(world.calls[1])
  expect(record).toContain('[prompt from person]\nOPERATOR-ASK')
  expect(world.calls[1]?.prompt).toContain('## Goal')
  for (const other of ['META-NOTICE', 'MID-TURN-DELIVERY']) expect(record).toContain(`[prompt from another agent]\n${other}`)

  await prompt($, 'SCOUT-BRIEF', SCOUT.id, 'unclassified')
  await endTurn($, world, SCOUT.id)
  expect(recordOf(world.calls[2])).toContain('[prompt from lead]\nSCOUT-BRIEF')
})

test("the record holds only what the batch's checks read, each item cut short, with a refused call's kind", async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts'), lima: checkFile('turn-end', 'calls'), mike: checkFile('turn-end', 'exits', 'all', 'sonnet') })
  world.verdicts.Write = { decision: 'deny', reason: 'synthetic deny', rule: 'Write(/etc/**)' }
  on('tool.call', { tool: 'Bash' }, bashResult({ isError: true, result: 'Exit code 1', text: 'Exit code 1\nRESULT-TEXT' }))
  await prompt($, `PROMPT-START ${'x'.repeat(50_000)} PROMPT-END`)
  await $.tool.call({ tool: 'Bash', command: `INPUT-START ${'i'.repeat(50_000)} INPUT-END` })
  await $.tool.call({ tool: 'Write', file_path: '/etc/synthetic', content: 'y' })
  await reply($, 'REPLY-TEXT')
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['kilo', 'lima'], ['mike']])
  const [read, exits] = world.calls.map(recordOf)
  // Calls read without their outcomes still show how one was refused.
  for (const shown of ['PROMPT-START', 'PROMPT-END', '[call Bash] {"command":"INPUT-START', 'INPUT-END', '[call Write, refused by a permission rule]']) expect(read).toContain(shown)
  for (const hidden of ['exit 1', 'RESULT-TEXT', 'REPLY-TEXT']) expect(read).not.toContain(hidden)
  expect(read?.length).toBeLessThan(4000)
  for (const shown of ['[call Bash, exit 1]', '[call Write, refused by a permission rule]']) expect(exits).toContain(shown)
  for (const hidden of ['INPUT-START', 'PROMPT-START', 'RESULT-TEXT']) expect(exits).not.toContain(hidden)
})

test('an agent keeps its latest 150 items, so prompts already judged never crowd out a new call, and keeps its latest prompt while a judgment has still to read it', async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts, calls') })
  on('tool.call', { tool: 'Bash' }, bashResult({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }))
  for (let index = 1; index <= 150; index += 1) await prompt($, `ASK_${index}`)
  await endTurn($, world)
  await $.tool.call({ tool: 'Bash', command: 'NEW-CALL' })
  await endTurn($, world)
  expect(recordOf(world.calls[1])).toContain('NEW-CALL')

  await prompt($, 'OLDER-ASK')
  await prompt($, 'LATEST-ASK')
  for (let index = 1; index <= 150; index += 1) await $.tool.call({ tool: 'Bash', command: `CALL_${String(index).padStart(3, '0')}` })
  await endTurn($, world)
  const record = recordOf(world.calls[2])
  for (const kept of ['LATEST-ASK', 'CALL_002', 'CALL_150']) expect(record).toContain(kept)
  for (const dropped of ['OLDER-ASK', 'CALL_001']) expect(record).not.toContain(dropped)
})

test('a record past its cap drops the oldest items, other calls before prompts, and says so', async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts, calls') })
  on('tool.call', { tool: 'Bash' }, bashResult({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'OLDEST-CALL' })
  for (let index = 1; index <= 25; index += 1) await prompt($, `ASK_${String(index).padStart(2, '0')} ${'x'.repeat(2500)}`)
  await $.tool.call({ tool: 'Bash', command: 'LATEST-CALL' })
  await endTurn($, world)
  const record = recordOf(world.calls[0])
  expect(record.length).toBeLessThan(41_000)
  expect(record).toContain('older items left out')
  for (const kept of ['ASK_25', 'ASK_10']) expect(record).toContain(kept)
  for (const dropped of ['OLDEST-CALL', 'LATEST-CALL', 'ASK_01']) expect(record).not.toContain(dropped)
})

test('the sections from outside the capture count toward the record cap, and the latest prompt is kept even past it', async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts, plan') })
  world.settings = '{ "maxRecordChars": 4000 }'
  const checklist = `${ROOT}/docs/checklist.md`
  world.files = { [checklist]: `CHECKLIST-START ${'z'.repeat(20_000)}` }
  on('tool.call', { tool: 'Read' }, () => ({ result: 'read', text: 'The file was read.' }))
  await $.tool.call({ tool: 'Read', file_path: checklist })
  for (let index = 1; index <= 10; index += 1) await prompt($, `ASK_${String(index).padStart(2, '0')} ${'x'.repeat(1000)}`)
  await endTurn($, world)
  const record = recordOf(world.calls[0])
  expect(record.length).toBeLessThanOrEqual(4000 + '## Record\n\n'.length)
  for (const kept of ['CHECKLIST-START', 'ASK_10']) expect(record).toContain(kept)

  // A latest prompt larger than the room the sections leave is kept all the same.
  world.settings = '{ "maxRecordChars": 1000 }'
  await prompt($, `LONE-ASK ${'x'.repeat(3000)}`)
  await endTurn($, world)
  expect(recordOf(world.calls[1])).toContain('LONE-ASK')
})

test('each trigger judges from where it last did, never twice over nothing, and with the checks in force then', async ($, on) => {
  const world = engine(on, { mike: checkFile('turn-end', 'prompts, calls'), november: checkFile('commit', 'calls') })
  on('tool.call', { tool: 'Bash' }, bashResult({ result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'f00d', kind: 'committed' } } }, text: 'committed' }))
  await prompt($, 'FIRST-ASK')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m synthetic' })
  await world.clock.advance(10)
  await reply($, 'Committed.')
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['november'], ['mike']])
  expect(recordOf(world.calls[1])).toContain('FIRST-ASK')
  expect(recordOf(world.calls[1])).toContain('git commit -m synthetic')

  await endTurn($, world)
  expect(world.calls).toHaveLength(2)

  world.checks.oscar = checkFile('turn-end', 'prompts')
  await prompt($, 'SECOND-ASK')
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['november'], ['mike'], ['mike', 'oscar']])
  expect(recordOf(world.calls[2])).toContain('SECOND-ASK')
  expect(recordOf(world.calls[2])).not.toContain('FIRST-ASK')
})

test('a push that happened judges the commit checks, and a git command that failed does not', async ($, on) => {
  const world = engine(on, { november: checkFile('commit', 'calls') })
  const done = { stdout: '', stderr: '', interrupted: false }
  const results: Record<string, ToolCallResult> = {
    'git commit -m synthetic': { isError: true, result: 'Exit code 1', text: 'Exit code 1\nnothing to commit' },
    'git push': { result: { ...done, gitOperation: { push: { branch: 'synthetic-branch' } } }, text: 'pushed' },
  }
  on('tool.call', { tool: 'Bash' }, (_, e) => results[e.command] ?? { result: done, text: '' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m synthetic' })
  await world.clock.advance(10)
  expect(world.calls).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await world.clock.advance(10)
  expect(world.calls.map(carried)).toEqual([['november']])
  expect(recordOf(world.calls[0])).toContain('git push')
})

test('a failure in a judgment finished after the hook returned is written to the debug log', async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts') })
  world.isStoreFailing = true
  world.answers.push(JSON.stringify({ checks: [{ name: 'alpha', raised: false, confidence: 'low', summary: '', evidence: '', repeats: false }], goal: 'A GOAL' }))
  await prompt($, 'FIRST-ASK')
  await endTurn($, world)
  expect(world.logs.filter(line => line.startsWith('watcher could not judge the main session at turn-end'))).toHaveLength(1)
})

test('a raised verdict is logged with its summary, even with its evidence and repeats left out, and an answer that cannot be read is logged once and dropped', async ($, on) => {
  const world = engine(on, { papa: checkFile('turn-end', 'prompts'), quebec: checkFile('turn-end', 'prompts') })
  const entries = [
    { name: 'papa', raised: true, confidence: 'high', summary: 'SUMMARY-PAPA' },
    { name: 'quebec', raised: false, confidence: 'low', summary: '', evidence: '', repeats: false },
    { name: 'zulu', raised: true, confidence: 'high', summary: 'SUMMARY-ZULU', evidence: '', repeats: false },
  ]
  world.answers.push(`\`\`\`json\n${JSON.stringify({ checks: entries })}\n\`\`\``, 'NOT-JSON')
  await prompt($, 'FIRST-ASK')
  await endTurn($, world)
  expect(world.logs.filter(line => line.includes('SUMMARY-PAPA'))).toHaveLength(1)
  expect(world.logs.filter(line => line.includes('quebec'))).toEqual([])
  expect(world.logs.filter(line => line.includes('SUMMARY-ZULU'))).toEqual([])

  await prompt($, 'SECOND-ASK')
  await endTurn($, world)
  expect(world.calls).toHaveLength(2)
  expect(world.logs.filter(line => line.includes('NOT-JSON'))).toHaveLength(1)
})

test('a teammate is judged on its own record with the roster, and when idle also by its name alone, and a subagent that is not one is never judged', async ($, on) => {
  const world = engine(
    on,
    {
      romeo: checkFile('turn-end', 'prompts, status', 'teammates'),
      sierra: checkFile('turn-end', 'prompts', 'main'),
      tango: checkFile('teammate-idle', 'prompts', 'teammates'),
    },
    [SCOUT, HELPER],
  )
  await prompt($, 'MAIN-ASK')
  await prompt($, 'SCOUT-BRIEF', SCOUT.id, 'unclassified')
  await prompt($, 'HELPER-TASK', HELPER.id, 'unclassified')
  await endTurn($, world, HELPER.id)
  expect(world.calls).toEqual([])

  await endTurn($, world, SCOUT.id)
  expect(world.calls.map(carried)).toEqual([['romeo']])
  const record = recordOf(world.calls[0])
  expect(record).toContain('[prompt from lead]\nSCOUT-BRIEF')
  expect(record).toContain('- scout (teammate, the agent judged): running')
  expect(record).not.toContain('MAIN-ASK')

  await prompt($, 'SCOUT-FOLLOW-UP', SCOUT.id, 'unclassified')
  // The hook input's agent_id is optional, so the teammate is found by its name.
  await $.classic.TeammateIdle({ teammate_name: 'scout', team_name: 'crew' })
  await world.clock.advance(10)
  expect(world.calls.map(carried)).toEqual([['romeo'], ['tango']])

  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['romeo'], ['tango'], ['sierra']])
  expect(recordOf(world.calls[2])).toContain('MAIN-ASK')
  expect(recordOf(world.calls[2])).not.toContain('SCOUT')
})

test('an auto-mode denial judges once the denied call is captured, and a compaction judges its own checks', async ($, on) => {
  const world = engine(on, { uniform: checkFile('refusal', 'calls'), victor: checkFile('compaction', 'prompts') })
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: { command: e.command }, tool_use_id: e.tool_use_id, reason: 'synthetic denial' })
    return { isError: true, result: 'denied', text: 'Permission for this action was denied.' }
  })
  await prompt($, 'THE-ASK')
  await $.tool.call({ tool: 'Bash', command: 'DENIED-COMMAND' })
  await world.clock.advance(10)
  expect(world.calls.map(carried)).toEqual([['uniform']])
  expect(recordOf(world.calls[0])).toContain('DENIED-COMMAND')

  await $.session.append({
    message: { type: 'system', name: 'compact_boundary', content: [{ type: 'text', text: 'Conversation compacted' }] },
    door: 'compaction',
    origin: { kind: 'engine' },
    uuid: crypto.randomUUID(),
  })
  await world.clock.advance(10)
  expect(world.calls.map(carried)).toEqual([['uniform'], ['victor']])
  expect(recordOf(world.calls[1])).toContain('THE-ASK')
})
