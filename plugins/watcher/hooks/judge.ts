import type { AgentInfo, EngineInterface, ModelCompleteResult } from 'claude-code'

import type { ActivityItem, Check, Confidence, DigestPart, Trigger } from '../types'
import { activityId, dropActivity, planFilesRead, takeWindow } from './capture'
import { isOneOf, loadChecks } from './checks'
import { deliver } from './deliver'
import type { Addressees } from './deliver'
import { renderRecord } from './digest'
import type { RecordSection } from './digest'
import { notesText, planText } from './inputs'
import { CONFIDENCES, quieten, raisedSummaries } from './quiet'
import { readSettings } from './settings'
import type { Settings } from './settings'
import { isGoalUnknown, noteFindings, noteGoal, sharedText } from './shared'

const JUDGE_FILE = 'judge.md'

/** One check's answer for one agent, as the judge gave it. */
export type Verdict = {
  check: Check
  raised: boolean
  confidence: Confidence
  summary: string
  evidence: string
  /** Whether the judge says it repeats a summary already raised for this check and agent. */
  repeats: boolean
}

// Room for an entry per check, each a line of summary and a short quote.
const MAX_ANSWER_TOKENS = 4096

const JUDGE_TIMEOUT_MS = 60_000

// A session that draws somewhere judges once the hook has returned, so the model call never holds the agent's turn
// or tool call.
const AFTER_HOOK_RETURNS_MS = 1

// How much of an answer that could not be read the debug log shows.
const ANSWER_EXCERPT_CHARS = 500

/** One model call: the checks it carries, its whole prompt, and whether it asks the session's goal. */
type Batch = { model: string; checks: readonly Check[]; prompt: string; asksGoal: boolean }

/** What a judgment shows from outside the agent's items, by the `reads` part that shows it; absent when empty. */
type Inputs = Partial<Record<'status' | 'shared' | 'notes' | 'plan', string>>

// The record's sections from outside the agent's items, in the order they follow the items.
const SECTION_TITLES: Readonly<Record<keyof Inputs, string>> = {
  status: 'Agents',
  shared: 'Sessions on this machine',
  notes: 'Knowledge base notes listing a file this work edited',
  plan: 'Plan files the agent read',
}

const SECTION_PARTS = Object.keys(SECTION_TITLES) as (keyof Inputs)[]

// Shown after the checks while the session's goal is still to be read; judge.md says how to answer it.
const GOAL_SECTION = '## Goal\n\nNot known yet.'

/** Who a judgment is of, as the debug log names them. */
type Judged = { agentId: string | undefined; trigger: Trigger }

/** What a judgment's findings need once the model has answered. */
type Outlet = { settings: Settings; to: Addressees }

const judgedText = (judged: Judged) => `${judged.agentId ?? 'the main session'} at ${judged.trigger}`

function log($: EngineInterface, text: string) {
  $.ui.log(`watcher ${text}`, { to: 'debug' })
}

function fitsAgent(check: Check, isTeammate: boolean): boolean {
  if (check.agents === 'all') return true
  return check.agents === (isTeammate ? 'teammates' : 'main')
}

function byModel(checks: readonly Check[]): Map<string, Check[]> {
  const groups = new Map<string, Check[]>()
  for (const check of checks) groups.set(check.model, [...(groups.get(check.model) ?? []), check])
  return groups
}

const agentName = (agent: AgentInfo) => agent.name ?? agent.teammateId ?? agent.id

function subjectLine(teammate: AgentInfo | undefined): string {
  if (teammate === undefined) return 'Agent: the main session.'
  return `Agent: the teammate "${agentName(teammate)}". Its prompts come from its lead, who stands in for the person.`
}

const MAIN_SESSION = 'the main session'

/**
 * Who the findings of a judgment are about and who is told them: the agent judged, except that a teammate gone idle
 * is reported to its lead, which can re-brief or stop it, since an idle teammate reads nothing until it is woken.
 */
function addresseesFor(roster: readonly AgentInfo[], teammate: AgentInfo | undefined, trigger: Trigger): Addressees {
  if (teammate === undefined) return { subject: MAIN_SESSION, recipient: MAIN_SESSION, agentId: undefined }
  const subject = `the teammate "${agentName(teammate)}"`
  if (trigger !== 'teammate-idle') return { subject, recipient: subject, agentId: teammate.id }
  const lead = teammate.parentId === undefined ? undefined : roster.find(agent => agent.id === teammate.parentId)
  const recipient = lead === undefined ? MAIN_SESSION : `the teammate "${agentName(lead)}"`
  return { subject, recipient, agentId: lead?.id, teammate: agentName(teammate) }
}

