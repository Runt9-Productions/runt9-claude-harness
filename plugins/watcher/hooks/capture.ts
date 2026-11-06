import { update } from 'claude-code'
import type { EngineInterface, SessionAppendInput, ToolCallInput, ToolCallResult } from 'claude-code'

import type { ActivityItem, AgentActivity, RefusalKind, Trigger } from '../types'
import { cut } from './digest'
import { aroundSecrets, editedFile, planFileRead, redacted } from './inputs'
import { noteFileChanged } from './shared'

// The activity id of the main session. Agent ids start with `a`, so none is the same.
const MAIN = 'main'

// What one agent keeps between judgments, so the state stays bounded however long a turn runs.
const MAX_ITEMS = 150

const TEXT_CHARS = 2000

const CALL_CHARS = 600

// What the secret check is shown of the result around its matches.
const SECRET_CONTEXT_CHARS = 1200

const MAX_PLAN_FILES = 10

const EMPTY: AgentActivity = { items: [], nextSeq: 0, judgedUpTo: {}, planFiles: [] }

const PERSON = 'person'

const LEAD = 'lead'

const OTHER_AGENT = 'another agent'

type OriginKind = SessionAppendInput['origin']['kind']

// Who a prompt row is from, by its origin. Rows a plugin, an observer, a hook or the engine wrote are not the
// agent being asked anything, so they are left out (undefined).
const SENDERS: Record<OriginKind, string | undefined> = {
  composer: PERSON,
  bridge: PERSON,
  sdk: PERSON,
  'slack-ping': PERSON,
  'scheduled-trigger': PERSON,
  'auto-continuation': PERSON,
  coordinator: LEAD,
  peer: OTHER_AGENT,
  'peer-send-message': OTHER_AGENT,
  'projects-relay': OTHER_AGENT,
  channel: OTHER_AGENT,
  unclassified: OTHER_AGENT,
  'task-notification': undefined,
  observer: undefined,
  'observer-activity': undefined,
  plugin: undefined,
  engine: undefined,
  hook: undefined,
  model: undefined,
  tool: undefined,
}

// The keys a tool.call input carries beside the tool's own arguments.
const RESERVED_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])

const EXIT_CODE = /^Exit code (\d+)/

type PermissionVerdict = { decision: string; rule?: string; hook?: string }

// The tool.check verdict of each call still running, by tool_use_id. tool.check runs inside tool.call, so the
// call's own hook reads its verdict once next resolves.
const verdicts = new Map<string, PermissionVerdict>()

// Calls auto mode denied, by tool_use_id. The denial is raised inside the call, before the call's own hook can
// capture it, so the refusal is judged once the call returns.
const denials = new Set<string>()

/** The activity id of an event's loop. */
export function activityId(agentId: string | undefined): string {
  return agentId ?? MAIN
}

type TextBlock = { type: 'text'; text: string }

const isTextBlock = (block: { type: string; [field: string]: unknown }): block is TextBlock => block.type === 'text' && typeof block.text === 'string'

