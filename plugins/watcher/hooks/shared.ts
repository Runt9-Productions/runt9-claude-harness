import type { EngineInterface, ProcessRunResult } from 'claude-code'

import type { PostedFlag, SessionEntry, SharedFinding } from '../types'

const ENTRY_PREFIX = 'session:'

const MINUTE_MS = 60_000

const HOUR_MS = 60 * MINUTE_MS

const DAY_MS = 24 * HOUR_MS

const SHARED_FOR_MS = DAY_MS

// Kept this long, and no more of them, so the store, whose whole file is capped at 4 MiB, stays small.
const KEPT_FOR_MS = 3 * DAY_MS

const KEPT_ENTRIES = 100

const MAX_FILES = 100

const MAX_FINDINGS = 20

const MAX_FLAGS = 20

const MAX_GOAL_CHARS = 200

// How much of the other sessions the overlap check is shown.
const SHOWN_SESSIONS = 10

const SHOWN_FILES = 30

const SHOWN_FINDINGS = 5

const EMPTY: SessionEntry = { files: [], findings: [], flags: [], updatedAt: 0 }

/** Where a session runs: what an entry records beside its own work. `top` is the session's root outside a repository. */
export type Location = { repository: string | undefined; top: string; branch: string | undefined }

/** A path with forward slashes, as git and the knowledge base's `sources` write it. */
function posix(path: string): string {
  return path.replaceAll('\\', '/')
}

/** `path` relative to `top` when inside it, else as given. */
export function relativeTo(top: string | undefined, path: string): string {
  const file = posix(path)
  if (top === undefined) return file
  const prefix = `${posix(top)}/`
  return file.startsWith(prefix) ? file.slice(prefix.length) : file
}

async function gitTopAndBranch($: EngineInterface, root: string): Promise<{ top?: string; branch?: string }> {
  let run: ProcessRunResult
  try {
    run = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], { cwd: root })
  } catch {
    // git cannot start here; the entry then records no branch.
    return {}
  }
  if (run.exitCode !== 0) return {}
  const [top, branch] = run.stdout.split('\n')
  // A detached HEAD reads as the word HEAD.
  return { top: top === '' ? undefined : top, branch: branch === '' || branch === 'HEAD' ? undefined : branch }
}

/** The repository, working tree and branch the session runs in, read from the working copy now. */
export async function location($: EngineInterface): Promise<Location> {
  const root = await $.session.root()
  const repo = await $.session.repo()
  if (repo === null) return { repository: undefined, top: root, branch: undefined }
  const git = await gitTopAndBranch($, root)
  return { repository: repo.root, top: git.top ?? root, branch: git.branch }
}

// The store holds under these keys only what updateEntry and carryOver wrote.
function entryOf(stored: unknown): SessionEntry | undefined {
  return stored as SessionEntry | undefined
}

// The store has no compare-and-set, so this process's reads and writes of its own entry, and the entry's move to a
// new id, go one at a time.
let entryWork: Promise<unknown> = Promise.resolve()

function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = entryWork.then(work)
  entryWork = run.catch(() => undefined)
  return run
}

// The id a `/clear` in this process ended, while its entry waits for the session's next id to take it over.
let clearedId: string | undefined

/** Marks the session id a `/clear` ended, so the session goes on with the entry kept under it. */
export function noteCleared(sessionId: string) {
  // A second /clear before the entry moved leaves it under the first id.
  clearedId ??= sessionId
}

/**
 * Moves the entry, keeping its files and findings as the session's own. The goal goes, since after a `/clear` the
 * judge reads it from the prompts anew, and so do the waiting flags: board empties its decisions when the session id
 * changes, so none of them can be answered.
 */
async function carryOver($: EngineInterface, from: string, to: string) {
  const earlier = entryOf(await $.store.get(from))
  if (earlier === undefined) return
  await $.store.set(to, { ...earlier, goal: undefined, flags: [] })
  await $.store.delete(from)
}

/** This session's key, taking over the entry a `/clear` left. Called only from inside `queued`. */
async function entryKey($: EngineInterface): Promise<string> {
  const id = await $.session.id()
  const key = `${ENTRY_PREFIX}${id}`
  // Until the id changes, the write still belongs under the cleared one.
  if (clearedId === undefined || clearedId === id) return key
  await carryOver($, `${ENTRY_PREFIX}${clearedId}`, key)
  clearedId = undefined
  return key
}

/** This session's entry, or undefined before its first write. */
async function ownEntry($: EngineInterface): Promise<SessionEntry | undefined> {
  return queued(async () => entryOf(await $.store.get(await entryKey($))))
}

async function updateEntry($: EngineInterface, change: (entry: SessionEntry, here: Location) => SessionEntry) {
  await queued(async () => {
    const key = await entryKey($)
    const here = await location($)
    const changed = change({ ...EMPTY, ...entryOf(await $.store.get(key)) }, here)
    await $.store.set(key, { ...changed, ...here, updatedAt: await $.clock.now() })
  })
}

export async function noteFileChanged($: EngineInterface, path: string) {
  await updateEntry($, (entry, here) => {
    const file = relativeTo(here.top, path)
    const files = [...entry.files.filter(kept => kept !== file), file].slice(-MAX_FILES)
    return { ...entry, files }
  })
}

