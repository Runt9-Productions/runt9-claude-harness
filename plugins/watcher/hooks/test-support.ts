import { mock } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { AgentInfo, FsEntry, ModelCompleteInput, On, RenderSurface, SessionAppendInput, ToolCallResult } from 'claude-code'
import type { BoardDecision } from 'board'

const WORK = '/work'
export const ROOT = `${WORK}/repo`
export const HOME = '/home/user'
export const JUDGE_PROMPT = 'SYNTHETIC JUDGE INSTRUCTIONS'
export const HOUR_MS = 60 * 60_000

const SETTINGS_PATH = `${HOME}/.claude/local/watcher/settings.json`
const TOP_AND_BRANCH = 'git rev-parse --show-toplevel --abbrev-ref HEAD'
const CHECKS_MARK = '/checks/'
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const SCOUT: AgentInfo = { id: 'a-scout', teammateId: 'scout@crew', name: 'scout', type: 'teammate', status: 'running', description: 'synthetic brief' }
export const HELPER: AgentInfo = { id: 'a-helper', type: 'Explore', status: 'running', description: 'synthetic search' }

/** A row the watcher appended, with the loop it went to (`undefined` for the main session). */
export type Told = { to: string | undefined; text: string }

export type World = {
  clock: MockClock
  /** Each model call the plugin made, in order. */
  calls: ModelCompleteInput[]
  /** The debug log, in order. */
  logs: string[]
  toasts: string[]
  /** The shipped checks, by name; a test may add one while it runs. */
  checks: Record<string, string>
  /** What the model answers each call; by default every check carried, none raised. */
  answers: string[]
  /** The permission verdict for a tool's calls, by tool; allowed when absent. */
  verdicts: Record<string, { decision: 'deny'; reason: string; rule: string }>
  /** Where the session draws: a terminal unless a test makes it a -p run. */
  surfaces: RenderSurface[]
  /** The text of `~/.claude/local/watcher/settings.json`; the file is missing while undefined. */
  settings?: string
  /** Agents whose loop refuses an appended row, as a teammate idle between turns does. */
  refusing: Set<string>
  /** Each message the watcher sent, with the agent it went to. */
  sent: Told[]
  /** Each prompt the watcher submitted. */
  submitted: string[]
  /** The rows the watcher appended so far. */
  told: () => Told[]
  /** The watcher's `$.store`, which outlives a session; a test may fill it as an earlier run left it. */
  store: Map<string, unknown>
  /** What `$.session.id()` answers; a test may change it to stand in for another session. */
  sessionId: string
  /** The session's root, which git also reports as its working tree, and its branch. */
  top: string
  branch: string
  /** Files on disk beside the shipped checks, by absolute path. */
  files: Record<string, string>
}

/** The entries directly under `directory` among the `files` paths. */
function listing(files: Record<string, string>, directory: string): FsEntry[] {
  const kinds = new Map<string, FsEntry['kind']>()
  for (const path of Object.keys(files).filter(file => file.startsWith(`${directory}/`))) {
    const [name = '', ...deeper] = path.slice(directory.length + 1).split('/')
    kinds.set(name, deeper.length === 0 ? 'file' : 'dir')
  }
  return [...kinds].map(([name, kind]) => ({ name, kind, size: kind === 'file' ? 1 : 0, mtimeMs: 1, isLink: false }))
}

/** A check file's text. */
export function checkFile(triggers: string, reads: string, agents = 'all', model = 'haiku', audience = 'nudge'): string {
  return `---\ntriggers: [${triggers}]\naudience: ${audience}\nagents: ${agents}\nreads: [${reads}]\nmodel: ${model}\n---\nCriteria of a synthetic check.\n`
}