function textOf(message: SessionAppendInput['message']): string {
  return message.content
    .filter(isTextBlock)
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** Drops the oldest item past the bound, other than a prompt while any other kind is left: the request anchors most checks. */
function bounded(items: readonly ActivityItem[]): readonly ActivityItem[] {
  if (items.length <= MAX_ITEMS) return items
  const oldestOther = items.findIndex(item => item.kind !== 'prompt')
  const dropped = oldestOther < 0 ? 0 : oldestOther
  return [...items.slice(0, dropped), ...items.slice(dropped + 1)]
}

/** Adds the item `makeItem` builds for the agent's next `seq`, and returns it. */
async function addItem<T extends ActivityItem>($: EngineInterface, id: string, makeItem: (seq: number) => T): Promise<T> {
  let added: T | undefined
  await update($, { plugin: 'watcher', key: 'activity', id } as const, current => {
    const activity = current ?? EMPTY
    // Built again on each try: update runs this again when another write got in first.
    added = makeItem(activity.nextSeq)
    const items = bounded([...activity.items, added])
    return { ...activity, items, nextSeq: activity.nextSeq + 1 }
  })
  if (added === undefined) throw new Error(`the activity of ${id} was not updated`)
  return added
}

/** Text as the judge may read it: secrets redacted, then cut to `limit`. */
const shown = (text: string, limit: number) => cut(redacted(text).text, limit)

/** Keeps a row as a prompt or a reply when it is one: a prompt someone sent the agent, or the agent's own text. */
export async function captureRow($: EngineInterface, row: SessionAppendInput) {
  const id = activityId(row.agentId)
  if (row.door === 'response') {
    const text = textOf(row.message)
    if (text !== '') await addItem($, id, seq => ({ kind: 'reply', seq, text: shown(text, TEXT_CHARS) }))
    return
  }
  if (row.door !== 'prompt' && row.door !== 'delivery') return
  const sender = SENDERS[row.origin.kind]
  if (sender === undefined) return
  const text = textOf(row.message)
  if (text === '') return
  // A teammate's prompts come from its lead, whatever the row's origin says.
  const from = row.agentId !== undefined && sender !== PERSON ? LEAD : sender
  await addItem($, id, seq => ({ kind: 'prompt', seq, from, text: shown(text, TEXT_CHARS) }))
}

/** Holds a call's permission verdict until the call returns. */
export function noteVerdict(toolUseId: string | undefined, verdict: PermissionVerdict) {
  if (toolUseId !== undefined) verdicts.set(toolUseId, verdict)
}

export function noteDenial(toolUseId: string) {
  denials.add(toolUseId)
}

/** Whether auto mode denied the call, forgetting it. */
export function takeDenial(toolUseId: string | undefined): boolean {
  if (toolUseId === undefined) return false
  return denials.delete(toolUseId)
}

function refusalKind(verdict: PermissionVerdict | undefined, result: ToolCallResult): RefusalKind | undefined {
  if (result.deny !== undefined) return 'plugin'
  if (result.isError === undefined) return undefined
  if (verdict === undefined) return undefined
  if (verdict.decision === 'allow') return undefined
  if (verdict.rule !== undefined) return 'rule'
  if (verdict.hook !== undefined) return 'hook'
  if (verdict.decision === 'ask') return 'ask'
  return 'check'
}

function inputOf(call: ToolCallInput): string {
  const args = Object.entries(call).filter(([key]) => !RESERVED_KEYS.has(key))
  return JSON.stringify(Object.fromEntries(args))
}

function resultText(result: ToolCallResult): string {
  if (result.deny !== undefined) return result.deny
  if (result.text !== undefined) return result.text
  if (typeof result.result === 'string') return result.result
  return JSON.stringify(result.result) ?? ''
}

async function notePlanFile($: EngineInterface, id: string, path: string) {
  await update($, { plugin: 'watcher', key: 'activity', id } as const, current => {
    const activity = current ?? EMPTY
    const planFiles = [...activity.planFiles.filter(kept => kept !== path), path].slice(-MAX_PLAN_FILES)
    return { ...activity, planFiles }
  })
}

/** The plan files the agent has read, latest last. */
export async function planFilesRead($: EngineInterface, id: string): Promise<readonly string[]> {
  const { value } = await $.state.get({ plugin: 'watcher', key: 'activity', id } as const)
  return value?.planFiles ?? []
}

/**
 * Keeps a call the agent made, with what it got back and, when it was refused, how, any secret in either redacted.
 * Also notes a file it edited and a plan file it read. Returns the call as the secret check reads it, its result cut
 * around each match, when the result matched a secret pattern; else undefined.
 */
export async function captureCall($: EngineInterface, call: ToolCallInput, result: ToolCallResult): Promise<ActivityItem | undefined> {
  const verdict = call.tool_use_id === undefined ? undefined : verdicts.get(call.tool_use_id)
  if (call.tool_use_id !== undefined) verdicts.delete(call.tool_use_id)
  const id = activityId(call.agentId)
  const text = resultText(result)
  const exitCode = EXIT_CODE.exec(text)?.[1]
  const refusal = refusalKind(verdict, result)
  const isError = result.isError === true || result.deny !== undefined
  const edited = isError ? undefined : editedFile(call)
  const resultShown = redacted(text)
  const item = await addItem($, id, seq => ({
    kind: 'call' as const,
    seq,
    tool: call.tool,
    input: shown(inputOf(call), CALL_CHARS),
    result: cut(resultShown.text, CALL_CHARS),
    isError,
    ...(exitCode === undefined ? {} : { exitCode: Number(exitCode) }),
    ...(refusal === undefined ? {} : { refusal }),
    ...(edited === undefined ? {} : { edited }),
  }))
  if (edited !== undefined) await noteFileChanged($, edited)
  const planFile = isError ? undefined : planFileRead(call)
  if (planFile !== undefined) await notePlanFile($, id, planFile)
  if (!resultShown.hasSecret) return undefined
  return { ...item, result: cut(aroundSecrets(resultShown.text), SECRET_CONTEXT_CHARS) }
}

/**
 * The items an agent gained since `trigger` last judged it, oldest first. Each trigger keeps its own place, so a
 * judgment at a commit leaves the turn's end still seeing the whole turn.
 */
export async function takeWindow($: EngineInterface, id: string, trigger: Trigger): Promise<readonly ActivityItem[]> {
  let window: readonly ActivityItem[] = []
  await update($, { plugin: 'watcher', key: 'activity', id } as const, current => {
    const activity = current ?? EMPTY
    const from = activity.judgedUpTo[trigger] ?? 0
    window = activity.items.filter(item => item.seq >= from)
    return { ...activity, judgedUpTo: { ...activity.judgedUpTo, [trigger]: activity.nextSeq } }
  })
  return window
}

/** Forgets an agent nothing judges, such as a subagent whose run has ended. */
export async function dropActivity($: EngineInterface, id: string) {
  await update($, { plugin: 'watcher', key: 'activity', id } as const, () => EMPTY)
}

/** Whether a Bash call's result records a commit or a push. */
export function isCommitOrPush(call: ToolCallInput, result: ToolCallResult): boolean {
  if (call.tool !== 'Bash') return false
  if (result.isError !== undefined || result.deny !== undefined) return false
  const { gitOperation } = (result.result ?? {}) as { gitOperation?: { commit?: unknown; push?: unknown } }
  if (gitOperation === undefined) return false
  return gitOperation.commit !== undefined || gitOperation.push !== undefined
}
