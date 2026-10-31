import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { BoardActivity, BoardDecision, BoardDelivery, BoardOption } from '../types'
import { isPresent } from './activity'
import { bind, nextId, retireIds, save } from './persistence'
import type { AskDecisionInput } from './tools'

export const PANE = 'board'

const decisions = atom({ plugin: 'board', key: 'decisions' } as const, [])
const ownerTasks = atom({ plugin: 'board', key: 'ownerTasks' } as const, [])
const activity = atom({ plugin: 'board', key: 'activity' } as const, [])
const litIds = atom({ plugin: 'board', key: 'litIds' } as const, [])
const areHotkeysHeld = atom({ plugin: 'board', key: 'areHotkeysHeld' } as const, false)

export async function openBoard($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Board' })
}

/** The loop's name as the pane shows it; undefined for the main session. */
export function agentLabel(rows: readonly BoardActivity[], agentId: string | undefined): string | undefined {
  if (agentId === undefined) return undefined
  return rows.find(a => a.agentId === agentId)?.label ?? agentId
}

/**
 * The engine does not hold a call to the input schema, so a caller that skipped loading it passes bare strings.
 * A Button with no label throws and takes the whole pane down, so decisions already saved that way are read through this too.
 */
export function asOption(option: BoardOption | string): BoardOption {
  return typeof option === 'string' ? { label: option } : option
}

/**
 * What a decision's options lack, worded to follow "a decision", or undefined when they can be posted. Checked before
 * saving, since one option without a label is enough to take the pane down.
 *
 * needs a label on every option
 */
function optionsRefusal(options: readonly (BoardOption | string)[]): string | undefined {
  if (options.length < 2 || options.length > 4) return 'needs 2 to 4 options'
  const isEveryLabelled = options.map(asOption).every(o => typeof o.label === 'string' && o.label.trim() !== '')
  return isEveryLabelled ? undefined : 'needs a label on every option'
}

/** Posts, rewords or withdraws a decision for the calling loop; `agentId` is absent for the main session. */
export async function askDecision($: EngineInterface, agentId: string | undefined, input: AskDecisionInput): Promise<string> {
  await bind($)
  if (input.withdraw) return withdrawDecision($, agentId, input.id)
  if (input.id !== undefined) return rewordDecision($, agentId, input.id, input)
  if (!input.question) return 'Nothing posted: a new decision needs a question.'
  const refusal = optionsRefusal(input.options ?? [])
  if (refusal !== undefined) return `Nothing posted: a new decision ${refusal}.`
  const id = await nextId($, 'D')
  const rows: BoardActivity[] = await read($, activity)
  const decision: BoardDecision = {
    id,
    question: input.question,
    context: input.context,
    options: (input.options ?? []).map(asOption),
    recommended: input.recommended,
    agentId,
    askedBy: agentLabel(rows, agentId),
  }
  await update($, decisions, all => [...all, decision])
  await save($)
  void openBoard($)
  await flash($, id)
  // The away plugin reads the decision id from the start of this result.
  return `Posted ${id}. The answer will arrive as a message starting "[board]"; do not wait for it.`
}

/**
 * Why the calling loop may not change an item, or undefined when it may: only the loop that posted it and the main
 * session can. A change is relayed to the poster as a user-role row, so without this any teammate could put words in
 * another loop's mouth.
 *
 * D3 was posted by worker; only worker or the main session can change it.
 */
export function notPosterText(rows: readonly BoardActivity[], id: string, posterId: string | undefined, callerId: string | undefined): string | undefined {
  if (callerId === undefined || callerId === posterId) return undefined
  if (posterId === undefined) return `${id} was posted by the main session; only the main session can change it.`
  const poster = agentLabel(rows, posterId) ?? posterId
  return `${id} was posted by ${poster}; only ${poster} or the main session can change it.`
}