function rosterText(roster: readonly AgentInfo[], agentId: string | undefined): string {
  if (roster.length === 0) return 'none besides the main session'
  return roster
    .map(agent => {
      const kind = agent.teammateId === undefined ? agent.type : 'teammate'
      const mark = agent.id === agentId ? ', the agent judged' : ''
      return `- ${agent.name ?? agent.type} (${kind}${mark}): ${agent.status}`
    })
    .join('\n')
}

/**
 * What the judge is told of one check, with the summaries it already raised for this agent:
 *
 *   ### drift
 *
 *   The agent's recent calls and replies serve a goal other than ...
 *
 *   Already raised for this agent:
 *   - The work moved to the docs site while the request was the parser.
 */
function checkSection(check: Check, raised: readonly string[]): string {
  const section = `### ${check.name}\n\n${check.criteria}`
  if (raised.length === 0) return section
  const listed = raised.map(summary => `- ${summary}`).join('\n')
  return `${section}\n\nAlready raised for this agent:\n${listed}`
}

/**
 * The judge's prompt: its instructions, the checks, then the record. For one check:
 *
 *   <judge.md>
 *
 *   ## Checks
 *
 *   ### drift
 *
 *   The agent's recent calls and replies serve a goal other than ...
 *
 *   ## Record
 *
 *   Agent: the main session.
 *   ...
 */
function promptFor(frame: Frame, checks: readonly Check[], record: string, asksGoal: boolean): string {
  const sections = checks.map(check => checkSection(check, frame.raised.get(check.name) ?? []))
  const goal = asksGoal ? [GOAL_SECTION] : []
  return [frame.instructions.trim(), '## Checks', ...sections, ...goal, '## Record', record].join('\n\n')
}

/**
 * What every batch of one judgment shares: the judge's instructions, the agent, its window, what comes from outside
 * it, the summaries each check already raised for the agent, and the record's cap.
 */
type Frame = {
  instructions: string
  subject: string
  window: readonly ActivityItem[]
  inputs: Inputs
  raised: ReadonlyMap<string, readonly string[]>
  maxRecordChars: number
}

const readsOf = (checks: readonly Check[]) => new Set<DigestPart>(checks.flatMap(check => check.reads))

function sectionsFor(reads: ReadonlySet<DigestPart>, inputs: Inputs): RecordSection[] {
  const sections: RecordSection[] = []
  for (const part of SECTION_PARTS) {
    const text = inputs[part]
    if (reads.has(part) && text !== undefined) sections.push({ title: SECTION_TITLES[part], text })
  }
  return sections
}

/** The call for one model's checks, or undefined when the window holds nothing they read. */
function batchFor(model: string, checks: readonly Check[], frame: Frame, asksGoal: boolean): Batch | undefined {
  const reads = readsOf(checks)
  const record = renderRecord(frame.subject, frame.window, reads, sectionsFor(reads, frame.inputs), frame.maxRecordChars)
  if (record === undefined) return undefined
  return { model, checks, prompt: promptFor(frame, checks, record, asksGoal), asksGoal }
}

function editedIn(window: readonly ActivityItem[]): string[] {
  return window.flatMap(item => (item.kind === 'call' && item.edited !== undefined ? [item.edited] : []))
}

/** What the checks read from outside the agent's window, each part only when some check reads it. */
async function gatherInputs($: EngineInterface, reads: ReadonlySet<DigestPart>, window: readonly ActivityItem[], roster: string, agentKey: string): Promise<Inputs> {
  const inputs: Inputs = {}
  if (reads.has('status')) inputs.status = roster
  if (reads.has('shared')) inputs.shared = await sharedText($)
  if (reads.has('notes')) inputs.notes = await notesText($, editedIn(window))
  if (reads.has('plan')) inputs.plan = await planText($, await planFilesRead($, agentKey))
  return inputs
}

/** A check reading the notes or the plan has nothing to judge without them, so it is left out then. */
function hasItsInputs(check: Check, inputs: Inputs): boolean {
  if (check.reads.includes('notes') && inputs.notes === undefined) return false
  return !(check.reads.includes('plan') && inputs.plan === undefined)
}

const hasPersonPrompt = (window: readonly ActivityItem[]) => window.some(item => item.kind === 'prompt' && item.from === 'person')

function answerObject(text: string): unknown {
  // Read from the first brace to the last, so a code fence or a line of prose around the object does not lose it.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('it holds no JSON object')
  return JSON.parse(text.slice(start, end + 1)) as unknown
}

