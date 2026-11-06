import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BOARD, HOME, HOUR_MS, SCOUT, boardDecisions, checkFile, endTurn, engine, judgedTurn, prompt, raising, recordOf } from './test-support'

const decisionCount = async ($: Engine) => (await boardDecisions($)).length

test('a finding needs high confidence, one the judge marks a repeat or whose summary was raised before is dropped, and the judge is shown the latest 10 raised', async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts') })
  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'The parser test was skipped.', confidence: 'medium' }]))
  expect(world.told()).toEqual([])

  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'The parser test was skipped.' }]))
  expect(world.calls[1]?.prompt).not.toContain('Already raised')
  expect(world.told()).toHaveLength(1)

  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'the parser test was SKIPPED' }]))
  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'No parser test ran.', repeats: true }]))
  expect(world.calls[2]?.prompt).toContain('### alpha\n\nCriteria of a synthetic check.\n\nAlready raised for this agent:\n- The parser test was skipped.')
  expect(world.told()).toHaveLength(1)

  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'The README was rewritten.' }]))
  expect(world.told()).toHaveLength(2)

  world.settings = '{ "nudgesPerHour": 20 }'
  for (let index = 1; index <= 10; index += 1) await judgedTurn($, world, raising([{ name: 'alpha', summary: `Finding ${index}.` }]))
  expect(world.calls.at(-1)?.prompt).not.toContain('- The parser test was skipped.')
  expect(world.calls.at(-1)?.prompt).toContain('- The README was rewritten.')
})

test('each agent gets at most three nudges and three flags in any hour, each counted on its own, and a finding held back can come again once the cap frees', { plugins: [BOARD] }, async ($, on) => {
  const world = engine(on, { charlie: checkFile('turn-end', 'prompts'), bravo: checkFile('turn-end', 'prompts', 'all', 'haiku', 'both') }, [SCOUT])
  for (const index of [1, 2, 3, 4]) await judgedTurn($, world, raising([{ name: 'charlie', summary: `Nudge ${index}.` }]))
  expect(world.told()).toHaveLength(3)

  for (const index of [1, 2, 3, 4]) await judgedTurn($, world, raising([{ name: 'bravo', summary: `Both ${index}.` }]))
  expect(world.told()).toHaveLength(3)
  expect(await decisionCount($)).toBe(3)

  await judgedTurn($, world, raising([{ name: 'charlie', summary: 'Nudge for the teammate.' }]), SCOUT.id)
  expect(world.told().at(-1)?.to).toBe(SCOUT.id)

  await world.clock.advance(HOUR_MS)
  await judgedTurn($, world, raising([{ name: 'charlie', summary: 'Nudge 4.' }]))
  expect(world.told().filter(told => told.to === undefined)).toHaveLength(4)
})

test('a settings file overrides the limits it names, an entry it cannot use is reported and left at its default, and a file that is not JSON is reported and gives the defaults', { plugins: [BOARD] }, async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts'), delta: checkFile('turn-end', 'prompts', 'all', 'haiku', 'flag') })
  world.settings = '{ "minConfidence": "medium", "nudgesPerHour": 1, "maxRecordChars": 3000, "flagsPerHour": "many" }'
  for (const index of [1, 2, 3]) await prompt($, `ASK_${index} ${'x'.repeat(1500)}`)
  world.answers.push(
    raising([
      { name: 'alpha', summary: 'First medium finding.', confidence: 'medium' },
      { name: 'delta', summary: 'A flag.' },
    ]),
  )
  await endTurn($, world)
  expect(recordOf(world.calls[0])).toContain('[2 older items left out to keep the record short]')
  expect(world.toasts.filter(toast => toast.includes('"flagsPerHour"'))).toHaveLength(1)
  expect(world.told()).toHaveLength(1)
  expect(await decisionCount($)).toBe(1)

  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'Second medium finding.', confidence: 'medium' }]))
  expect(world.told()).toHaveLength(1)

  world.settings = 'NOT JSON'
  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'Third medium finding.', confidence: 'medium' }]))
  expect(world.toasts.filter(toast => toast.startsWith(`watcher skipped ${HOME}/.claude/local/watcher/settings.json:`))).toHaveLength(1)
  expect(world.told()).toHaveLength(1)
})