async function rewordDecision($: EngineInterface, agentId: string | undefined, id: string, input: AskDecisionInput): Promise<string> {
  const optionsProblem = input.options === undefined ? undefined : optionsRefusal(input.options)
  if (optionsProblem !== undefined) return `Nothing changed: a decision ${optionsProblem}.`
  const options = input.options?.map(asOption)
  const rows: BoardActivity[] = await read($, activity)
  // Decided inside the update, which retries on a conflicting write, so an answer pressed meanwhile is never reworded.
  let refusal: string | undefined
  let written: BoardDecision | undefined
  await update($, decisions, all => {
    refusal = undefined
    written = undefined
    const existing = all.find(d => d.id === id)
    if (existing === undefined) {
      refusal = `Nothing changed: there is no ${id}. Omit id to post a new decision.`
      return all
    }
    const notPoster = notPosterText(rows, id, existing.agentId, agentId)
    if (notPoster !== undefined) {
      refusal = `Nothing changed: ${notPoster}`
      return all
    }
    if (existing.answer !== undefined) {
      refusal = `Nothing changed: the owner already answered ${id}: ${existing.answer}`
      return all
    }
    const reworded: BoardDecision = {
      ...existing,
      question: input.question ?? existing.question,
      context: input.context === undefined ? existing.context : input.context || undefined,
      options: options ?? existing.options,
      // An index into the old options would point at whichever new option took its place.
      recommended: options === undefined ? (input.recommended ?? existing.recommended) : input.recommended,
    }
    written = reworded
    return all.map(d => (d.id === id ? reworded : d))
  })
  if (refusal !== undefined) return refusal
  await save($)
  void openBoard($)
  await flash($, id)
  const reworded = written
  if (reworded) {
    const labels = reworded.options.map(o => asOption(o).label).join(' / ')
    await tellPoster($, reworded.agentId, agentId, by => `[board] ${by} reworded ${id}, which you asked: "${reworded.question}" Options: ${labels}`)
  }
  return `Updated ${id}.`
}

/**
 * Tells the loop that posted an item that another loop withdrew or reworded it. Nothing retries a failure, so the
 * owner is told to relay it.
 *
 * [board] reviewer withdrew D3 ("Draft an issue?"), which you asked; no answer will come.
 */
export async function tellPoster($: EngineInterface, posterId: string | undefined, callerId: string | undefined, text: (by: string) => string) {
  if (posterId === callerId) return
  const rows: BoardActivity[] = await read($, activity)
  const row = text(agentLabel(rows, callerId) ?? 'the main session')
  const failure = await deliver($, posterId, row)
  if (failure !== undefined) $.ui.toast(`Not delivered to ${agentLabel(rows, posterId) ?? 'Claude'} (${failure}); tell it yourself: ${row}`)
}

async function withdrawDecision($: EngineInterface, agentId: string | undefined, id: string | undefined): Promise<string> {
  if (id === undefined) return 'Nothing withdrawn: withdraw needs the id of the decision.'
  const listed: BoardDecision[] = await read($, decisions)
  const decision = listed.find(d => d.id === id)
  if (decision === undefined) return `Nothing withdrawn: there is no ${id}.`
  const notPoster = notPosterText(await read($, activity), id, decision.agentId, agentId)
  if (notPoster !== undefined) return `Nothing withdrawn: ${notPoster}`
  if (decision.answer !== undefined) return `Nothing withdrawn: the owner already answered ${id}: ${decision.answer}`
  await retireIds($, 'D', [id])
  // Checked again inside the update, so an answer pressed since the read is delivered rather than lost.
  let withdrawn: BoardDecision | undefined
  await update($, decisions, all => {
    withdrawn = all.find(d => d.id === id && d.answer === undefined)
    return all.filter(d => d !== withdrawn)
  })
  if (withdrawn === undefined) return `Nothing withdrawn: the owner answered ${id} meanwhile.`
  await holdHotkeys($)
  await save($)
  const rows: BoardActivity[] = await read($, activity)
  $.ui.toast(`${id} withdrawn by ${agentLabel(rows, agentId) ?? 'Claude'}: "${withdrawn.question}"`)
  const question = withdrawn.question
  await tellPoster($, withdrawn.agentId, agentId, by => `[board] ${by} withdrew ${id} ("${question}"), which you asked; no answer will come.`)
  return `Withdrew ${id}.`
}

// A new decision's line blinks this long, so a glance at a side monitor catches it. The away plugin relies on it as
// its only alert in distracted mode, so it is not cosmetic.
const FLASH_MS = 4_000
const FLASH_PERIOD_MS = 500

