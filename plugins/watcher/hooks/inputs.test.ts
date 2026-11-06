import { expect, test } from 'claude-code/testing'

import { ROOT, carried, checkFile, endTurn, engine, prompt, recordOf } from './test-support'

const REFERENCE = `${ROOT}/.claude/reference`

/** A note whose frontmatter lists `sources` as given, a body of `body`. */
const note = (sources: string, body: string) => `---\ntitle: Synthetic\nsources:${sources}\nverified: 2026-01-01\n---\n${body}\n`

test("a turn that edited a note's source shows that note, and a check reading notes is left out of a turn that edited none", async ($, on) => {
  const world = engine(on, { lima: checkFile('turn-end', 'calls, notes'), mike: checkFile('turn-end', 'prompts') })
  world.files = {
    [`${REFERENCE}/domains/parser.md`]: note('\n  - src/lexer.ts\n  - src/parser.ts', 'NOTE-INDENTED'),
    [`${REFERENCE}/projects/flat.md`]: note('\n- "src/parser.ts"', 'NOTE-FLAT'),
    [`${REFERENCE}/inline.md`]: note(' [src/parser.ts]', 'NOTE-INLINE'),
    [`${REFERENCE}/domains/other.md`]: note('\n  - src/other.ts', 'NOTE-OTHER'),
    [`${ROOT}/docs/outside.md`]: note('\n  - src/parser.ts', 'NOTE-OUTSIDE'),
  }
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited', text: 'The file was edited.' }))
  await prompt($, 'FIRST-ASK')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/parser.ts`, old_string: 'a', new_string: 'b' })
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['lima', 'mike']])
  const record = recordOf(world.calls[0])
  for (const shown of ['NOTE-INDENTED', 'NOTE-FLAT', 'NOTE-INLINE']) expect(record).toContain(shown)
  for (const hidden of ['NOTE-OTHER', 'NOTE-OUTSIDE']) expect(record).not.toContain(hidden)

  await prompt($, 'SECOND-ASK')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/unlisted.ts`, old_string: 'a', new_string: 'b' })
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['lima', 'mike'], ['mike']])
})

test('the plan is each checklist, spec or handoff the agent has read, as it stands now, and a check reading the plan waits for one', async ($, on) => {
  const world = engine(on, { november: checkFile('turn-end', 'calls, plan'), oscar: checkFile('turn-end', 'prompts') })
  const spec = `${ROOT}/docs/spec.md`
  world.files = { [spec]: 'SPEC-AS-READ', [`${ROOT}/docs/notes.md`]: 'NOT-A-PLAN' }
  on('tool.call', { tool: 'Read' }, () => ({ result: 'read', text: 'The file was read.' }))
  await prompt($, 'FIRST-ASK')
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/docs/notes.md` })
  await endTurn($, world)
  await prompt($, 'SECOND-ASK')
  await $.tool.call({ tool: 'Read', file_path: spec })
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['oscar'], ['november', 'oscar']])
  expect(recordOf(world.calls[1])).toContain('[plan file docs/spec.md]\nSPEC-AS-READ')

  world.files[spec] = 'SPEC-AS-CHANGED'
  await prompt($, 'THIRD-ASK')
  await endTurn($, world)
  expect(world.calls.map(carried)).toEqual([['oscar'], ['november', 'oscar'], ['november', 'oscar']])
  expect(recordOf(world.calls[2])).toContain('SPEC-AS-CHANGED')
  expect(recordOf(world.calls[2])).not.toContain('NOT-A-PLAN')
})

test('a result matching a secret pattern is judged at once on that call alone, the secret redacted wherever the judge reads it', async ($, on) => {
  const world = engine(on, { papa: checkFile('secret-match', 'calls, results'), quebec: checkFile('turn-end', 'calls, results') })
  // Built here so no secret scan of this file sees a whole token; both are fake.
  const githubToken = `ghp_${'Zq7'.repeat(12)}`
  const awsKey = `AKIA${'Q'.repeat(16)}`
  const results: Record<string, string> = {
    ls: 'HARMLESS-OUTPUT',
    'cat deploy.env': `key ${githubToken} from the vault ${'y'.repeat(2000)}`,
    'cat cloud.env': `${'x'.repeat(1000)} id ${awsKey} in the middle ${'y'.repeat(1000)}`,
  }
  on('tool.call', { tool: 'Bash' }, (_, e) => ({ result: 'ran', text: results[e.command] ?? '' }))
  await prompt($, 'THE-ASK')
  for (const command of Object.keys(results)) await $.tool.call({ tool: 'Bash', command })
  await world.clock.advance(10)
  expect(world.calls.map(carried)).toEqual([['papa'], ['papa']])
  const [first, second] = world.calls.map(recordOf)
  for (const shown of ['[redacted GitHub token: 40 characters, ', 'from the vault']) expect(first).toContain(shown)
  for (const shown of ['[redacted AWS access key: 20 characters, ', 'in the middle']) expect(second).toContain(shown)
  for (const hidden of [githubToken, 'HARMLESS-OUTPUT', 'THE-ASK']) expect(first).not.toContain(hidden)
  for (const hidden of [awsKey, 'from the vault', 'HARMLESS-OUTPUT']) expect(second).not.toContain(hidden)

  await endTurn($, world)
  const turn = recordOf(world.calls[2])
  expect(turn).toContain('[redacted GitHub token')
  expect(turn).not.toContain(githubToken)
})
