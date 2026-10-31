import type { EngineInterface } from 'claude-code'

import type { LocalSettings, SandboxValues } from './settings-file'
import { parseLocalSettings, renderLocalSettings, sandboxValues, withSandboxValues } from './settings-file'

const HOLD_PREFIX = 'sandbox:'

const HELD_ROOT_PREFIX = 'held:'

// Auto-allow off, so a sandboxed command no allow rule covers still prompts, and a prompt while away is refused.
const AWAY_VALUES: SandboxValues = { enabled: true, autoAllowBashIfSandboxed: false }

const EMPTY_SETTINGS = renderLocalSettings({})

/** A value in a higher settings source that undoes one of AWAY_VALUES, and what it leaves running while away. */
type Override = { key: keyof SandboxValues; value: boolean; consequence: string }

const OVERRIDES: readonly Override[] = [
  { key: 'enabled', value: false, consequence: 'the sandbox stays off' },
  { key: 'autoAllowBashIfSandboxed', value: true, consequence: 'sandboxed Bash runs without a prompt' },
]

/**
 * The sessions holding the sandbox on in one root, what the two keys held before the first of them did, and whether
 * that first holder created the local file.
 */
type SandboxHold = { holders: string[]; earlier: SandboxValues; isFileCreated: boolean }

const holdKey = (root: string) => `${HOLD_PREFIX}${root}`

const heldRootKey = (sessionId: string) => `${HELD_ROOT_PREFIX}${sessionId}`

const localSettingsPath = (root: string) => `${root}/.claude/settings.local.json`

function isSandboxHold(value: unknown): value is SandboxHold {
  if (typeof value !== 'object' || value === null) return false
  const { holders, earlier, isFileCreated } = value as Partial<SandboxHold>
  if (!Array.isArray(holders)) return false
  if (typeof earlier !== 'object' || earlier === null) return false
  if (typeof isFileCreated !== 'boolean') return false
  return holders.every(holder => typeof holder === 'string')
}

async function loadHold($: EngineInterface, key: string): Promise<SandboxHold | undefined> {
  const value: unknown = await $.store.get(key)
  return isSandboxHold(value) ? value : undefined
}

/** The root whose sandbox the session holds on, which a /cd or a worktree move can leave behind. */
async function loadHeldRoot($: EngineInterface, sessionId: string): Promise<string | undefined> {
  const value: unknown = await $.store.get(heldRootKey(sessionId))
  return typeof value === 'string' ? value : undefined
}

/**
 * Sets AWAY_VALUES in the session root's local settings, where a key overrides only that key, so the rest of the
 * sandbox config still comes from the user's settings. `sessionId` joins the holders, and the first holder records
 * what it found. A session that still holds another root gives that one up.
 */
export async function holdSandbox($: EngineInterface, sessionId: string) {
  const root = await $.session.root()
  const heldRoot = await loadHeldRoot($, sessionId)
  if (heldRoot !== undefined && heldRoot !== root) await releaseSandbox($, sessionId)
  const key = holdKey(root)
  const path = localSettingsPath(root)
  const isHeld = await editLocalSettings($, path, 'The sandbox is off while away', async (settings, isMissing) => {
    const hold = (await loadHold($, key)) ?? { holders: [], earlier: sandboxValues(settings), isFileCreated: isMissing }
    const others = hold.holders.filter(holder => holder !== sessionId)
    // Recorded before the file changes: a file changed with no record would keep the sandbox on for good.
    await $.store.set(key, { ...hold, holders: [...others, sessionId] })
    await $.store.set(heldRootKey(sessionId), root)
    return withSandboxValues(settings, AWAY_VALUES)
  })
  if (isHeld) await toastOverrides($, path, root)
}

/** Takes `sessionId` off the holders of the root it holds, and puts the earlier values back once none is left. */
export async function releaseSandbox($: EngineInterface, sessionId: string) {
  const root = await loadHeldRoot($, sessionId)
  if (root === undefined) return
  await $.store.delete(heldRootKey(sessionId))
  const key = holdKey(root)
  const hold = await loadHold($, key)
  if (hold === undefined) return
  const holders = hold.holders.filter(holder => holder !== sessionId)
  if (holders.length === 0) {
    await putSandboxBack($, root, hold)
    return
  }
  await $.store.set(key, { ...hold, holders })
}

/**
 * Moves an away session's hold to the root it works in now. A /cd or a worktree move raises no event of its own, and
 * without this the new root's commands would run unsandboxed while away. A session whose hold never took holds no
 * root and is left alone, or a broken file would be toasted at every request.
 */
export async function followRoot($: EngineInterface) {
  const sessionId = await $.session.id()
  const heldRoot = await loadHeldRoot($, sessionId)
  if (heldRoot === undefined) return
  const root = await $.session.root()
  if (heldRoot === root) return
  await holdSandbox($, sessionId)
}

/**
 * Puts back the values recorded for the session root, whoever is listed as holding it, so a session there still away
 * loses its sandbox too. Whether there was a hold and the values are back.
 */
export async function putSandboxBackForEveryHolder($: EngineInterface): Promise<boolean> {
  const root = await $.session.root()
  const hold = await loadHold($, holdKey(root))
  if (hold === undefined) return false
  return putSandboxBack($, root, hold)
}

