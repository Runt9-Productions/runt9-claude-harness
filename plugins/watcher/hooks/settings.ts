import type { EngineInterface } from 'claude-code'

import type { Confidence } from '../types'
import { CONFIDENCES } from './quiet'

/** The limits a machine may set in `settings.json`, each defaulting to the strict value below. */
export type Settings = {
  /** The least confidence a finding needs to be raised. */
  minConfidence: Confidence
  /** The most nudges each agent is sent in any hour. */
  nudgesPerHour: number
  /** The most flags each agent is posted in any hour. */
  flagsPerHour: number
  /** The most characters the record of one judge call runs to, its sections from outside the capture included. */
  maxRecordChars: number
  /** Whether a session nothing draws (`claude -p`, the SDK) is judged, each turn's end then waiting on the model. */
  judgeHeadless: boolean
}

// Strict, so that checks nobody has tuned yet err quiet.
const DEFAULTS: Settings = {
  minConfidence: 'high',
  nudgesPerHour: 3,
  flagsPerHour: 3,
  maxRecordChars: 40_000,
  judgeHeadless: false,
}

const SETTINGS_FILE = 'settings.json'

// What a toast has said already, so a bad file is reported once however often it is read.
const reported = new Set<string>()

/** Toasts that `what` was skipped and why, once per distinct text. */
export function reportSkipped($: EngineInterface, what: string, reason: string) {
  const text = `watcher skipped ${what}: ${reason}`
  if (reported.has(text)) return
  reported.add(text)
  $.ui.toast(text)
}

/** Writes `watcher <text>` to Claude Code's debug log, never the transcript. */
export function log($: EngineInterface, text: string) {
  $.ui.log(`watcher ${text}`, { to: 'debug' })
}

/** `~/.claude/local/watcher`, or undefined where the environment names no home. */
export async function machineLocalDirectory($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home === undefined ? undefined : `${home}/.claude/local/watcher`
}

function isWholeNumber(value: unknown): boolean {
  if (typeof value !== 'number') return false
  return Number.isInteger(value) && value >= 0
}

/** Why `value` cannot be the setting `key`, or undefined when it can. */
function settingProblem(key: keyof Settings, value: unknown): string | undefined {
  const shown = JSON.stringify(value)
  if (key === 'minConfidence') {
    const isConfidence = typeof value === 'string' && (CONFIDENCES as readonly string[]).includes(value)
    return isConfidence ? undefined : `it is ${shown}, none of ${CONFIDENCES.join(', ')}`
  }
  if (key === 'judgeHeadless') return typeof value === 'boolean' ? undefined : `it is ${shown}, not true or false`
  return isWholeNumber(value) ? undefined : `it is ${shown}, not a whole number of 0 or more`
}

const isSettingKey = (key: string): key is keyof Settings => Object.hasOwn(DEFAULTS, key)

/** The settings a parsed file gives over the defaults, reporting each entry that cannot be used and skipping it. */
function applied($: EngineInterface, path: string, parsed: unknown): Settings {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    reportSkipped($, path, 'it holds no JSON object')
    return DEFAULTS
  }
  const settings: Record<string, unknown> = { ...DEFAULTS }
  for (const [key, value] of Object.entries(parsed)) {
    const problem = isSettingKey(key) ? settingProblem(key, value) : `it is none of ${Object.keys(DEFAULTS).join(', ')}`
    if (problem === undefined) settings[key] = value
    else reportSkipped($, `"${key}" in ${path}`, problem)
  }
  // Each value kept was checked against its key above.
  return settings as Settings
}

/**
 * The settings in force: `~/.claude/local/watcher/settings.json` over the defaults, read on each call so an edit
 * takes effect at the next judgment. A missing file gives the defaults. For example:
 *
 *   { "minConfidence": "medium", "nudgesPerHour": 6, "judgeHeadless": true }
 */
export async function readSettings($: EngineInterface): Promise<Settings> {
  const directory = await machineLocalDirectory($)
  if (directory === undefined) return DEFAULTS
  const path = `${directory}/${SETTINGS_FILE}`
  if (!(await $.fs.exists(path))) return DEFAULTS
  let parsed: unknown
  try {
    parsed = JSON.parse(await $.fs.read(path)) as unknown
  } catch (err) {
    reportSkipped($, path, err instanceof Error ? err.message : String(err))
    return DEFAULTS
  }
  return applied($, path, parsed)
}
