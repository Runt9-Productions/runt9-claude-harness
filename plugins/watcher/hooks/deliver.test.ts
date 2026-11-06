import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BOARD, SCOUT, answerFlag, boardDecisions, checkFile, engine, judgedTurn, prompt, raising } from './test-support'

/** The board decision whose question carries `summary`. */
async function decisionOf($: Engine, summary: string) {
  const decisions = await boardDecisions($)
  const decision = decisions.find(posted => posted.question.includes(summary))
  if (decision === undefined) throw new Error(`no decision carries ${summary}`)
  return decision
}

test('a nudge is a hidden row to the agent judged with the check, the observation and its evidence, and a teammate gone idle is reported to its lead', async ($, on) => {
  const world = engine(on, { alpha: checkFile('turn-end', 'prompts'), tango: checkFile('teammate-idle', 'prompts', 'teammates') }, [SCOUT])
  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'MAIN-SUMMARY' }]))
  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'SCOUT-SUMMARY' }]), SCOUT.id)
  world.answers.push(raising([{ name: 'tango', summary: 'STALL-SUMMARY' }]))
  await prompt($, 'SCOUT-FOLLOW-UP', SCOUT.id, 'unclassified')
  await $.classic.TeammateIdle({ teammate_name: 'scout', team_name: 'crew', agent_id: SCOUT.id })
  await world.clock.advance(10)

  const told = world.told()
  expect(told.map(row => row.to)).toEqual([undefined, SCOUT.id, undefined])
  for (const shown of ['"alpha"', 'MAIN-SUMMARY', 'EVIDENCE-OF-MAIN-SUMMARY']) expect(told[0]?.text).toContain(shown)
  for (const shown of ['"tango"', 'teammate "scout"', 'STALL-SUMMARY', 'EVIDENCE-OF-STALL-SUMMARY']) expect(told[2]?.text).toContain(shown)

  world.refusing.add(SCOUT.id)
  await judgedTurn($, world, raising([{ name: 'alpha', summary: 'IDLE-SUMMARY' }]), SCOUT.id)
  expect(world.sent.map(sent => sent.to)).toEqual([SCOUT.id])
  expect(world.sent[0]?.text).toContain('IDLE-SUMMARY')
})

test("a flag is a board decision with the three answers, and the owner's Useful, Send and Noise count per check, a noisy check reported once", { plugins: [BOARD] }, async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts', 'all', 'haiku', 'flag'), lima: checkFile('turn-end', 'prompts', 'all', 'haiku', 'flag') })
  world.settings = '{ "flagsPerHour": 20 }'
  const answer = async (check: string, summary: string, option: string) => {
    await judgedTurn($, world, raising([{ name: check, summary }]))
    await answerFlag($, world, (await decisionOf($, summary)).id, option)
  }
  await judgedTurn($, world, raising([{ name: 'kilo', summary: 'KILO-FIRST' }]))
  const posted = await decisionOf($, 'KILO-FIRST')
  expect(posted.plugin).toBe('watcher')
  expect(posted.isAnswerKept).toBe(true)
  expect(posted.options.map(option => option.label)).toEqual(['Send to the session', 'Useful', 'Noise'])
  expect(posted.question).toContain('"kilo"')
  expect(posted.context).toContain('EVIDENCE-OF-KILO-FIRST')
  await answerFlag($, world, posted.id, 'Useful')
  await answer('kilo', 'KILO-SENT', 'Send to the session')

  await answer('lima', 'LIMA_1', 'Noise')
  await answer('lima', 'LIMA_2', 'Noise')
  for (const index of [1, 2, 3, 4]) await answer('kilo', `KILO_${index}`, 'Noise')
  expect(world.toasts).toEqual([])
  await answer('kilo', 'KILO_5', 'Noise')
  await answer('kilo', 'KILO_6', 'Noise')
  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('"kilo"')
  expect(world.told()).toEqual([])
  expect(world.submitted).toHaveLength(1)
  expect(world.submitted[0]).toContain('KILO-SENT')
})

test('Send to the session prompts an idle main session, adds a row to a running one or to the teammate judged, with the owner\'s note', { plugins: [BOARD] }, async ($, on) => {
  const world = engine(on, { kilo: checkFile('turn-end', 'prompts', 'all', 'haiku', 'flag') }, [SCOUT])
  await judgedTurn($, world, raising([{ name: 'kilo', summary: 'IDLE-SUMMARY' }]))
  await judgedTurn($, world, raising([{ name: 'kilo', summary: 'RUNNING-SUMMARY' }]))
  await judgedTurn($, world, raising([{ name: 'kilo', summary: 'SCOUT-SUMMARY' }]), SCOUT.id)

  await answerFlag($, world, (await decisionOf($, 'IDLE-SUMMARY')).id, 'Send to the session', 'look at the parser first')
  expect(world.submitted).toHaveLength(1)
  for (const shown of ['"kilo"', 'IDLE-SUMMARY', 'EVIDENCE-OF-IDLE-SUMMARY', 'look at the parser first']) expect(world.submitted[0]).toContain(shown)
  expect(world.told()).toEqual([])

  await $.turn.start({ text: 'NEXT-ASK', turnId: 'synthetic-turn' })
  await answerFlag($, world, (await decisionOf($, 'RUNNING-SUMMARY')).id, 'Send to the session')
  await answerFlag($, world, (await decisionOf($, 'SCOUT-SUMMARY')).id, 'Send to the session')
  expect(world.submitted).toHaveLength(1)
  expect(world.told().map(row => row.to)).toEqual([undefined, SCOUT.id])
  expect(world.told()[0]?.text).toContain('RUNNING-SUMMARY')
  expect(world.told()[1]?.text).toContain('SCOUT-SUMMARY')
})