/** Tells a session starting present that a hold, live or left by a session that ended while away, is on its root. */
export async function toastIfHeld($: EngineInterface) {
  const root = await $.session.root()
  const hold = await loadHold($, holdKey(root))
  if (hold === undefined) return
  $.ui.toast(`The sandbox is held on in ${root} for a session that is away or ended while away; /mode present puts it back`)
}

/** Whether the earlier values are back. Values not back keep the record, with no holders, for /mode present to retry. */
async function putSandboxBack($: EngineInterface, root: string, hold: SandboxHold): Promise<boolean> {
  const key = holdKey(root)
  const path = localSettingsPath(root)
  const consequence = 'The sandbox stays on until /mode present can put it back'
  const isPutBack = await editLocalSettings($, path, consequence, settings => {
    const restored = withSandboxValues(settings, hold.earlier)
    // Claude Code adds the file to the global git excludes only when it writes it, so `git add -A` would commit this one.
    const isLeftEmpty = renderLocalSettings(restored) === EMPTY_SETTINGS
    return hold.isFileCreated && isLeftEmpty ? undefined : restored
  })
  if (isPutBack) await $.store.delete(key)
  else await $.store.set(key, { ...hold, holders: [] })
  return isPutBack
}

/**
 * Applies `edit` to the local settings at `path`, a missing file counting as `{}`, and writes the result unless it is
 * unchanged, so a file away has nothing to change in keeps its own formatting. An edit answering undefined deletes the
 * file. Whether the file holds the edit: one that cannot be read, does not hold a JSON object or cannot be written is
 * left as it was, and toasted after `consequence`.
 */
async function editLocalSettings(
  $: EngineInterface,
  path: string,
  consequence: string,
  edit: (settings: LocalSettings, isMissing: boolean) => LocalSettings | undefined | Promise<LocalSettings | undefined>,
): Promise<boolean> {
  let text: string | undefined
  try {
    text = await readLocalSettingsText($, path)
  } catch (err) {
    $.ui.toast(`${consequence}: reading ${path} failed (${String(err)})`)
    return false
  }
  const settings = parseLocalSettings(text ?? EMPTY_SETTINGS)
  if (settings === undefined) {
    $.ui.toast(`${consequence}: ${path} does not hold a JSON object`)
    return false
  }
  const edited = await edit(settings, text === undefined)
  if (edited === undefined) {
    const isGone = await isDeleted($, path)
    if (isGone) return true
  }
  const editedText = renderLocalSettings(edited ?? {})
  if (editedText === renderLocalSettings(settings)) return true
  try {
    await $.fs.write(path, editedText)
  } catch (err) {
    $.ui.toast(`${consequence}: writing ${path} failed (${String(err)})`)
    return false
  }
  return true
}

/** The file's text, or undefined when there is none. */
async function readLocalSettingsText($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  return $.fs.read(path)
}

/**
 * Whether `rm` deleted the file. `$.fs` has no delete, and where `rm` cannot run, as on Windows, the caller writes
 * `{}` in its place, which still puts the sandbox back.
 */
async function isDeleted($: EngineInterface, path: string): Promise<boolean> {
  try {
    const { exitCode } = await $.process.run(['rm', '--', path])
    return exitCode === 0
  } catch {
    return false
  }
}

/**
 * Toasts each value above the session root's local file that undoes one of AWAY_VALUES, since it wins over away's and
 * nothing else would say so. One toast reads:
 *
 * --settings sets sandbox.enabled to false, which wins over /work/wt/.claude/settings.local.json, so the sandbox stays
 * off while away
 */
async function toastOverrides($: EngineInterface, path: string, root: string) {
  for (const { source, values } of await higherSandboxValues($, root)) {
    for (const { key, value, consequence } of OVERRIDES) {
      if (values[key] !== value) continue
      $.ui.toast(`${source} sets sandbox.${key} to ${String(value)}, which wins over ${path}, so ${consequence} while away`)
    }
  }
}

/**
 * The two keys in each source Claude Code ranks above the session root's local file, named as a toast names it: the
 * repository root's local file (the main working tree's for a worktree) where that is another file, `--settings`, and
 * managed settings.
 */
async function higherSandboxValues($: EngineInterface, root: string): Promise<{ source: string; values: SandboxValues }[]> {
  const sources: { source: string; values: SandboxValues }[] = []
  const repo = await $.session.repo()
  if (repo !== null && repo.root !== root) {
    const repoPath = localSettingsPath(repo.root)
    const repoSettings = await readIfReadable($, repoPath)
    if (repoSettings !== undefined) sources.push({ source: repoPath, values: sandboxValues(repoSettings) })
  }
  const flag = await $.settings.read({ source: 'flag' })
  sources.push({ source: '--settings', values: sandboxValues(flag) })
  const managed = await $.settings.read({ source: 'policy' })
  sources.push({ source: 'Managed settings', values: sandboxValues(managed) })
  return sources
}

/** The settings at `path`, `{}` for a missing file, or undefined for one that cannot be read or parsed and goes unchecked. */
async function readIfReadable($: EngineInterface, path: string): Promise<LocalSettings | undefined> {
  try {
    const text = await readLocalSettingsText($, path)
    return parseLocalSettings(text ?? EMPTY_SETTINGS)
  } catch {
    return undefined
  }
}