// When each flashing decision stops. Module state, like the timer, so a hot reload ends both together.
const flashEnds = new Map<string, number>()
let flashTimer: Timer | undefined

export async function flash($: EngineInterface, id: string) {
  flashEnds.set(id, (await $.clock.now()) + FLASH_MS)
  await update($, litIds, ids => [...ids, id])
  flashTimer ??= $.clock.every(FLASH_PERIOD_MS, () => void blink($))
}

/** Lights every flashing decision's line, or puts all of them out, in turn; the last one out stops the timer. */
async function blink($: EngineInterface) {
  const at = await $.clock.now()
  for (const [id, end] of flashEnds) {
    if (at >= end) flashEnds.delete(id)
  }
  if (flashEnds.size === 0) {
    flashTimer?.cancel()
    flashTimer = undefined
  }
  await update($, litIds, ids => (ids.length > 0 ? [] : [...flashEnds.keys()]))
}

// Keys 1 to 4 answer whichever decision is first in the waiting list. When that one leaves, the next takes the keys
// only after this long, so a second press meant for the one answered cannot answer the next unread.
const HOTKEY_HOLD_MS = 1_500

let hotkeyTimer: Timer | undefined

async function holdHotkeys($: EngineInterface) {
  hotkeyTimer?.cancel()
  await update($, areHotkeysHeld, () => true)
  hotkeyTimer = $.clock.after(HOTKEY_HOLD_MS, () => void update($, areHotkeysHeld, () => false))
}

/** A reload stops the flash and hotkey timers, which would leave a lit line lit and the hotkeys held. */
export async function resetFlashAndHotkeys($: EngineInterface) {
  await update($, litIds, () => [])
  await update($, areHotkeysHeld, () => false)
}

async function answer($: EngineInterface, id: string, text: string) {
  await bind($)
  // Claimed inside the update, which retries on a conflicting write, so two quick presses answer once.
  let claimed: BoardDecision | undefined
  await update($, decisions, all => {
    claimed = all.find(d => d.id === id && d.answer === undefined)
    return all.map(d => (d === claimed ? { ...d, answer: text, delivery: 'sending' as const } : d))
  })
  if (!claimed) return
  await holdHotkeys($)
  await save($)
  await sendAnswer($, claimed, text)
}

export async function retry($: EngineInterface, id: string) {
  await bind($)
  // Claimed as in answer(), so two quick presses deliver once.
  let claimed: BoardDecision | undefined
  await update($, decisions, all => {
    claimed = all.find(d => d.id === id && d.delivery === 'failed')
    return all.map(d => (d === claimed ? { ...d, delivery: 'sending' as const } : d))
  })
  if (!claimed?.answer) return
  await save($)
  await sendAnswer($, claimed, claimed.answer)
}

/** The owner told the agent themselves: the decision leaves the board, and its id is never reissued. */
export async function dismiss($: EngineInterface, id: string) {
  await bind($)
  await retireIds($, 'D', [id])
  await update($, decisions, all => all.filter(d => d.id !== id))
  await save($)
}

/** Delivers an answer already recorded on the board, records whether it arrived, and tells the owner. */
async function sendAnswer($: EngineInterface, decision: BoardDecision, text: string) {
  const asker = decision.askedBy ?? 'Claude'
  const failure = await deliver($, decision.agentId, `[board] The owner answered ${decision.id} ("${decision.question}"): ${text}`)
  await setDelivery($, decision.id, failure === undefined ? 'sent' : 'failed')
  await save($)
  if (failure === undefined) {
    $.ui.toast(`${decision.id} answered; ${asker} reads it at its next step${decision.agentId ? '' : ' or with your next prompt'}`)
  } else {
    // The pane shows it answered either way, so say plainly that no agent has been told.
    $.ui.toast(`${decision.id}: answer saved on the board but NOT delivered to ${asker} (${failure}); tell it yourself`)
  }
}

/**
 * Appends the row to the loop that asked or posted (`agentId` absent for the main session), where a running loop reads
 * it at its next step; resolves undefined when delivered, else why not. The main session, when idle, reads it with the
 * owner's next prompt. An agent that has ended is not reached, and its item is cleared with "Dismiss (I told it)".
 */
