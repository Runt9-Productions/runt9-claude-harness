import type { EngineInterface, ToolCallInput } from 'claude-code'

import { unquoted } from './checks'
import { cut } from './digest'
import { location, relativeTo } from './shared'

// Each file-editing tool and the argument naming its file.
const EDITING_TOOLS: Readonly<Record<string, string>> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }

const PLAN_NAMES = new Set(['checklist.md', 'spec.md', 'handoff.md'])

const REFERENCE_DIRECTORY = '.claude/reference'

const NOTE_SUFFIX = '.md'

// A bound on the walk, so a large knowledge base cannot hold a judgment.
const MAX_NOTE_FILES = 500

// How much of the notes and the plan one judgment is shown.
const SHOWN_NOTES = 4

const NOTE_CHARS = 2500

const SHOWN_PLANS = 3

const PLAN_CHARS = 3000

const FENCE = '---'

const SOURCES_KEY = /^sources:\s*(.*)$/

const LIST_ITEM = /^\s*-\s+(.*)$/

// How much text either side of a redacted secret the secret check is shown.
const AROUND_SECRET_CHARS = 150

/** A secret's shape, matched only where a known prefix or framing makes a false match unlikely. */
type SecretPattern = { kind: string; pattern: RegExp }

// Earlier patterns redact first, so a key that two would match is named by the more specific one.
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: 'private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { kind: 'GitHub token', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/g },
  { kind: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}/g },
  { kind: 'OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'Stripe live key', pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}/g },
  { kind: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
]

const REDACTION_MARK = /\[redacted [^\]]+\]/g

function argumentsOf(call: ToolCallInput): Record<string, unknown> {
  return call as unknown as Record<string, unknown>
}

/** The file a call edits, when its tool is one that edits a file. */
export function editedFile(call: ToolCallInput): string | undefined {
  const key = EDITING_TOOLS[call.tool]
  if (key === undefined) return undefined
  const path = argumentsOf(call)[key]
  return typeof path === 'string' ? path : undefined
}

/** The file a call reads, when it is a Read of a plan file: one named `checklist.md`, `spec.md` or `handoff.md`. */
export function planFileRead(call: ToolCallInput): string | undefined {
  if (call.tool !== 'Read') return undefined
  const path = argumentsOf(call).file_path
  if (typeof path !== 'string') return undefined
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return PLAN_NAMES.has(name) ? path : undefined
}

/**
 * The paths a note's frontmatter lists under `sources`, written either way YAML allows:
 *
 *   sources:
 *     - plugins/example/hooks/register.ts
 *
 *   sources: [plugins/example/hooks/register.ts]
 */
function sourcesOf(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== FENCE) return []
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE)
  const frontmatter = lines.slice(1, end < 0 ? 0 : end)
  const start = frontmatter.findIndex(line => SOURCES_KEY.test(line))
  if (start < 0) return []
  const inline = SOURCES_KEY.exec(frontmatter[start] ?? '')?.[1]?.trim() ?? ''
  const listed = inline.startsWith('[') ? inline.slice(1, -1).split(',') : listItems(frontmatter.slice(start + 1))
  return listed
    .map(item => unquoted(item.trim()).replace(/^\.\//, ''))
    .filter(item => item !== '')
}

/** The items of a block list, up to the first line that is not one. */
function listItems(lines: readonly string[]): string[] {
  const items: string[] = []
  for (const line of lines) {
    const item = LIST_ITEM.exec(line)?.[1]
    if (item === undefined) break
    items.push(item)
  }
  return items
}

/** The Markdown files under `directory`, at most MAX_NOTE_FILES of them. */
async function noteFiles($: EngineInterface, directory: string): Promise<string[]> {
  const found: string[] = []
  // Grows while it is walked, so each subdirectory found is walked in turn.
  const directories = [directory]
  for (const current of directories) {
    if (found.length >= MAX_NOTE_FILES) break
    for (const entry of await $.fs.list(current)) {
      const path = `${current}/${entry.name}`
      if (entry.kind === 'dir') directories.push(path)
      else if (entry.kind === 'file' && entry.name.endsWith(NOTE_SUFFIX)) found.push(path)
    }
  }
  return found.slice(0, MAX_NOTE_FILES)
}

/**
 * The knowledge base notes under `.claude/reference/` whose `sources` list a file in `edited`, or undefined when none
 * does. For one note:
 *
 *   [note .claude/reference/domains/parser.md, a source of which was edited: src/parser.ts]
 *   ---
 *   title: Parser
 *   ...
 */
export async function notesText($: EngineInterface, edited: readonly string[]): Promise<string | undefined> {
  if (edited.length === 0) return undefined
  const { top } = await location($)
  const directory = `${top}/${REFERENCE_DIRECTORY}`
  if (!(await $.fs.exists(directory))) return undefined
  const editedFiles = new Set(edited.map(path => relativeTo(top, path)))
  const shown: string[] = []
  for (const path of await noteFiles($, directory)) {
    const text = await $.fs.read(path)
    const listed = sourcesOf(text).filter(source => editedFiles.has(source))
    if (listed.length === 0) continue
    shown.push(`[note ${relativeTo(top, path)}, a source of which was edited: ${listed.join(', ')}]\n${cut(text, NOTE_CHARS)}`)
    if (shown.length === SHOWN_NOTES) break
  }
  return shown.length === 0 ? undefined : shown.join('\n\n')
}

/**
 * The plan files read, the latest few, as they stand now; undefined when none was read or none is left. For one:
 *
 *   [plan file docs/checklist.md]
 *   - [x] 01 Parse the header
 */
export async function planText($: EngineInterface, files: readonly string[]): Promise<string | undefined> {
  const root = await $.session.root()
  const shown: string[] = []
  for (const path of files.slice(-SHOWN_PLANS)) {
    if (!(await $.fs.exists(path))) continue
    shown.push(`[plan file ${relativeTo(root, path)}]\n${cut(await $.fs.read(path), PLAN_CHARS)}`)
  }
  return shown.length === 0 ? undefined : shown.join('\n\n')
}

/** `[redacted GitHub token: 40 characters, 3 distinct]`: enough for the judge to tell a real key from a placeholder. */
function redactionMark(kind: string, secret: string): string {
  return `[redacted ${kind}: ${secret.length} characters, ${new Set(secret).size} distinct]`
}

/** `text` with every match of a secret pattern replaced by a mark naming its kind, and whether there was one. */
export function redacted(text: string): { text: string; hasSecret: boolean } {
  let result = text
  for (const { kind, pattern } of SECRET_PATTERNS) result = result.replace(pattern, secret => redactionMark(kind, secret))
  return { text: result, hasSecret: result !== text }
}

/** The parts of a redacted text around each mark, so the judge sees what surrounds a secret wherever it sat. */
export function aroundSecrets(text: string): string {
  const spans: { start: number; end: number }[] = []
  for (const mark of text.matchAll(REDACTION_MARK)) {
    const start = Math.max(0, mark.index - AROUND_SECRET_CHARS)
    const end = Math.min(text.length, mark.index + mark[0].length + AROUND_SECRET_CHARS)
    const last = spans.at(-1)
    if (last !== undefined && start <= last.end) last.end = end
    else spans.push({ start, end })
  }
  return spans.map(span => text.slice(span.start, span.end)).join(' [...] ')
}