export async function isGoalUnknown($: EngineInterface): Promise<boolean> {
  return (await ownEntry($))?.goal === undefined
}

/** Keeps the first line of `goal` as the session's goal, unless it has one. */
export async function noteGoal($: EngineInterface, goal: string) {
  const line = (goal.trim().split('\n')[0] ?? '').slice(0, MAX_GOAL_CHARS)
  if (line === '') return
  await updateEntry($, entry => (entry.goal === undefined ? { ...entry, goal: line } : entry))
}

export async function noteFindings($: EngineInterface, findings: readonly SharedFinding[]) {
  if (findings.length === 0) return
  await updateEntry($, entry => ({ ...entry, findings: [...entry.findings, ...findings].slice(-MAX_FINDINGS) }))
}

/** The flags this session posted whose answers have not been read, kept across a restart that resumes its id. */
export async function waitingFlags($: EngineInterface): Promise<readonly PostedFlag[]> {
  return (await ownEntry($))?.flags ?? []
}

export async function rememberFlag($: EngineInterface, flag: PostedFlag) {
  await updateEntry($, entry => ({ ...entry, flags: [...entry.flags, flag].slice(-MAX_FLAGS) }))
}

export async function keepFlags($: EngineInterface, isKept: (flag: PostedFlag) => boolean) {
  await updateEntry($, entry => ({ ...entry, flags: entry.flags.filter(isKept) }))
}

type KeyedEntry = { key: string; entry: SessionEntry }

/** Every session's entry, the newest first. */
async function allEntries($: EngineInterface): Promise<KeyedEntry[]> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(ENTRY_PREFIX))
  const entries: KeyedEntry[] = []
  for (const key of keys) entries.push({ key, entry: { ...EMPTY, ...entryOf(await $.store.get(key)) } })
  return entries.sort((left, right) => right.entry.updatedAt - left.entry.updatedAt)
}

/** Deletes the entries of sessions gone quiet, so the store stays small. */
export async function pruneEntries($: EngineInterface) {
  const now = await $.clock.now()
  const entries = await allEntries($)
  for (const [index, { key, entry }] of entries.entries()) {
    const isOld = entry.updatedAt < now - KEPT_FOR_MS
    if (isOld || index >= KEPT_ENTRIES) await $.store.delete(key)
  }
}

/** `25 minutes ago`, or `3 hours ago`, rounded down. */
function ageText(ms: number): string {
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} minutes ago`
  return `${Math.floor(ms / HOUR_MS)} hours ago`
}

function worktreeText(entry: SessionEntry): string {
  if (entry.top === undefined || entry.repository === undefined) return ''
  return entry.top === entry.repository ? '' : ` in the worktree ${entry.top}`
}

/** `/work/repo on branch parser-fix`, naming the worktree when it is not the main one. */
function whereText(entry: SessionEntry): string {
  const repository = entry.repository ?? `${entry.top ?? 'an unknown directory'}, outside a repository`
  const branch = entry.branch === undefined ? '' : ` on branch ${entry.branch}`
  return `${repository}${worktreeText(entry)}${branch}`
}

function workLines(entry: SessionEntry): string[] {
  const files = entry.files.slice(-SHOWN_FILES)
  const findings = entry.findings.slice(-SHOWN_FINDINGS).map(finding => `${finding.check} on ${finding.subject}: ${finding.summary}`)
  return [
    `  Goal: ${entry.goal ?? 'not known'}`,
    `  Files changed: ${files.length === 0 ? 'none' : files.join(', ')}`,
    ...(findings.length === 0 ? [] : [`  Findings: ${findings.join('; ')}`]),
  ]
}

/**
 * This session and the others updated within a day, as the overlap check reads them:
 *
 *   This session: /work/repo in the worktree /work/repo-docs on branch docs
 *     Goal: Rewrite the install guide.
 *     Files changed: docs/install.md
 *   Other sessions, updated within a day:
 *   - /work/repo on branch parser-fix, 25 minutes ago
 *     Goal: Fix the failing parser test.
 *     Files changed: src/parser.ts, docs/install.md
 *     Findings: drift on the main session: The work moved to the docs site while the request was the parser.
 */
export async function sharedText($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const ownKey = await queued(() => entryKey($))
  const entries = await allEntries($)
  const own = entries.find(keyed => keyed.key === ownKey)?.entry ?? { ...EMPTY, ...(await location($)) }
  const others = entries
    .filter(keyed => keyed.key !== ownKey)
    .filter(keyed => keyed.entry.updatedAt >= now - SHARED_FOR_MS)
    .slice(0, SHOWN_SESSIONS)
  const otherLines = others.flatMap(({ entry }) => [`- ${whereText(entry)}, ${ageText(now - entry.updatedAt)}`, ...workLines(entry)])
  const otherText = otherLines.length === 0 ? 'Other sessions: none updated within a day.' : ['Other sessions, updated within a day:', ...otherLines].join('\n')
  return [`This session: ${whereText(own)}`, ...workLines(own), otherText].join('\n')
}
