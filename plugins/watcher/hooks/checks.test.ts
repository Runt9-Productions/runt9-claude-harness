import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteInput } from 'claude-code'

import { HOME, ROOT, carried, endTurn, engine, prompt } from './test-support'
import type { World } from './test-support'

const REPOSITORY_DIR = `${ROOT}/.claude/watcher/checks`
const MACHINE_DIR = `${HOME}/.claude/local/watcher/checks`

/** A check file's text: its frontmatter, then `criteria` as its body. */
const checkFile = (criteria: string, frontmatter = 'triggers: [turn-end]\naudience: nudge\nagents: all\nreads: [prompts]') =>
  `---\n${frontmatter}\n---\n${criteria}\n`

/** The calls one judged turn of the main session makes. */
async function judgedCalls($: Engine, world: World): Promise<ModelCompleteInput[]> {
  const before = world.calls.length
  await prompt($, 'THE-ASK')
  await endTurn($, world)
  return world.calls.slice(before)
}

const carriedBy = (call: ModelCompleteInput | undefined) => (call === undefined ? [] : carried(call))

/** What a call's prompt tells the judge of the check `name`. */
function criteriaOf(call: ModelCompleteInput | undefined, name: string): string {
  const prompt = call?.prompt ?? ''
  const start = prompt.indexOf(`### ${name}\n\n`)
  if (start < 0) return ''
  const body = prompt.slice(start + `### ${name}\n\n`.length)
  return body.slice(0, body.search(/\n\n(###|## )/))
}

test('a repository check replaces a shipped one and a machine-local one replaces both, and an empty body disables', async ($, on) => {
  const world = engine(on, { alpha: checkFile('shipped alpha'), bravo: checkFile('shipped bravo'), charlie: checkFile('shipped charlie') })
  world.files = {
    [`${REPOSITORY_DIR}/alpha.md`]: checkFile('repository alpha'),
    [`${REPOSITORY_DIR}/bravo.md`]: checkFile(''),
    [`${REPOSITORY_DIR}/delta.md`]: checkFile('repository delta'),
    [`${MACHINE_DIR}/alpha.md`]: checkFile('machine alpha'),
    [`${MACHINE_DIR}/charlie.md`]: '',
    // The template the installer leaves beside a machine-local file, which no reader takes.
    [`${MACHINE_DIR}/delta.md.example`]: checkFile('example delta'),
  }
  const [call] = await judgedCalls($, world)
  expect(carriedBy(call)).toEqual(['alpha', 'delta'])
  expect([criteriaOf(call, 'alpha'), criteriaOf(call, 'delta')]).toEqual(['machine alpha', 'repository delta'])
  expect(world.toasts).toEqual([])
})

test("a check written in the spec's format reads with its comments left out, and one naming no model gets haiku", async ($, on) => {
  const specFormat = [
    'triggers: [turn-end, commit]',
    'audience: both          # nudge | flag | both',
    'agents: all             # main | teammates | all',
    'reads: [prompts, calls, replies, results]',
    'model: sonnet',
  ].join('\n')
  const world = engine(on, {
    kilo: checkFile('One sentence.\n\nAnother paragraph.', specFormat),
    lima: checkFile('Lima.', 'triggers: turn-end\naudience: flag\nagents: main\nreads: prompts'),
  })
  const calls = await judgedCalls($, world)
  expect(calls.map(call => ({ model: call.model, checks: carried(call) }))).toEqual([
    { model: 'sonnet', checks: ['kilo'] },
    { model: 'haiku', checks: ['lima'] },
  ])
  expect(criteriaOf(calls[0], 'kilo')).toBe('One sentence.\n\nAnother paragraph.')
  expect(world.toasts).toEqual([])
})

test('each bad file is reported once by its path and skipped, leaving the check it would have replaced in force', async ($, on) => {
  const badFiles = {
    [`${MACHINE_DIR}/alpha.md`]: checkFile('loud alpha', 'triggers: [turn-end]\naudience: loud\nagents: all\nreads: [prompts]'),
    [`${MACHINE_DIR}/golf.md`]: '---\ntriggers: [turn-end]\naudience: nudge\nagents: all\nreads: [prompts]\nGolf.\n',
    [`${MACHINE_DIR}/hotel.md`]: checkFile('Hotel.', 'triggers: [turn-end]\naudience: nudge\nagents: all'),
    [`${MACHINE_DIR}/india.md`]: checkFile('India.', 'trigger: [turn-end]\ntriggers: [turn-end]\naudience: nudge\nagents: all\nreads: [prompts]'),
    [`${MACHINE_DIR}/juliet.md`]: checkFile('Juliet.', 'triggers: [turn-end]\naudience: nudge\nagents: all\nreads: [prompts, diary]'),
    [`${MACHINE_DIR}/Kilo Check.md`]: checkFile('Kilo.'),
  }
  const world = engine(on, { alpha: checkFile('shipped alpha') })
  world.files = { ...badFiles, [`${MACHINE_DIR}/mike.md`]: checkFile('Mike.') }
  const [call] = await judgedCalls($, world)
  expect(carriedBy(call)).toEqual(['alpha', 'mike'])
  expect(criteriaOf(call, 'alpha')).toBe('shipped alpha')
  const reportedPaths = Object.keys(badFiles).map(path => world.toasts.filter(toast => toast.includes(`${path}:`)).length)
  expect(reportedPaths).toEqual([1, 1, 1, 1, 1, 1])
  expect(world.toasts).toHaveLength(6)

  await judgedCalls($, world)
  expect(world.toasts).toHaveLength(6)
})