function verdictOf(entry: unknown, byName: ReadonlyMap<string, Check>): Verdict {
  if (typeof entry !== 'object' || entry === null) throw new Error(`the entry ${JSON.stringify(entry)} is not an object`)
  const { name, raised, confidence, summary, evidence, repeats } = entry as Record<string, unknown>
  const check = typeof name === 'string' ? byName.get(name) : undefined
  if (check === undefined) throw new Error(`an entry names ${JSON.stringify(name)}, which this call did not carry`)
  if (typeof raised !== 'boolean') throw new Error(`"${check.name}" has "raised" ${JSON.stringify(raised)}, not true or false`)
  if (typeof confidence !== 'string' || !isOneOf(CONFIDENCES, confidence)) {
    throw new Error(`"${check.name}" has "confidence" ${JSON.stringify(confidence)}, none of ${CONFIDENCES.join(', ')}`)
  }
  if (typeof summary !== 'string') throw new Error(`"${check.name}" has "summary" ${JSON.stringify(summary)}, not text`)
  if (typeof evidence !== 'string') throw new Error(`"${check.name}" has "evidence" ${JSON.stringify(evidence)}, not text`)
  if (typeof repeats !== 'boolean') throw new Error(`"${check.name}" has "repeats" ${JSON.stringify(repeats)}, not true or false`)
  if (raised && summary.trim() === '') throw new Error(`"${check.name}" is raised with an empty summary`)
  return { check, raised, confidence, summary, evidence, repeats }
}

/** What one batch's answer gives: a verdict per check at most, the session's goal when asked, and what was left out. */
type Answer = { verdicts: Verdict[]; goal?: string; problems: string[] }

/** The goal an answer gives when its batch asked for one, else undefined, noting a problem when it is missing. */
function goalOf(answer: { goal?: unknown }, asksGoal: boolean, problems: string[]): string | undefined {
  if (!asksGoal) return undefined
  if (typeof answer.goal === 'string' && answer.goal.trim() !== '') return answer.goal
  problems.push(`"goal" is ${JSON.stringify(answer.goal)}, not a line of text`)
  return undefined
}

/**
 * The verdicts an answer gives, one per check at most, its goal, and what was wrong with each entry left out. Throws
 * when the answer is not the object `judge.md` asks for.
 */
function parseAnswer(text: string, batch: Batch): Answer {
  const { checks } = batch
  const parsed = answerObject(text)
  const answer = typeof parsed === 'object' && parsed !== null ? (parsed as { checks?: unknown; goal?: unknown }) : {}
  const entries = answer.checks
  if (!Array.isArray(entries)) throw new Error('its object has no "checks" list')
  const byName = new Map(checks.map(check => [check.name, check]))
  const verdicts: Verdict[] = []
  const problems: string[] = []
  for (const entry of entries) {
    try {
      const verdict = verdictOf(entry, byName)
      if (verdicts.some(kept => kept.check === verdict.check)) throw new Error(`"${verdict.check.name}" is answered twice`)
      verdicts.push(verdict)
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err))
    }
  }
  const unanswered = checks.filter(check => !verdicts.some(verdict => verdict.check === check))
  if (unanswered.length > 0) problems.push(`no answer for ${unanswered.map(check => check.name).join(', ')}`)
  const goal = goalOf(answer, batch.asksGoal, problems)
  return { verdicts, problems, ...(goal === undefined ? {} : { goal }) }
}

/** Sends one batch and reads its answer. An answer that cannot be read is logged and dropped, never asked again. */
async function judgeBatch($: EngineInterface, batch: Batch, judged: Judged): Promise<Answer> {
  const where = `${judgedText(judged)} with ${batch.model}`
  const none: Answer = { verdicts: [], problems: [] }
  let reply: ModelCompleteResult
  try {
    reply = await $.model.complete({ model: batch.model, prompt: batch.prompt, maxTokens: MAX_ANSWER_TOKENS, timeoutMs: JUDGE_TIMEOUT_MS })
  } catch (err) {
    // The engine refuses a request it will not send, such as one naming a model it does not know.
    log($, `could not judge ${where}: ${String(err)}`)
    return none
  }
  if (!reply.isAnswered) {
    log($, `got no answer judging ${where}: ${reply.reason}`)
    return none
  }
  try {
    const answer = parseAnswer(reply.text, batch)
    for (const problem of answer.problems) log($, `left out part of the answer judging ${where}: ${problem}`)
    return answer
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log($, `dropped the answer judging ${where}, since ${reason}: ${reply.text.slice(0, ANSWER_EXCERPT_CHARS)}`)
    return none
  }
}

