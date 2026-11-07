import { expect, test } from 'claude-code/testing'

import { BOARD, HOUR_MS, ROOT, answerFlag, checkFile, endTurn, engine, prompt, raising, recordOf } from './test-support'

/** `answer` with the session's goal beside its checks. */
const withGoal = (answer: string, goal: string) => JSON.stringify({ ...(JSON.parse(answer) as object), goal })

test("a session's entry holds its repository, branch, the first line of its goal, the files it changed and its findings, which another session's overlap check reads until a day passes without an update", async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts'), overlap: checkFile('turn-end', 'prompts, shared', 'main') })
  const LOCKED = `${ROOT}/src/locked.ts`
  on('tool.call', { tool: 'Edit' }, (_, e) => (e.file_path === LOCKED ? { isError: true, result: 'refused', text: 'The file could not be edited.' } : { result: 'edited', text: 'The file was edited.' }))
  await prompt($, 'Fix the failing parser test.')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/parser.ts`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: LOCKED, old_string: 'a', new_string: 'b' })
  world.answers.push(withGoal(raising([{ name: 'alpha', summary: 'ALPHA-FINDING' }]), 'SESSION-ONE-GOAL\nGOAL-SECOND-LINE'))
  await endTurn($, world)
  await prompt($, 'Also run the linter.')
  await endTurn($, world)
  expect(world.calls[0]?.prompt).toContain('## Goal')
  expect(world.calls[1]?.prompt).not.toContain('## Goal')

  world.sessionId = 'synthetic-session-2'
  world.top = `${ROOT}-docs`
  world.branch = 'docs-branch'
  await world.clock.advance(30 * 60_000)
  await prompt($, 'Rewrite the parser docs.')
  await endTurn($, world)
  const record = recordOf(world.calls[2])
  expect(world.calls[2]?.prompt).toContain('## Goal')
  for (const shown of ['This session: /work/repo in the worktree /work/repo-docs on branch docs-branch', '/work/repo on branch synthetic-branch, 30 minutes ago']) {
    expect(record).toContain(shown)
  }
  for (const shown of ['Goal: SESSION-ONE-GOAL', 'Files changed: src/parser.ts', 'alpha on the main session: ALPHA-FINDING']) expect(record).toContain(shown)
  for (const hidden of ['GOAL-SECOND-LINE', 'locked.ts']) expect(record).not.toContain(hidden)

  await world.clock.advance(24 * HOUR_MS)
  await prompt($, 'Check the docs build.')
  await endTurn($, world)
  expect(recordOf(world.calls[3])).toContain('Other sessions: none updated within a day.')
})

test("after a /clear the session's overlap check shows the files it changed before as its own and it asks the goal again, while a flag posted before, which board no longer holds, is forgotten and never acted on", { plugins: [BOARD] }, async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts', 'all', 'haiku', 'flag'), overlap: checkFile('turn-end', 'prompts, shared', 'main') })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited', text: 'The file was edited.' }))
  await prompt($, 'Fix the failing parser test.')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/parser.ts`, old_string: 'a', new_string: 'b' })
  world.answers.push(withGoal(raising([{ name: 'kilo', summary: 'KILO-BEFORE' }]), 'GOAL-BEFORE'))
  await endTurn($, world)

  await $.session.end({ reason: 'clear', sessionId: world.sessionId, resume: { id: world.sessionId } })
  world.sessionId = 'synthetic-session-after-clear'
  await prompt($, 'Rewrite the parser docs.')
  await endTurn($, world)
  expect(world.calls[1]?.prompt).toContain('## Goal')
  for (const shown of ['Files changed: src/parser.ts', 'Other sessions: none updated within a day.']) expect(recordOf(world.calls[1])).toContain(shown)
  expect(world.store.get('session:synthetic-session-after-clear')).toMatchObject({ flags: [] })

  await answerFlag($, world, 'D1', 'Send to the session')
  expect(world.submitted).toEqual([])
})

test('a flag posted before Claude Code restarted is acted on when the owner answers it after, and then forgotten', { plugins: [BOARD] }, async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts', 'all', 'haiku', 'flag') })
  // What the run before the restart left: the watcher's entry for this session holding its flag, which board then
  // restores as its decision, while the watcher's $.state starts empty.
  const flag = { decisionId: 'D1', check: 'kilo', summary: 'KILO-BEFORE', evidence: 'EVIDENCE-BEFORE', recipient: 'the main session' }
  world.store.set(`session:${world.sessionId}`, { files: [], findings: [], flags: [flag], updatedAt: 0 })
  const decision = { id: 'D1', question: 'The watcher\'s "kilo" check on the main session: KILO-BEFORE', options: [{ label: 'Send to the session' }], plugin: 'watcher', isAnswerKept: true }
  await $.command.run({ command: 'restore', args: JSON.stringify([decision]) } as never)

  await answerFlag($, world, 'D1', 'Send to the session')
  expect(world.submitted).toHaveLength(1)
  expect(world.submitted[0]).toContain('KILO-BEFORE')
  expect(world.store.get(`session:${world.sessionId}`)).toMatchObject({ flags: [] })
})

test('a session start deletes the entries not written for 3 days, and those past the newest 100', async ($, on) => {
  const world = engine(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const entryAt = (updatedAt: number) => ({ files: [], findings: [], flags: [], updatedAt })
  const sessionKeys = () => [...world.store.keys()].filter(key => key.startsWith('session:'))
  const start = () => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const now = world.clock.now()
  world.store.set('session:stale', entryAt(now - 72 * HOUR_MS - 1))
  world.store.set('session:fresh-0', entryAt(now))
  await start()
  expect(sessionKeys()).toEqual(['session:fresh-0'])

  for (let index = 1; index <= 100; index += 1) world.store.set(`session:fresh-${index}`, entryAt(now - index))
  await start()
  expect(sessionKeys()).toHaveLength(100)
  expect(sessionKeys()).not.toContain('session:fresh-100')
})
