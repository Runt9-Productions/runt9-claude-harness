/** A settings file's top level, with `sandbox` known to be an object where present. */
export type LocalSettings = { sandbox?: Record<string, unknown>; [key: string]: unknown }

/** The two `sandbox` keys away sets, each absent where the settings hold no such key. */
export type SandboxValues = { enabled?: unknown; autoAllowBashIfSandboxed?: unknown }

const SANDBOX_KEYS = ['enabled', 'autoAllowBashIfSandboxed'] as const

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The settings `text` holds, or undefined when it is not a JSON object whose `sandbox`, where present, is one too. */
export function parseLocalSettings(text: string): LocalSettings | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(parsed)) return undefined
  if (parsed.sandbox !== undefined && !isObject(parsed.sandbox)) return undefined
  return parsed
}

export const renderLocalSettings = (settings: LocalSettings) => `${JSON.stringify(settings, null, 2)}\n`

/** What `settings` hold for the two keys, from any settings source; none where `sandbox` is not an object. */
export function sandboxValues(settings: Readonly<Record<string, unknown>>): SandboxValues {
  const { sandbox } = settings
  if (!isObject(sandbox)) return {}
  return { enabled: sandbox.enabled, autoAllowBashIfSandboxed: sandbox.autoAllowBashIfSandboxed }
}

/**
 * A copy of `settings` with both `sandbox` keys set as `values` has them, every other key kept where it stood. A key
 * `values` lacks is removed, and the `sandbox` object with it when nothing else is left in it.
 */
export function withSandboxValues(settings: LocalSettings, values: SandboxValues): LocalSettings {
  const sandbox = { ...settings.sandbox }
  for (const key of SANDBOX_KEYS) {
    if (values[key] === undefined) delete sandbox[key]
    else sandbox[key] = values[key]
  }
  if (Object.keys(sandbox).length > 0) return { ...settings, sandbox }
  const rest = { ...settings }
  delete rest.sandbox
  return rest
}
