import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import type { Check } from '../types'

const ROOT = '/work/repo'
const HOME = '/home/user'
const REPOSITORY_DIR = `${ROOT}/.claude/watcher/checks`
const MACHINE_DIR = `${HOME}/.claude/local/watcher/checks`
// Stands for the plugin's own checks/ directory, wherever the kit loads the plugin from.
const SHIPPED_DIR = '/plugin/checks'

const SHIPPED_MARK = '/checks'

type World = {
  toasts: string[]
  /** What the plugin last wrote to its `checks` state. */
  checks: readonly Check[]
}

/** A check file's text: its frontmatter, then `criteria` as its body. */
const checkFile = (criteria: string, frontmatter = 'triggers: [turn-end]\naudience: nudge\nagents: all\nreads: [prompts]') =>
  `---\n${frontmatter}\n---\n${criteria}\n`

/** The fields every check written by `checkFile` with its default frontmatter has. */
const DEFAULTS = { triggers: ['turn-end'], audience: 'nudge', agents: 'all', reads: ['prompts'], model: 'haiku' } as const

/** The path as `files` keys it: a path outside the repository and home is the plugin's, so it moves under SHIPPED_DIR. */
function keyed(path: string): string {
  if (path.startsWith(`${ROOT}/`)) return path
  if (path.startsWith(`${HOME}/`)) return path
  const mark = path.lastIndexOf(SHIPPED_MARK)
  return `${SHIPPED_DIR}${path.slice(mark + SHIPPED_MARK.length)}`
}

/** The engine nouns the loader calls, over `files`, by absolute path; a directory exists where a file lies beneath it. */
function engine(on: On, files: Record<string, string>): World {
  const world: World = { toasts: [], checks: [] }
  const paths = Object.keys(files)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('state.set', { plugin: 'watcher', key: 'checks' }, (_, e, next) => {
    world.checks = e.value
    return next(e)
  })
  on('session.root', () => ({ value: ROOT }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', (_, e) => {
    const directory = `${keyed(e.path)}/`
    return { value: paths.some(path => path.startsWith(directory)) }
  })
  on('fs.list', (_, e) => {
    const directory = `${keyed(e.path)}/`
    const entries: FsEntry[] = paths
      .filter(path => path.startsWith(directory))
      .map(path => ({ name: path.slice(directory.length), kind: 'file', size: 1, mtimeMs: 1, isLink: false }))
    if (entries.length === 0) throw new Error(`ENOENT: ${directory}`)
    return { value: entries }
  })
  on('fs.read', (_, e) => {
    const path = keyed(e.path)
    const text = files[path]
    if (text === undefined) throw new Error(`ENOENT: ${path}`)
    return { value: text }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  return world
}

/** The checks in force once a session has started. */
async function startSession($: Engine, world: World): Promise<readonly Check[]> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  return world.checks
}

test('a repository check replaces a shipped one and a machine-local one replaces both, and an empty body disables', async ($, on) => {
  const world = engine(on, {
    [`${SHIPPED_DIR}/alpha.md`]: checkFile('shipped alpha'),
    [`${SHIPPED_DIR}/bravo.md`]: checkFile('shipped bravo'),
    [`${SHIPPED_DIR}/charlie.md`]: checkFile('shipped charlie'),
    [`${REPOSITORY_DIR}/alpha.md`]: checkFile('repository alpha'),
    [`${REPOSITORY_DIR}/bravo.md`]: checkFile(''),
    [`${REPOSITORY_DIR}/delta.md`]: checkFile('repository delta'),
    [`${MACHINE_DIR}/alpha.md`]: checkFile('machine alpha'),
    [`${MACHINE_DIR}/charlie.md`]: '',
    // The template the installer leaves beside a machine-local file, which no reader takes.
    [`${MACHINE_DIR}/delta.md.example`]: checkFile('example delta'),
  })
  expect(await startSession($, world)).toEqual([
    { name: 'alpha', ...DEFAULTS, criteria: 'machine alpha' },
    { name: 'delta', ...DEFAULTS, criteria: 'repository delta' },
  ])
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
    [`${SHIPPED_DIR}/kilo.md`]: checkFile('One sentence.\n\nAnother paragraph.', specFormat),
    [`${SHIPPED_DIR}/lima.md`]: checkFile('Lima.', 'triggers: teammate-idle\naudience: flag\nagents: teammates\nreads: [status]'),
  })
  expect(await startSession($, world)).toEqual([
    {
      name: 'kilo',
      triggers: ['turn-end', 'commit'],
      audience: 'both',
      agents: 'all',
      reads: ['prompts', 'calls', 'replies', 'results'],
      model: 'sonnet',
      criteria: 'One sentence.\n\nAnother paragraph.',
    },
    { name: 'lima', triggers: ['teammate-idle'], audience: 'flag', agents: 'teammates', reads: ['status'], model: 'haiku', criteria: 'Lima.' },
  ])
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
  const world = engine(on, {
    [`${SHIPPED_DIR}/alpha.md`]: checkFile('shipped alpha'),
    ...badFiles,
    [`${MACHINE_DIR}/mike.md`]: checkFile('Mike.'),
  })
  expect(await startSession($, world)).toEqual([
    { name: 'alpha', ...DEFAULTS, criteria: 'shipped alpha' },
    { name: 'mike', ...DEFAULTS, criteria: 'Mike.' },
  ])
  const reportedPaths = Object.keys(badFiles).map(path => world.toasts.filter(toast => toast.includes(`${path}:`)).length)
  expect(reportedPaths).toEqual([1, 1, 1, 1, 1, 1])
  expect(world.toasts).toHaveLength(6)

  await startSession($, world)
  expect(world.toasts).toHaveLength(6)
})
