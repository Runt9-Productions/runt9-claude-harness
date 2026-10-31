import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, ToolSpec } from 'claude-code'

import type { HandoffPhase } from '../types'

// compact() rejects while a turn runs, and turn.complete fires before the turn has let go.
const COMPACT_RETRY_MS = 500
const COMPACT_ATTEMPTS = 10

// The away plugin reads phase and ceilingPercent and runs /handoff; the README's "The away plugin" has the contract.
const phase = atom({ plugin: 'handoff', key: 'phase' } as const, 'idle')
const message = atom({ plugin: 'handoff', key: 'message' } as const, '')
const handoffTurnId = atom({ plugin: 'handoff', key: 'turnId' } as const, '')
const handoffNonce = atom({ plugin: 'handoff', key: 'nonce' } as const, '')
const percent = atom({ plugin: 'handoff', key: 'percent' } as const, 0)
const isUnattended = atom({ plugin: 'handoff', key: 'isUnattended' } as const, false)
const ceilingPercent = atom({ plugin: 'handoff', key: 'ceilingPercent' } as const, 0)

/**
 * Where the band turns yellow and red, from the manifest's userConfig (defaults 30 and 60, the points the delegation
 * rules give for where rule-following degrades and its ceiling). The away plugin hands off at the ceiling, read
 * from state.
 */
type Thresholds = { warnPercent: number; ceilingPercent: number }

function thresholds(options: PluginOptions): Thresholds {
  return { warnPercent: Number(options.warn_percent), ceilingPercent: Number(options.ceiling_percent) }
}

/** owner: the button, or /handoff typed or run by any plugin but away. unattended: away ran it, and nobody is there. */
type Audience = 'owner' | 'unattended'

const HANDOFF_MARK = '[handoff]'
const OWNER_OPENING = `${HANDOFF_MARK} The owner asked to hand off and compact.`
const UNATTENDED_OPENING = `${HANDOFF_MARK} The context window is filling while the owner is away, so hand off and compact.`
const HANDOFF_STEPS =
  "Write this session's state to a handoff file on disk: " +
  'repo and branch state, decisions the owner settled, what is in flight, and the ordered next steps. Put it in ' +
  "the repo's .claude/output for work on that repo, otherwise ~/.claude/output. The file holds the current state " +
  'only: if a handoff file for this work exists, rewrite it rather than adding a section to it, drop whatever is ' +
  'done or superseded, and move decisions that outlast this work to memory, the knowledge base or the plan. Write ' +
  'it from the current state rather than from the previous handoff file, and point to the documents the repo ' +
  'keeps, such as its process, a plan or a spec, rather than restating them. Then ' +
  'load mcp__handoff__compact_with through ToolSearch and call it with your compaction message: what to keep, what ' +
  'to drop, and the handoff file to read first. Then end the turn without starting anything else; the session ' +
  'compacts when the turn ends.'

const RESUME_OPENING =
  '[resume] The session just compacted after a handoff. Read the handoff file your summary names, and any plan, ' +
  'spec or project file it points to.'
const RESUME_PROMPT =
  `${RESUME_OPENING} Then reply in a few lines with what you are about to do next, and end the turn: ` +
  'the owner confirms before you start.'
// A turn may have ended on a deliberate stop before the handoff, so this cannot order the work on regardless.
const UNATTENDED_RESUME_PROMPT =
  `${RESUME_OPENING} The owner is away, so carry on with the work from the next step without waiting for them; ` +
  'if the handoff says you had stopped on purpose, end here.'

/**
 * What Claude reads when an unattended handoff fails, since nobody reads the toast:
 *
 * [handoff] The handoff failed (Compaction skipped: vetoed). The owner is away: report the failure where they will
 * see it on return, then carry on with the work.
 */
const failurePrompt = (why: string) =>
  `${HANDOFF_MARK} The handoff failed (${why}). The owner is away: report the failure where they will see it on ` +
  'return, then carry on with the work.'

// The summary's instructions when an unattended handoff's turn ended without a compaction message.
const FALLBACK_INSTRUCTIONS =
  'Claude ended the handoff turn without a compaction message. Keep the work in flight, the decisions the owner ' +
  'settled and the ordered next steps. If this session wrote a handoff file, name its path as the file to read first.'

const COMPACT_WITH: ToolSpec = {
  name: 'compact_with',
  description:
    'Hand the session your compaction message after writing the handoff file. Only call this when a ' +
    '"[handoff]" prompt asked for it. The session compacts with this message once your turn ends.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'What the summary should keep and drop, and the handoff file to read first.',
      },
    },
    required: ['message'],
  },
}

// The main loop's turns that turn.start has announced and turn.complete has not yet ended. One running holds
// compact() off.
const runningTurnIds = new Set<string>()

// A compact() call in flight cannot be taken back, so Cancel refuses while one runs.
let isCompactCallRunning = false

async function setPhase($: EngineInterface, next: HandoffPhase) {
  await update($, phase, () => next)
}

async function refreshPercent($: EngineInterface) {
  const { context } = await $.session.usage()
  const fill = context.percent ?? (await estimatePercent($, context.window))
  await update($, percent, () => fill)
}

