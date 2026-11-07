import type { EngineInterface } from 'claude-code'

import type { AgentScope, Audience, Check, DigestPart, Trigger } from '../types'
import { machineLocalDirectory, reportSkipped } from './settings'

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

/** The directories checks are read from, lowest precedence first: shipped, the repository's, machine-local. */
async function checkDirectories($: EngineInterface): Promise<string[]> {
  const root = await $.session.root()
  const directories = [`${$.plugin.root}/checks`, `${root}/.claude/watcher/checks`]
  const local = await machineLocalDirectory($)
  if (local !== undefined) directories.push(`${local}/checks`)
  return directories
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
async function applyFile($: EngineInterface, byName: Map<string, Check>, directory: string, fileName: string) {
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
  if (check === undefined) byName.delete(name)
  else byName.set(name, check)
}

/**
 * The checks in force, sorted by name. A file replaces the check of its name from a location of lower precedence; a
 * bad file is reported and skipped, so the check it would have replaced stays in force.
 */
export async function loadChecks($: EngineInterface): Promise<readonly Check[]> {
  const byName = new Map<string, Check>()
  for (const directory of await checkDirectories($)) {
    for (const fileName of await checkFileNames($, directory)) {
      await applyFile($, byName, directory, fileName)
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}
