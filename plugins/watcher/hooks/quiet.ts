import { update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AgentQuiet, Audience, Confidence, RaisedSummary } from '../types'
import type { Verdict } from './judge'
import type { Settings } from './settings'

/** Least sure first, so a later entry meets the bar of an earlier one. */
export const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high']

/** How a finding reaches someone: a hidden message to an agent, or a board decision for the owner. */
export type Channel = 'nudge' | 'flag'

/** A finding cleared to go out, on the channels its check's audience names whose hourly cap is not spent. */
export type Finding = { verdict: Verdict; channels: readonly Channel[] }

/** What passed the quiet rules, and a line for the debug log on each raised verdict or channel they held back. */
export type Quieted = { findings: Finding[]; heldBack: string[] }

const HOUR_MS = 60 * 60_000

// Shown to the judge with each check, so a long session's prompt stays short.
const MAX_SUMMARIES_PER_CHECK = 10

// A check answered Noise this many times more than Useful is reported to the owner.
const NOISE_MARGIN = 3

const COUNTS_KEY = 'counts'

const EMPTY: AgentQuiet = { raised: [], nudgedAt: [], flaggedAt: [] }

const CHANNELS: Record<Audience, readonly Channel[]> = { nudge: ['nudge'], flag: ['flag'], both: ['nudge', 'flag'] }

/** The summaries each check raised for the agent and delivered, oldest first, for the judge to mark repeats against. */
export async function raisedSummaries($: EngineInterface, agentKey: string): Promise<ReadonlyMap<string, readonly string[]>> {
  const { value } = await $.state.get({ plugin: 'watcher', key: 'quiet', id: agentKey } as const)
  const byCheck = new Map<string, string[]>()
  for (const raised of value?.raised ?? []) byCheck.set(raised.check, [...(byCheck.get(raised.check) ?? []), raised.summary])
  return byCheck
}

/** A summary with case, punctuation and spacing taken out, so two wordings that differ only in those match. */
function normalised(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function isRaisedBefore(raised: readonly RaisedSummary[], verdict: Verdict): boolean {
  const summary = normalised(verdict.summary)
  return raised.some(earlier => earlier.check === verdict.check.name && normalised(earlier.summary) === summary)
}

/** `raised` with `added` at the end, dropping that check's oldest summary past the bound. */
function withRaised(raised: readonly RaisedSummary[], added: RaisedSummary): RaisedSummary[] {
  const all = [...raised, added]
  const ofCheck = all.filter(entry => entry.check === added.check)
  if (ofCheck.length <= MAX_SUMMARIES_PER_CHECK) return all
  const oldest = ofCheck[0]
  return all.filter(entry => entry !== oldest)
}

const meetsBar = (confidence: Confidence, bar: Confidence) => CONFIDENCES.indexOf(confidence) >= CONFIDENCES.indexOf(bar)

/** Why a raised verdict is not a finding at all, or undefined when it is one. */
function dropReason(verdict: Verdict, raised: readonly RaisedSummary[], settings: Settings): string | undefined {
  if (!meetsBar(verdict.confidence, settings.minConfidence)) return `its confidence, ${verdict.confidence}, is below ${settings.minConfidence}`
  if (verdict.repeats) return 'the judge marks it a repeat of a summary raised before'
  if (isRaisedBefore(raised, verdict)) return 'its summary matches one raised before'
  return undefined
}

/**
 * Applies the bar, the repeat rules and the hourly caps to one judgment's verdicts of an agent, and records what goes
 * out, in one write so that judgments of the same agent finishing together cannot both spend the last of a cap.
 */
export async function quieten($: EngineInterface, agentKey: string, verdicts: readonly Verdict[], settings: Settings): Promise<Quieted> {
  const now = await $.clock.now()
  let quieted: Quieted = { findings: [], heldBack: [] }
  await update($, { plugin: 'watcher', key: 'quiet', id: agentKey } as const, current => {
    const quiet = current ?? EMPTY
    const sent: Record<Channel, number[]> = {
      nudge: quiet.nudgedAt.filter(at => at > now - HOUR_MS),
      flag: quiet.flaggedAt.filter(at => at > now - HOUR_MS),
    }
    const caps: Record<Channel, number> = { nudge: settings.nudgesPerHour, flag: settings.flagsPerHour }
    let raised = [...quiet.raised]
    // Rebuilt on each try: update runs this again when another write got in first.
    quieted = { findings: [], heldBack: [] }
    for (const verdict of verdicts.filter(found => found.raised)) {
      const name = verdict.check.name
      const reason = dropReason(verdict, raised, settings)
      if (reason !== undefined) {
        quieted.heldBack.push(`dropped ${name}, since ${reason}: ${verdict.summary}`)
        continue
      }
      const wanted = CHANNELS[verdict.check.audience]
      const channels = wanted.filter(channel => sent[channel].length < caps[channel])
      for (const channel of wanted.filter(channel => !channels.includes(channel))) {
        quieted.heldBack.push(`held back the ${channel} of ${name}, since this agent's ${caps[channel]} an hour are spent: ${verdict.summary}`)
      }
      if (channels.length === 0) continue
      for (const channel of channels) sent[channel].push(now)
      raised = withRaised(raised, { check: name, summary: verdict.summary })
      quieted.findings.push({ verdict, channels })
    }
    return { raised, nudgedAt: sent.nudge, flaggedAt: sent.flag }
  })
  return quieted
}

/** The owner's useful and noise answers to one check's flags, and whether its noise was reported. */
type CheckCounts = { useful: number; noise: number; isReported: boolean }

type Counts = Record<string, CheckCounts>

// The store holds only what countAnswer wrote.
function countsOf(stored: unknown): Counts {
  if (typeof stored !== 'object' || stored === null) return {}
  return stored as Counts
}

/**
 * watcher: you answered the "drift" check's flags Noise 4 times and Useful 1. An empty drift.md in
 * ~/.claude/local/watcher/checks/ turns it off, and one with your own criteria replaces it.
 */
function noisyText(check: string, counts: CheckCounts): string {
  const tally = `Noise ${counts.noise} times and Useful ${counts.useful}`
  const remedy = `An empty ${check}.md in ~/.claude/local/watcher/checks/ turns it off, and one with your own criteria replaces it.`
  return `watcher: you answered the "${check}" check's flags ${tally}. ${remedy}`
}

/**
 * Adds an owner's "Useful" or "Noise" to a check's counts, kept across sessions, and tells the owner once when its
 * noise passes its useful answers by NOISE_MARGIN. Two sessions counting the same check at the same moment can lose
 * one of the two counts, since the store has no compare-and-set.
 */
export async function countAnswer($: EngineInterface, check: string, kind: 'useful' | 'noise') {
  const counts = countsOf(await $.store.get(COUNTS_KEY))
  const before = counts[check] ?? { useful: 0, noise: 0, isReported: false }
  const after = { ...before, [kind]: before[kind] + 1 }
  const isNewlyNoisy = !before.isReported && after.noise >= after.useful + NOISE_MARGIN
  await $.store.set(COUNTS_KEY, { ...counts, [check]: { ...after, isReported: before.isReported || isNewlyNoisy } })
  if (isNewlyNoisy) $.ui.toast(noisyText(check, after))
}