export async function deliver($: EngineInterface, agentId: string | undefined, row: string): Promise<string | undefined> {
  let appendFailure: string | undefined
  try {
    const result = await $.session.append({
      agentId,
      message: { type: 'user', content: [{ type: 'text', text: row }] },
    })
    appendFailure = result.deny
  } catch (err) {
    appendFailure = String(err)
  }
  if (appendFailure === undefined || agentId === undefined) return appendFailure
  // A message would resume an agent that finished or was stopped, with its tools, so one is never sent there.
  if (!isPresent(await $.agent.list(), agentId)) return `${appendFailure}; it has ended`
  // A teammate idle between turns refuses the append, and only a message wakes it. Addressed to that loop
  // alone: the lead must not receive an answer it never asked for.
  try {
    const sent = await $.session.send({ to: { agentId }, text: row })
    return sent.isDelivered ? undefined : `${appendFailure}; message: ${sent.reason}`
  } catch (err) {
    return `${appendFailure}; message: ${String(err)}`
  }
}

async function setDelivery($: EngineInterface, id: string, delivery: BoardDelivery) {
  await update($, decisions, all => all.map(d => (d.id === id ? { ...d, delivery } : d)))
}

// The Input's text reaches only its own handlers, so the note is kept in state for the option buttons.
export async function setNote($: EngineInterface, id: string, note: string) {
  await bind($)
  await update($, decisions, all => all.map(d => (d.id === id ? { ...d, note } : d)))
}

// An answer rather than a removal, so the asker is told and Retry covers a failed delivery.
export const DISMISSED_ANSWER = 'Dismissed without choosing an option'

export async function answerWithNote($: EngineInterface, id: string, label: string) {
  await bind($)
  const all: BoardDecision[] = await read($, decisions)
  const decision = all.find(d => d.id === id)
  // A press on a frame drawn before a reword can name an option the decision no longer offers.
  const isOffered = label === DISMISSED_ANSWER || (decision?.options.map(asOption).some(o => o.label === label) ?? false)
  if (!isOffered) return
  const note = decision?.note?.trim()
  await answer($, id, note ? `${label}. Note: ${note}` : label)
}

export async function answerOther($: EngineInterface, id: string, text: string) {
  if (text.trim()) await answer($, id, `Other: ${text.trim()}`)
}

/** Marks every answer and owner's change sent to this loop as seen; called as one of its model requests goes out. */
export async function markSeen($: EngineInterface, agentId: string | undefined) {
  // Set again on a retried update, which costs at most one save that changes nothing.
  let isChanged = false
  await update($, decisions, all =>
    all.map(d => {
      if (d.delivery !== 'sent' || d.agentId !== agentId) return d
      isChanged = true
      return { ...d, delivery: 'seen' as const }
    }),
  )
  await update($, ownerTasks, all =>
    all.map(t => {
      if (t.lastChange?.delivery !== 'sent' || t.agentId !== agentId) return t
      isChanged = true
      return { ...t, lastChange: { ...t.lastChange, delivery: 'seen' as const } }
    }),
  )
  if (isChanged) await save($)
}

// The answers are already in the conversation as [board] rows, so the prompt only has to start the turn.
const SEND_NOW_PROMPT = '[board] The owner answered on the board. Act on the [board] answers above.'

// From the press until the main loop's next request, so a second press submits nothing more.
let isSendNowQueued = false

export function endSendNowQueue() {
  isSendNowQueued = false
}

/** Starts the idle main session's turn, so it reads the answers appended to it without the owner typing a prompt. */
export async function sendNow($: EngineInterface) {
  if (isSendNowQueued) {
    $.ui.toast('Already sent; Claude reads the answers when its turn starts')
    return
  }
  isSendNowQueued = true
  let refusal: string | undefined
  try {
    refusal = (await $.prompt.submit({ text: SEND_NOW_PROMPT })).drop
  } catch (err) {
    refusal = String(err)
  }
  if (refusal === undefined) return
  isSendNowQueued = false
  $.ui.toast(`Not sent: ${refusal}`)
}
