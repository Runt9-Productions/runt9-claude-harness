/** A settings file's top level, with `sandbox` known to be an object where present. */
export type LocalSettings = { sandbox?: Record<string, unknown>; [key: string]: unknown }

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

/**
 * A copy of `settings` with `sandbox.enabled` set to `enabled`, every other key kept where it stood. Undefined removes
 * the key, and the `sandbox` object with it when nothing else is left in it.
 */
export function withSandboxEnabled(settings: LocalSettings, enabled: unknown): LocalSettings {
  const sandbox = { ...settings.sandbox, enabled }
  if (enabled === undefined) delete sandbox.enabled
  if (Object.keys(sandbox).length > 0) return { ...settings, sandbox }
  const rest = { ...settings }
  delete rest.sandbox
  return rest
}