/** The names of the checks a prompt carries, in order. */
export function carried(call: ModelCompleteInput): string[] {
  const section = call.prompt.slice(call.prompt.indexOf('## Checks'), call.prompt.indexOf('## Record'))
  return [...section.matchAll(/^### (\S+)$/gm)].map(match => match[1] ?? '')
}

/** What a call's record says, after its checks. */
export const recordOf = (call: ModelCompleteInput | undefined) => call?.prompt.slice(call.prompt.indexOf('## Record')) ?? ''

const quietAnswer = (call: ModelCompleteInput) =>
  JSON.stringify({ checks: carried(call).map(name => ({ name, raised: false, confidence: 'low', summary: '', evidence: '', repeats: false })) })

/** An answer raising each entry given and no other check the call carried. */
export function raising(entries: readonly { name: string; summary: string; confidence?: string; repeats?: boolean }[]): string {
  const checks = entries.map(entry => ({ confidence: 'high', repeats: false, evidence: `EVIDENCE-OF-${entry.summary}`, raised: true, ...entry }))
  return JSON.stringify({ checks })
}

function textOf(row: SessionAppendInput): string {
  return row.message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

/** The engine nouns the plugin calls, answered in memory, and what the plugin sent through them. */
export function engine(on: On, checks: Record<string, string>, roster: readonly AgentInfo[] = []): World {
  const store = new Map<string, unknown>()
  const world: World = {
    clock: mock.clock(on),
    calls: [],
    logs: [],
    toasts: [],
    checks,
    answers: [],
    verdicts: {},
    surfaces: ['terminal'],
    refusing: new Set(),
    sent: [],
    submitted: [],
    told: () => [],
    store,
    sessionId: 'synthetic-session-1',
    top: ROOT,
    branch: 'synthetic-branch',
    files: {},
  }
  const isFileDirectory = (path: string) => Object.keys(world.files).some(file => file.startsWith(`${path}/`))
  on('session.append', { door: 'note' }, (_, e, next) => (e.agentId !== undefined && world.refusing.has(e.agentId) ? { deny: 'the loop is not running' } : next(e)))
  const session = mock.session(on)
  world.told = () =>
    session
      .appended()
      .filter(row => row.door === 'note')
      .map(row => ({ to: row.agentId, text: textOf(row) }))
  on('session.send', (_, e) => {
    world.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('prompt.submit', (_, e) => {
    world.submitted.push(e.text)
    return { text: e.text }
  })
  on('session.root', () => ({ value: world.top }))
  on('session.id', () => ({ value: world.sessionId }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('process.run', (_, e) => {
    const command = e.argv.join(' ')
    if (command !== TOP_AND_BRANCH) throw new Error(`no stand-in runs ${command}`)
    return { value: { exitCode: 0, stdout: `${world.top}\n${world.branch}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  // The shipped directory holds the checks, and `files` what else there is; the repository's and the machine's
  // checks are missing.
  on('fs.exists', (_, e) => {
    if (e.path === SETTINGS_PATH) return { value: world.settings !== undefined }
    if (e.path in world.files || isFileDirectory(e.path)) return { value: true }
    return { value: !e.path.startsWith(WORK) && !e.path.startsWith(HOME) }
  })
  on('fs.list', (_, e) => {
    const path = e.path ?? ROOT
    if (isFileDirectory(path)) return { value: listing(world.files, path) }
    const entries: FsEntry[] = Object.keys(world.checks).map(name => ({ name: `${name}.md`, kind: 'file', size: 1, mtimeMs: 1, isLink: false }))
    return { value: entries }
  })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/judge.md')) return { value: JUDGE_PROMPT }
    if (e.path === SETTINGS_PATH && world.settings !== undefined) return { value: world.settings }
    const file = world.files[e.path]
    if (file !== undefined) return { value: file }
    const name = e.path.slice(e.path.lastIndexOf(CHECKS_MARK) + CHECKS_MARK.length, -'.md'.length)
    const text = world.checks[name]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    // As the real store keeps it: JSON, an undefined field dropped.
    store.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('agent.list', () => ({ value: [...roster] }))
  on('session.surfaces', () => ({ value: world.surfaces }))
  on('tool.check', (_, e) => world.verdicts[e.tool] ?? { decision: 'allow' })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PermissionDenied', () => ({}))
  on('classic.TeammateIdle', () => ({}))
  on('model.complete', (_, e) => {
    world.calls.push(e)
    return { value: { isAnswered: true, text: world.answers.shift() ?? quietAnswer(e), usage: USAGE } }
  })
  on('ui.log', (_, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  return world
}

export function prompt($: Engine, text: string, agentId?: string, kind: 'composer' | 'unclassified' = 'composer') {
  const row: SessionAppendInput = {
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    door: 'prompt',
    origin: { kind },
    uuid: crypto.randomUUID(),
    ...(agentId === undefined ? {} : { agentId }),
  }
  return $.session.append(row)
}

export function reply($: Engine, text: string) {
  return $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'synthetic-model' },
    uuid: crypto.randomUUID(),
  })
}

/** Ends a turn of the loop and lets the judgment it started run. */
export async function endTurn($: Engine, world: World, agentId?: string) {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: crypto.randomUUID(), reason: 'answer', ...(agentId === undefined ? {} : { agentId }) })
  await world.clock.advance(10)
}

/** A prompt, then the end of its turn, judged with `answer`. */
export async function judgedTurn($: Engine, world: World, answer: string, agentId?: string) {
  world.answers.push(answer)
  await prompt($, `ASK_${crypto.randomUUID()}`, agentId, agentId === undefined ? 'composer' : 'unclassified')
  await endTurn($, world, agentId)
}

export const bashResult = (result: ToolCallResult) => () => result

/**
 * A stand-in for board, as its README describes it to a plugin keeping its answers: `ask_decision` from a plugin
 * records the decision with that plugin's name, and the `answer` command, with args `<id>|<option>|<note>`, writes the
 * owner's answer into `decisions`; an empty option is Dismiss, which board records with no `chosenOption`. An inline
 * plugin's hooks close over nothing of this file, so each spells its values.
 */
export const BOARD: Plugin = {
  name: 'board',
  register(on) {
    on('tool.call', { tool: 'mcp__board__ask_decision' }, async ($, e, next) => {
      const { value = [] } = await $.state.get({ plugin: 'board', key: 'decisions' } as const)
      const id = `D${value.length + 1}`
      const input = e as unknown as { question: string; context?: string; options: { label: string }[]; isAnswerKept?: boolean }
      const plugin = next.origin.plugin === 'engine' ? undefined : next.origin.plugin
      const decision = { id, question: input.question, context: input.context, options: input.options, plugin, isAnswerKept: input.isAnswerKept === true }
      await $.state.set({ plugin: 'board', key: 'decisions' } as const, [...value, decision])
      return { result: `Posted ${id}. Its answer is kept in the board's decisions for ${plugin ?? 'nobody'}; no loop is told it.` }
    })
    on('command.run', { command: 'answer' }, async ($, e) => {
      const [id, option = '', note] = e.args.split('|')
      const { value = [] } = await $.state.get({ plugin: 'board', key: 'decisions' } as const)
      const chosenOption = option === '' ? undefined : option
      const label = chosenOption ?? 'Dismissed without choosing an option'
      const answer = note === undefined ? label : `${label}. Note: ${note}`
      const answered = value.map(d => (d.id === id ? { ...d, answer, chosenOption, note, delivery: 'seen' as const } : d))
      await $.state.set({ plugin: 'board', key: 'decisions' } as const, answered)
      return { text: 'answered' }
    })
    // As board restores its decisions after a restart: args are the decisions as JSON.
    on('command.run', { command: 'restore' }, async ($, e) => {
      await $.state.set({ plugin: 'board', key: 'decisions' } as const, JSON.parse(e.args) as BoardDecision[])
      return { text: 'restored' }
    })
    on('command.run', { command: 'decisions' }, async $ => {
      const { value = [] } = await $.state.get({ plugin: 'board', key: 'decisions' } as const)
      return { text: JSON.stringify(value) }
    })
  },
}

/** The decisions on the stand-in board, oldest first. A test's `$` has no `state` of its own to read them with. */
export async function boardDecisions($: Engine): Promise<BoardDecision[]> {
  const listed = await $.command.run({ command: 'decisions' } as never)
  return JSON.parse(listed.text ?? '[]') as BoardDecision[]
}

/** The owner presses `option` on board decision `id`, with a note when given, and the watcher acts on it. */
export async function answerFlag($: Engine, world: World, id: string, option: string, note?: string) {
  const args = note === undefined ? `${id}|${option}` : `${id}|${option}|${note}`
  await $.command.run({ command: 'answer', args } as never)
  await world.clock.advance(10)
}