// The live figure is absent until the first response after a start, a resume or a compaction, so the band would
// read 0% until a turn ends. /context's local estimate covers the gap.
async function estimatePercent($: EngineInterface, window: number) {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const tokens = context.breakdown?.totalTokens
  return tokens === undefined ? 0 : Math.round((100 * tokens) / window)
}

async function start($: EngineInterface, stress: string, audience: Audience) {
  if ((await read($, phase)) !== 'idle') {
    $.ui.toast('A handoff is already under way')
    return
  }
  // Before the phase, so a turn that starts once the phase reads 'queued' is matched against this handoff's id.
  const id = crypto.randomUUID()
  await update($, handoffNonce, () => id)
  await setPhase($, 'queued')
  await update($, message, () => '')
  await update($, isUnattended, () => audience === 'unattended')
  const opening = audience === 'unattended' ? UNATTENDED_OPENING : OWNER_OPENING
  // [handoff] The owner asked to hand off and compact. Write this session's state to a handoff file on disk: ...
  // The owner asked the summary to stress: the open migration question
  // Handoff id: <a fresh random UUID>
  const lines = [`${opening} ${HANDOFF_STEPS}`]
  if (stress) lines.push(`The owner asked the summary to stress: ${stress}`)
  lines.push(`Handoff id: ${id}`)
  // Submitting from inside the command.run hook is refused: it would wait on the turn the hook holds.
  $.clock.after(1, () => void submitHandoff($, lines.join('\n')))
}

async function submitHandoff($: EngineInterface, text: string) {
  const refusal = await submit($, text)
  if (refusal !== undefined) await fail($, `Handoff not started: ${refusal}`)
}

/** Answers why the prompt did not enter, or undefined once it has. */
async function submit($: EngineInterface, text: string): Promise<string | undefined> {
  try {
    const result = await $.prompt.submit({ text })
    return result.drop
  } catch (err) {
    return String(err)
  }
}

/** `id` is the handoff's nonce: a retry left over from a cancelled handoff finds it gone and stops. */
async function compact($: EngineInterface, id: string, attempt: number) {
  if ((await read($, handoffNonce)) !== id) return
  // A running turn rejects every attempt for as long as it runs, so waiting on one uses up none of them.
  if (runningTurnIds.size > 0) {
    $.clock.after(COMPACT_RETRY_MS, () => void compact($, id, attempt))
    return
  }
  let result
  isCompactCallRunning = true
  try {
    result = await $.session.compact({ instructions: await read($, message) })
  } catch (err) {
    if (attempt < COMPACT_ATTEMPTS) {
      $.clock.after(COMPACT_RETRY_MS, () => void compact($, id, attempt + 1))
      return
    }
    await refreshPercent($)
    await fail($, `Compaction failed: ${String(err)}`, 'The message is in the transcript; run /compact by hand')
    return
  } finally {
    isCompactCallRunning = false
  }
  await refreshPercent($)
  if ('skip' in result && result.skip) {
    await fail($, `Compaction skipped: ${String(result.skip)}`)
    return
  }
  const isNobodyThere = await read($, isUnattended)
  // Back to idle first, so the resume prompt's turn is not taken for another handoff's.
  await reset($)
  const refusal = await submit($, isNobodyThere ? UNATTENDED_RESUME_PROMPT : RESUME_PROMPT)
  if (refusal === undefined) return
  $.ui.toast(`Resume not started: ${refusal}`)
  if (isNobodyThere) await tellClaudeItFailed($, `Resume not started: ${refusal}`)
}

// Runs once the turn the handoff prompt started has ended.
async function finish($: EngineInterface, isAborted: boolean) {
  await update($, handoffTurnId, () => '')
  // An interrupt is the owner at the keyboard, even in an unattended handoff.
  if (isAborted) {
    await stopWithout($, 'The handoff turn was interrupted; nothing was compacted')
    return
  }
  if (!(await read($, message))) {
    // With the owner there, a visible failure beats compacting blind; with nobody there, the window keeps filling.
    if (!(await read($, isUnattended))) {
      await stopWithout($, 'Claude ended the turn without a compaction message; nothing was compacted')
      return
    }
    await update($, message, () => FALLBACK_INSTRUCTIONS)
    $.ui.toast('Claude wrote no compaction message; compacting anyway')
  } else {
    $.ui.toast('Compacting with the message Claude wrote')
  }
  await setPhase($, 'compacting')
  const id = await read($, handoffNonce)
  $.clock.after(COMPACT_RETRY_MS, () => void compact($, id, 1))
}

// A prompt already queued cannot be taken back, so a handoff cancelled while 'queued' still gets its turn, and
// compact_with tells Claude there that nothing will compact.
async function cancel($: EngineInterface) {
  if (isCompactCallRunning) {
    $.ui.toast('The compaction has started and cannot be stopped')
    return
  }
  await update($, handoffTurnId, () => '')
  await stopWithout($, 'Handoff cancelled; nothing will compact')
}

