import type { EngineInterface } from 'claude-code'

import type { AgentScope, Audience, Check, DigestPart, Trigger } from '../types'
import { machineLocalDirectory, reportSkipped, toastOnce } from './settings'

const TRIGGERS: readonly Trigger[] = ['turn-end', 'refusal', 'teammate-idle', 'compaction', 'commit', 'secret-match']

const AUDIENCES: readonly Audience[] = ['nudge', 'flag', 'both']

const AGENT_SCOPES: readonly AgentScope[] = ['main', 'teammates', 'all']

const DIGEST_PARTS: readonly DigestPart[] = ['prompts', 'replies', 'calls', 'results', 'exits', 'status', 'shared', 'notes', 'plan']

const KEYS = ['triggers', 'audience', 'agents', 'reads', 'model'] as const

type Key = (typeof KEYS)[number]

const DEFAULT_MODEL = 'haiku'

const CHECK_SUFFIX = '.md'

// A name stands in the judge's prompt and as a key of its JSON answer.
const CHECK_NAME = /^[a-z0-9][a-z0-9-]*$/

const FENCE = '---'

/** A frontmatter value: a scalar, or a list written `[a, b]`. */
type Value = string | readonly string[]

export const isOneOf = <T extends string>(allowed: readonly T[], value: string): value is T => (allowed as readonly string[]).includes(value)

