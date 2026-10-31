import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const COMPACTED = { messages: [{ role: 'user', text: 'the summary', toolUses: [] }] }

type Handoff = { submitted: string[]; toasts: string[]; compactions: string[]; clock: MockClock }

/**
 * The engine nouns the mod calls, answered in memory. `isTurnRunning` makes every compaction reject while it
 * reads true, as the engine does while a turn holds the session. `isRefused` drops a prompt, as a hook or the engine
 * refuses one, and it is then not recorded as submitted.
 */
function engine(on: On, compacted: object = COMPACTED, isTurnRunning = () => false, isRefused = (_text: string) => false): Handoff {
  const submitted: string[] = []
  const toasts: string[] = []
  const compactions: string[] = []
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => {
    if (isRefused(e.text)) return { drop: 'the prompt was refused' }
    // An event, unlike an engine op, answers with its own result rather than { value }.
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('session.compact', ($, e) => {
    if (isTurnRunning()) throw new Error('a turn is running')
    compactions.push(String(e.instructions))
    return compacted as never
  })
  // As live: after a compaction no response has come back yet, so only the estimate has a fill.
  on('session.usage', ($, e) => {
    const window = 1_000_000
    if (!compactions.length) return { value: { context: { window, percent: 12 } } } as never
    const breakdown = (e as { breakdown?: string }).breakdown ? { totalTokens: 30_000 } : undefined
    return { value: { context: { window, breakdown } } } as never
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // What the other plugins draw in the band; the handoff hook draws its line beneath it.
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  return { submitted, toasts, compactions, clock }
}

const COMPACT_WITH = { tool: 'mcp__handoff__compact_with', message: 'Keep the plan; read handoff.md first' }

const turnStart = ($: Engine, text: string, turnId: string, agentId?: string) => $.turn.start({ text, turnId, agentId })

const turnComplete = ($: Engine, turnId: string, isAborted = false) =>
  $.turn.complete({ reason: isAborted ? 'aborted' : 'answer', answer: '', durationMs: 1, isAborted, turnId })

/** Presses Hand off and lets the queued prompt submit. */
async function press($: Engine, h: Handoff, stress = '') {
  await $.command.run({ command: 'handoff', args: stress, origin: { kind: 'composer' } } as never)
  // The submit waits for the command's hook to return, on a timer.
  await h.clock.advance(10)
}

/**
 * The handoff turn's text as the engine starts it: a plugin's prompt arrives wrapped, so the mark is not at the start.
 * The handoff plugin sent a message:
 * [handoff] The owner asked to hand off and compact. ...
 */
const asDelivered = (prompt: string) => `The handoff plugin sent a message:\n${prompt}`

/** A whole handoff: the press, its turn, compact_with, the turn's end, and the time the compaction takes. */
async function runHandoff($: Engine, h: Handoff) {
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  await h.clock.advance(1000)
}

test('compact_with refuses when no handoff was asked for', async ($, on) => {
  engine(on)
  const result = await $.tool.call(COMPACT_WITH as never)
  expect(JSON.stringify(result)).toContain('nothing will compact')
})

test('/handoff asks Claude for the handoff and passes on what to stress', async ($, on) => {
  const h = engine(on)
  await press($, h, 'the open schema question')
  expect(h.submitted.length).toBe(1)
  expect(h.submitted[0]).toContain('[handoff]')
  expect(h.submitted[0]).toContain('stress: the open schema question')
})

test('compact_with called before the handoff turn starts saves nothing', async ($, on) => {
  const h = engine(on)
  await press($, h)
  // The turn the press queued behind is still running, and it calls the tool.
  expect(JSON.stringify(await $.tool.call(COMPACT_WITH as never))).toContain('nothing will compact')
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await turnComplete($, 't1')
  await h.clock.advance(10_000)
  // Only the call's message is checked: whether a handoff left with none compacts is another test's.
  expect(h.compactions).not.toContain(COMPACT_WITH.message)
})

test('compact_with called from a subagent during the handoff turn saves nothing', async ($, on) => {
  const h = engine(on)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  const fromAgent = await $.tool.call({ ...COMPACT_WITH, agentId: 'a1' } as never)
  expect(JSON.stringify(fromAgent)).toContain('nothing will compact')
  await turnComplete($, 't1')
  await h.clock.advance(10_000)
  expect(h.compactions).not.toContain(COMPACT_WITH.message)
})

test('compact_with refuses a message that is not text, and keeps the one already saved', async ($, on) => {
  const h = engine(on)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  const notText = await $.tool.call({ ...COMPACT_WITH, message: { text: 'nested' } } as never)
  const blank = await $.tool.call({ ...COMPACT_WITH, message: '  ' } as never)
  expect(JSON.stringify(notText)).toContain('Not saved')
  expect(JSON.stringify(blank)).toContain('Not saved')
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
})

test('after the compaction, a resume prompt has Claude wait for the owner to confirm its next step', async ($, on) => {
  const h = engine(on)
  await runHandoff($, h)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
  expect(h.submitted.length).toBe(2)
  expect(h.submitted[1]).toContain('[resume]')
  expect(h.submitted[1]).toContain('the owner confirms')
})

/** Reads the mod's state as another plugin does: `/handoff-state "<key>"` answers the value as JSON. */
const PROBE: Plugin = {
  name: 'probe',
  register(on) {
    on('command.run', { command: 'handoff-state' }, async ($, e) => {
      // The engine takes only a literal key, so each is spelled out.
      const key = JSON.parse(e.args) as SharedKey
      const read = {
        phase: () => $.state.get({ plugin: 'handoff', key: 'phase' }),
        ceilingPercent: () => $.state.get({ plugin: 'handoff', key: 'ceilingPercent' }),
        isUnattended: () => $.state.get({ plugin: 'handoff', key: 'isUnattended' }),
      }
      const { value } = await read[key]()
      return { text: JSON.stringify(value) }
    })
  },
}

type SharedKey = 'phase' | 'ceilingPercent' | 'isUnattended'

async function handoffState($: Engine, key: SharedKey): Promise<unknown> {
  const result = (await $.command.run({ command: 'handoff-state', args: JSON.stringify(key) } as never)) as { text: string }
  return result.text ? JSON.parse(result.text) : undefined
}

test('a turn publishes the ceiling_percent option as the ceiling the away plugin hands off at', { plugins: [PROBE], options: { ceiling_percent: 50 } }, async ($, on) => {
  engine(on)
  await turnStart($, 'go', 't1')
  expect(await handoffState($, 'ceilingPercent')).toBe(50)
})

test('another plugin reads the phase as idle before any handoff', { plugins: [PROBE] }, async ($, on) => {
  engine(on)
  await turnStart($, 'go', 't1')
  expect(await handoffState($, 'phase')).toBe('idle')
})

/** The band above the prompt. */
async function mountBand($: Engine) {
  return $.ui.mount({
    plugin: 'handoff',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
  } as never)
}

test('after the compaction, the band shows the estimated fill rather than 0%', async ($, on) => {
  const h = engine(on)
  await runHandoff($, h)
  const band = await mountBand($)
  expect((await band.find({ type: 'Text' }))?.text).toContain('Context 3%')
})

test('Cancel on a queued handoff compacts nothing when its turn runs, and the next press starts one', async ($, on) => {
  const h = engine(on)
  await press($, h)
  await (await mountBand($)).press({ key: 'handoff-cancel' })
  expect(h.toasts.join()).toContain('Handoff cancelled')

  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  expect(JSON.stringify(await $.tool.call(COMPACT_WITH as never))).toContain('the owner cancelled it')
  await turnComplete($, 't1')
  await h.clock.advance(10_000)
  expect(h.compactions).toEqual([])

  await press($, h)
  expect(h.submitted.length).toBe(2)
})

test('Cancel while Claude writes the handoff compacts nothing when the turn ends', async ($, on) => {
  const h = engine(on)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await (await mountBand($)).press({ key: 'handoff-cancel' })
  await turnComplete($, 't1')
  await h.clock.advance(10_000)
  expect(h.compactions).toEqual([])
})

test('Cancel while the compaction waits on a running turn stops it before it compacts', async ($, on) => {
  let isBusy = false
  const h = engine(on, COMPACTED, () => isBusy)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  isBusy = true
  await turnStart($, '<teammate-message>found it</teammate-message>', 'tB')
  await h.clock.advance(5_000)
  await (await mountBand($)).press({ key: 'handoff-cancel' })

  isBusy = false
  await turnComplete($, 'tB')
  await h.clock.advance(10_000)
  expect(h.compactions).toEqual([])
  expect(h.submitted.length).toBe(1)
})

const failures = (h: Handoff) => h.submitted.filter(s => s.includes('The handoff failed'))

test('a skipped compaction the owner started toasts why and submits nothing more', async ($, on) => {
  const h = engine(on, { skip: 'vetoed' })
  await runHandoff($, h)
  expect(h.compactions.length).toBe(1)
  expect(h.submitted.length).toBe(1)
  expect(h.toasts.join()).toContain('Compaction skipped: vetoed')
})

test('a second request while one is under way is refused', async ($, on) => {
  const h = engine(on)
  await press($, h)
  await press($, h)
  expect(h.submitted.length).toBe(1)
  expect(h.toasts.join()).toContain('already under way')
})

test("a turn that starts before the handoff prompt's own is not taken for the handoff", async ($, on) => {
  const h = engine(on)
  await press($, h)
  // A teammate's message reaches the lead first and runs as a turn of its own.
  await turnStart($, '<teammate-message>done</teammate-message>', 'tA')
  await turnComplete($, 'tA')
  expect(h.toasts.join()).not.toContain('without a compaction message')

  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  expect(JSON.stringify(await $.tool.call(COMPACT_WITH as never))).toContain('compacts when it ends')
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
})

test('a turn that quotes a handoff prompt is not taken for the handoff', async ($, on) => {
  const h = engine(on)
  await press($, h)
  // A teammate reporting on this plugin quotes an opening it read in the code.
  await turnStart($, '<teammate-message>[handoff] The owner asked to hand off and compact.</teammate-message>', 'tA')
  await turnComplete($, 'tA')
  expect(h.toasts.join()).not.toContain('without a compaction message')

  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
})

test("a subagent's turn given the handoff prompt is not taken for the handoff", async ($, on) => {
  const h = engine(on)
  await press($, h)
  await turnStart($, h.submitted[0] ?? '', 'tA', 'a1')
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  // The end of the main loop's turn starts the compaction. The subagent's turn never ends, and whether that holds
  // the compaction is the next test's.
  expect(h.toasts.join()).toContain('Compacting with the message Claude wrote')
})

test("a subagent's turn still running when the handoff turn ends does not hold the compaction", async ($, on) => {
  const h = engine(on)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnStart($, 'look into the schema', 'tA', 'a1')
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
})

test('a handoff whose prompt is dropped toasts why, and the next press starts one', async ($, on) => {
  let isDropping = true
  const h = engine(on, COMPACTED, () => false, () => isDropping)
  await press($, h)
  expect(h.toasts.join()).toContain('Handoff not started: the prompt was refused')

  isDropping = false
  await press($, h)
  expect(h.submitted.length).toBe(1)
  expect(h.toasts.join()).not.toContain('already under way')
})

test('interrupting the handoff turn compacts nothing', async ($, on) => {
  const h = engine(on)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1', true)
  await h.clock.advance(10_000)
  expect(h.compactions).toEqual([])
  expect(h.toasts.join()).toContain('interrupted; nothing was compacted')
})

test('a turn that starts before the compaction waits for it to end, however long it runs', async ($, on) => {
  let isBusy = false
  const h = engine(on, COMPACTED, () => isBusy)
  await press($, h)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  // A teammate's message starts a lead turn before the first attempt, and it outlasts every retry.
  isBusy = true
  await turnStart($, '<teammate-message>found it</teammate-message>', 'tB')
  await h.clock.advance(30_000)
  expect(h.compactions).toEqual([])
  expect(h.toasts.join()).not.toContain('Compaction failed')

  isBusy = false
  await turnComplete($, 'tB')
  await h.clock.advance(1000)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
})

test('a handoff the owner starts compacts nothing when Claude wrote no compaction message', async ($, on) => {
  const h = engine(on)
  await press($, h)
  expect(h.submitted[0]).toContain('The owner asked')
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
  await turnComplete($, 't1')
  await h.clock.advance(10_000)
  expect(h.compactions).toEqual([])
  expect(h.toasts.join()).toContain('without a compaction message; nothing was compacted')
})

/** Stands in for the away plugin: `/away-handoff` runs /handoff as away does, so the run's origin is a plugin's. */
const AWAY: Plugin = {
  name: 'away',
  register(on) {
    on('command.run', { command: 'away-handoff' }, $ => {
      // A command run from a command's own hook is refused, so it runs from a later event.
      $.clock.after(1, () => void $.command.run({ command: 'handoff' } as never))
      return { text: '' }
    })
  },
}

/** Stands in for any other plugin: `/other-handoff` runs /handoff the same way, under another name. */
const OTHER: Plugin = {
  name: 'other',
  register(on) {
    on('command.run', { command: 'other-handoff' }, $ => {
      $.clock.after(1, () => void $.command.run({ command: 'handoff' } as never))
      return { text: '' }
    })
  },
}

/** A handoff the away plugin starts, up to the start of its turn. */
async function startUnattended($: Engine, h: Handoff) {
  await $.command.run({ command: 'away-handoff', args: '' } as never)
  await h.clock.advance(10)
  await turnStart($, asDelivered(h.submitted[0] ?? ''), 't1')
}

test('a handoff away starts says the owner is away, resumes the work without waiting, and clears isUnattended', { plugins: [AWAY, PROBE] }, async ($, on) => {
  const h = engine(on)
  await startUnattended($, h)
  expect(h.submitted[0]).toContain('the owner is away')

  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(h.compactions).toEqual([COMPACT_WITH.message])
  // The prompt telling Claude a handoff failed also ends "carry on with the work".
  expect(h.submitted[1]).toContain('[resume]')
  expect(h.submitted[1]).toContain('carry on with the work')
  expect(h.submitted[1]).not.toContain('the owner confirms')
  expect(await handoffState($, 'isUnattended')).toBe(false)
})

test("a handoff another plugin starts is the owner's, not an unattended one", { plugins: [OTHER] }, async ($, on) => {
  const h = engine(on)
  await $.command.run({ command: 'other-handoff', args: '' } as never)
  await h.clock.advance(10)
  expect(h.submitted[0]).toContain('The owner asked')
})

test('a handoff away starts compacts even when Claude wrote no compaction message', { plugins: [AWAY] }, async ($, on) => {
  const h = engine(on)
  await startUnattended($, h)
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(h.compactions.length).toBe(1)
  expect(h.compactions[0]).toContain('name its path as the file to read first')
  expect(h.submitted[1]).toContain('[resume]')
})

test('a handoff away starts compacts nothing when the owner interrupts its turn', { plugins: [AWAY] }, async ($, on) => {
  const h = engine(on)
  await startUnattended($, h)
  await turnComplete($, 't1', true)
  await h.clock.advance(10_000)
  expect(h.compactions).toEqual([])
})

test('an unattended handoff whose compaction is skipped tells Claude so and clears isUnattended', { plugins: [AWAY, PROBE] }, async ($, on) => {
  const h = engine(on, { skip: 'vetoed' })
  await startUnattended($, h)
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  await h.clock.advance(1000)
  expect(failures(h).length).toBe(1)
  expect(failures(h)[0]).toContain('Compaction skipped: vetoed')
  expect(await handoffState($, 'isUnattended')).toBe(false)
})

test('an unattended handoff whose compaction keeps failing tells Claude so', { plugins: [AWAY] }, async ($, on) => {
  // Every attempt rejects, with no turn of the mod's own running to wait for.
  const h = engine(on, COMPACTED, () => true)
  await startUnattended($, h)
  await $.tool.call(COMPACT_WITH as never)
  await turnComplete($, 't1')
  await h.clock.advance(10_000)
  expect(failures(h).length).toBe(1)
  expect(failures(h)[0]).toContain('Compaction failed')
  expect(failures(h)[0]).not.toContain('/compact by hand')
})

test('an unattended handoff whose prompt is refused tells Claude so', { plugins: [AWAY] }, async ($, on) => {
  const h = engine(on, COMPACTED, () => false, text => text.includes('hand off and compact'))
  await $.command.run({ command: 'away-handoff', args: '' } as never)
  await h.clock.advance(10)
  expect(failures(h).length).toBe(1)
  expect(failures(h)[0]).toContain('Handoff not started')
})