async function reset($: EngineInterface) {
  await setPhase($, 'idle')
  await update($, handoffNonce, () => '')
  await update($, message, () => '')
  await update($, isUnattended, () => false)
}

async function stopWithout($: EngineInterface, why: string) {
  await reset($)
  $.ui.toast(why)
}

/** Ends a handoff that failed. `ownerStep` is what the owner can do about it, toasted only when they are there. */
async function fail($: EngineInterface, why: string, ownerStep?: string) {
  const isNobodyThere = await read($, isUnattended)
  await reset($)
  $.ui.toast(ownerStep && !isNobodyThere ? `${why}. ${ownerStep}` : why)
  if (isNobodyThere) await tellClaudeItFailed($, why)
}

async function tellClaudeItFailed($: EngineInterface, why: string) {
  const refusal = await submit($, failurePrompt(why))
  if (refusal !== undefined) $.ui.toast(`Could not tell Claude the handoff failed: ${refusal}`)
}

async function publishSharedState($: EngineInterface, limits: Thresholds) {
  await update($, ceilingPercent, () => limits.ceilingPercent)
  // Written back unchanged: a key never written reads undefined to another plugin, whatever the atom's initial.
  await update($, phase, current => current)
}

export const register: Register = (on, options) => {
  const limits = thresholds(options)

  on('session.start', async ($, e, next) => {
    await $.tool.register(COMPACT_WITH)
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff file and a compaction message, then compact. Optional: what to stress',
    })
    // A hot reload stops module timers, and compacting is driven by one, so it would never finish.
    if ((await read($, phase)) === 'compacting') await reset($)
    await publishSharedState($, limits)
    await refreshPercent($)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    // Checked by name: another plugin running /handoff is not evidence that nobody is there.
    const isAway = e.origin.kind === 'plugin' && e.origin.name === 'away'
    await start($, e.args.trim(), isAway ? 'unattended' : 'owner')
    return { text: 'Handoff requested: Claude writes it, then the session compacts.' }
  })

  on('tool.call', { tool: 'mcp__handoff__compact_with' }, async ($, e) => {
    // Only the handoff's own turn saves a message: while 'queued' that turn has not started, so a call is another's.
    const isHandoffTurn = e.agentId === undefined && (await read($, phase)) === 'writing'
    if (!isHandoffTurn) {
      return {
        result:
          'No handoff is waiting on this call (none was asked for, or the owner cancelled it), so nothing will compact. ' +
          'Do not call this again unless a new "[handoff]" prompt asks.',
      }
    }
    const text = e.message
    if (typeof text !== 'string' || !text.trim()) {
      return { result: 'Not saved: `message` must be non-empty text. Call compact_with again with the compaction message.' }
    }
    await update($, message, () => text)
    return { result: 'Saved. End your turn now; the session compacts when it ends.' }
  })

  // A press during a turn queues the prompt behind it, and a teammate's message can start a turn of its own first,
  // so the handoff's turn is the one its own prompt starts, found by the id that prompt alone carries. The engine
  // wraps a plugin's prompt ("The handoff plugin sent a message: [handoff] ..."), so the id is matched anywhere in
  // the text: a prefix match never finds the handoff's turn, which leaves the handoff stuck in 'queued'.
  on('turn.start', async ($, e, next) => {
    // Every turn, not once: $.state resets when the session id changes, and the away plugin reads it.
    await publishSharedState($, limits)
    // A subagent's or teammate's turn is never the handoff's, and the compaction does not wait for one to end.
    if (e.agentId !== undefined) return next(e)
    runningTurnIds.add(e.turnId)
    const nonce = await read($, handoffNonce)
    const isQueued = (await read($, phase)) === 'queued'
    if (isQueued && nonce !== '' && e.text.includes(nonce)) {
      await setPhase($, 'writing')
      await update($, handoffTurnId, () => e.turnId)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    runningTurnIds.delete(e.turnId)
    await refreshPercent($)
    if ((await read($, phase)) === 'writing' && e.turnId === (await read($, handoffTurnId))) {
      await finish($, e.isAborted)
    }
    return result
  })

  // Draws beneath whatever the other plugins draw here: the band holds one tree, so a hook that answered without
  // next would hide every other plugin's band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    const fill: number = await read($, percent)
    const current: HandoffPhase = await read($, phase)
    const color = fill >= limits.ceilingPercent ? 'red' : fill >= limits.warnPercent ? 'yellow' : undefined
    const line = (
      <Box key="handoff">
        <Text color={color}>Context {fill}% </Text>
        {current === 'idle' ? (
          <Button key="handoff-start" label="Hand off and compact" onPress={() => void start($, '', 'owner')} />
        ) : (
          <>
            <Text italic>
              {current === 'queued'
                ? 'handoff: waiting for the current turn to end '
                : current === 'writing'
                  ? 'handoff: Claude is writing it '
                  : 'handoff: compacting '}
            </Text>
            <Button key="handoff-cancel" label="Cancel" onPress={() => void cancel($)} />
          </>
        )}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {below}
        {line}
      </Box>
    )
  })
}