export const unquoted = (text: string) => text.replace(/^(["'])(.*)\1$/, '$2')

function parseValue(text: string): Value {
  if (!text.startsWith('[')) return unquoted(text)
  if (!text.endsWith(']')) throw new Error(`the list ${text} has no closing ]`)
  const items = text
    .slice(1, -1)
    .split(',')
    .map(item => unquoted(item.trim()))
  return items.filter(item => item !== '')
}

function parseFrontmatter(lines: readonly string[]): Map<Key, Value> {
  const fields = new Map<Key, Value>()
  for (const line of lines) {
    // A # starts a comment only after a space, as in YAML.
    const content = line.replace(/(^|\s)#.*$/, '').trim()
    if (content === '') continue
    const colon = content.indexOf(':')
    if (colon <= 0) throw new Error(`the frontmatter line "${line}" is not "key: value"`)
    const key = content.slice(0, colon).trim()
    if (!isOneOf(KEYS, key)) throw new Error(`the frontmatter key "${key}" is none of ${KEYS.join(', ')}`)
    if (fields.has(key)) throw new Error(`the frontmatter sets "${key}" twice`)
    fields.set(key, parseValue(content.slice(colon + 1).trim()))
  }
  return fields
}

function required(fields: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = fields.get(key)
  if (value === undefined) throw new Error(`the frontmatter has no "${key}"`)
  return value
}

function choice<T extends string>(fields: ReadonlyMap<Key, Value>, key: Key, allowed: readonly T[]): T {
  const value = required(fields, key)
  if (typeof value !== 'string') throw new Error(`"${key}" is a list, and takes one of ${allowed.join(', ')}`)
  if (!isOneOf(allowed, value)) throw new Error(`"${key}" is "${value}", which is none of ${allowed.join(', ')}`)
  return value
}

/** A scalar counts as a list of one. */
function list<T extends string>(fields: ReadonlyMap<Key, Value>, key: Key, allowed: readonly T[]): T[] {
  const value = required(fields, key)
  const items = typeof value === 'string' ? [value] : value
  if (items.length === 0) throw new Error(`"${key}" is empty`)
  const known: T[] = []
  for (const item of items) {
    if (!isOneOf(allowed, item)) throw new Error(`"${key}" holds "${item}", which is none of ${allowed.join(', ')}`)
    known.push(item)
  }
  return known
}

function model(fields: ReadonlyMap<Key, Value>): string {
  const value = fields.get('model') ?? DEFAULT_MODEL
  if (typeof value !== 'string') throw new Error('"model" is a list, and takes one model')
  if (value === '') throw new Error('"model" is empty')
  return value
}

/**
 * The check a file holds, or undefined when its body is empty, which disables the check of that name. Throws, naming
 * the mistake, when the name or the frontmatter is not a check's.
 */
function parseCheck(name: string, text: string): Check | undefined {
  if (!CHECK_NAME.test(name)) throw new Error(`the name "${name}" is not lowercase letters, digits and hyphens`)
  if (text.trim() === '') return undefined
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== FENCE) throw new Error(`the file does not open with a ${FENCE} line before its frontmatter`)
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE)
  if (end < 0) throw new Error(`the frontmatter has no closing ${FENCE} line`)
  const criteria = lines
    .slice(end + 1)
    .join('\n')
    .trim()
  if (criteria === '') return undefined
  const fields = parseFrontmatter(lines.slice(1, end))
  return {
    name,
    triggers: list(fields, 'triggers', TRIGGERS),
    audience: choice(fields, 'audience', AUDIENCES),
    agents: choice(fields, 'agents', AGENT_SCOPES),
    reads: list(fields, 'reads', DIGEST_PARTS),
    model: model(fields),
    criteria,
  }
}

/** The directories checks are read from, in rising precedence; `machine` is absent where no home is named. */
type Directories = { shipped: string; repository: string; machine: string | undefined }

async function checkDirectories($: EngineInterface): Promise<Directories> {
  const root = await $.session.root()
  const local = await machineLocalDirectory($)
  return { shipped: `${$.plugin.root}/checks`, repository: `${root}/.claude/watcher/checks`, machine: local === undefined ? undefined : `${local}/checks` }
}

/** The file that decided a check's name: the check it holds, or undefined where it turns the check off. */
type Decided = { check: Check | undefined; directory: string }

/** What the repository's file of a name does to the shipped checks. */
type Change = 'turns off' | 'replaces' | 'adds'

const CHANGES: readonly Change[] = ['turns off', 'replaces', 'adds']

function changeOf(name: string, file: Decided, shipped: ReadonlySet<string>): Change | undefined {
  if (file.check !== undefined) return shipped.has(name) ? 'replaces' : 'adds'
  return shipped.has(name) ? 'turns off' : undefined
}

/** `a`, `a and b`, or `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

/**
 * Toasts what the repository's files still in force do to the shipped checks, once per repository and text:
 * `watcher: this repository turns off secret-in-transcript, replaces drift and adds deploy-gate`.
 */
function reportRepository($: EngineInterface, directory: string, shipped: ReadonlySet<string>, decided: ReadonlyMap<string, Decided>) {
  const byChange = new Map<Change, string[]>()
  for (const [name, file] of decided) {
    if (file.directory !== directory) continue
    const change = changeOf(name, file, shipped)
    if (change !== undefined) byChange.set(change, [...(byChange.get(change) ?? []), name])
  }
  const parts = CHANGES.flatMap(change => {
    const names = byChange.get(change)
    return names === undefined ? [] : [`${change} ${listed(names.sort())}`]
  })
  if (parts.length === 0) return
  const text = `watcher: this repository ${listed(parts)}`
  toastOnce($, text, `${directory}\n${text}`)
}

/** The check files' names in `directory`; none where it is missing, and none, reported, where it cannot be listed. */
async function checkFileNames($: EngineInterface, directory: string): Promise<string[]> {
  if (!(await $.fs.exists(directory))) return []
  try {
    const entries = await $.fs.list(directory)
    return entries
      .filter(entry => entry.kind !== 'dir')
      .map(entry => entry.name)
      .filter(name => name.endsWith(CHECK_SUFFIX))
  } catch (err) {
    reportSkipped($, directory, String(err))
    return []
  }
}

/** Applies one file over the checks read so far: it replaces or disables the check of its name, or is reported. */
async function applyFile($: EngineInterface, decided: Map<string, Decided>, directory: string, fileName: string) {
  const path = `${directory}/${fileName}`
  const name = fileName.slice(0, -CHECK_SUFFIX.length)
  let check: Check | undefined
  try {
    const text = await $.fs.read(path)
    check = parseCheck(name, text)
  } catch (err) {
    reportSkipped($, path, err instanceof Error ? err.message : String(err))
    return
  }
  decided.set(name, { check, directory })
}

async function applyDirectory($: EngineInterface, decided: Map<string, Decided>, directory: string) {
  for (const fileName of await checkFileNames($, directory)) await applyFile($, decided, directory, fileName)
}

/**
 * The checks in force, sorted by name. A file replaces the check of its name from a location of lower precedence; a
 * bad file is reported and skipped, so the check it would have replaced stays in force. What the repository's files
 * change is reported too.
 */
export async function loadChecks($: EngineInterface): Promise<readonly Check[]> {
  const { shipped, repository, machine } = await checkDirectories($)
  const decided = new Map<string, Decided>()
  await applyDirectory($, decided, shipped)
  const shippedNames = new Set(decided.keys())
  await applyDirectory($, decided, repository)
  if (machine !== undefined) await applyDirectory($, decided, machine)
  reportRepository($, repository, shippedNames, decided)
  return [...decided.values()]
    .flatMap(file => (file.check === undefined ? [] : [file.check]))
    .sort((left, right) => left.name.localeCompare(right.name))
}