/** Judges each batch, then sends out what the quiet rules let through and records it for other sessions. */
async function judgeBatches($: EngineInterface, batches: readonly Batch[], judged: Judged, outlet: Outlet) {
  for (const batch of batches) {
    const { verdicts, goal } = await judgeBatch($, batch, judged)
    if (goal !== undefined) await noteGoal($, goal)
    for (const verdict of verdicts.filter(found => found.raised)) {
      log($, `judged ${verdict.check.name} raised for ${judgedText(judged)} (${verdict.confidence}): ${verdict.summary}`)
    }
    const { findings, heldBack } = await quieten($, activityId(judged.agentId), verdicts, outlet.settings)
    for (const line of heldBack) log($, `${line} (${judgedText(judged)})`)
    for (const finding of findings) await deliver($, finding, outlet.to)
    const shared = findings.map(({ verdict }) => ({ check: verdict.check.name, summary: verdict.summary, subject: outlet.to.subject }))
    await noteFindings($, shared)
  }
}

async function prepare($: EngineInterface, judged: Judged, given: readonly ActivityItem[] | undefined) {
  const { agentId, trigger } = judged
  const roster = await $.agent.list()
  const teammate = agentId === undefined ? undefined : roster.find(agent => agent.id === agentId)
  if (agentId !== undefined && teammate?.teammateId === undefined) {
    // Only the main session and teammates are judged. A subagent's run is one turn, so its end frees its capture.
    if (trigger === 'turn-end') await dropActivity($, agentId)
    return
  }
  const settings = await readSettings($)
  // A session with no surface is a -p or SDK run, whose flags nobody reads.
  const isHeadless = (await $.session.surfaces()).length === 0
  if (isHeadless && !settings.judgeHeadless) return
  const checks = await loadChecks($)
  const subscribed = checks.filter(check => check.triggers.includes(trigger)).filter(check => fitsAgent(check, teammate !== undefined))
  if (subscribed.length === 0) return
  const agentKey = activityId(agentId)
  const window = given ?? (await takeWindow($, agentKey, trigger))
  const inputs = await gatherInputs($, readsOf(subscribed), window, rosterText(roster, agentId), agentKey)
  const answerable = subscribed.filter(check => hasItsInputs(check, inputs))
  const frame: Frame = {
    instructions: await $.fs.read(`${$.plugin.root}/${JUDGE_FILE}`),
    subject: subjectLine(teammate),
    window,
    inputs,
    raised: await raisedSummaries($, agentKey),
    maxRecordChars: settings.maxRecordChars,
  }
  // The goal is the person's request, so only a judgment of the main session that reads one of their prompts asks it.
  const isGoalWanted = teammate === undefined && hasPersonPrompt(window) && (await isGoalUnknown($))
  const groups = [...byModel(answerable)]
  const goalGroup = isGoalWanted ? groups.findIndex(([, group]) => readsOf(group).has('prompts')) : -1
  const batches = groups
    .map(([model, group], index) => batchFor(model, group, frame, index === goalGroup))
    .filter(batch => batch !== undefined)
  if (batches.length === 0) return
  const outlet: Outlet = { settings, to: addresseesFor(roster, teammate, trigger) }
  // A headless run ends as soon as its last turn does and would cut a judgment left for later, so where the setting
  // has it judged, it judges before the hook returns.
  if (isHeadless) await judgeBatches($, batches, judged, outlet)
  else $.clock.after(AFTER_HOOK_RETURNS_MS, () => void judgeBatches($, batches, judged, outlet))
}

/**
 * Judges what an agent did since `trigger` last judged it, or `window` when given, against every check subscribed to
 * that trigger and that kind of agent: one model call per model the checks name.
 */
export async function judgeAt($: EngineInterface, agentId: string | undefined, trigger: Trigger, window?: readonly ActivityItem[]) {
  try {
    await prepare($, { agentId, trigger }, window)
  } catch (err) {
    // The session's own event runs through the hook that called this, and a watcher failure must not fail it.
    log($, `could not judge ${judgedText({ agentId, trigger })}: ${String(err)}`)
  }
}

/** Judges a teammate that went idle, found by its name when the event carries no id. */
export async function judgeIdleTeammate($: EngineInterface, agentId: string | undefined, name: string) {
  const roster = agentId === undefined ? await $.agent.list() : []
  const id = agentId ?? roster.find(agent => agent.name === name)?.id
  if (id !== undefined) await judgeAt($, id, 'teammate-idle')
}
