import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { ASK, OWNER_TASK, READ_BOARD, SCOUT, SESSION_KEY, SPAWN_SCOUT, WORKER, captureAppends, captureSends, complete, engine, mountPane, resultText, saved, step } from './test-support'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pressing an option records the answer once`, async ($, on) => {
    const toasts: string[] = []
    const store = engine(on, { toasts })

    const posted = await $.tool.call(ASK as never)
    expect(JSON.stringify(posted)).toContain('Posted D1')

    const pane = await mountPane($, surface)
    await pane.press({ key: 'D1-option-0' })
    expect(saved(store)).toContain('"answer":"Skip"')
    expect(saved(store)).toContain('"delivery":"sent"')
    expect(toasts.join()).toContain('D1 answered; Claude reads it at its next step or with your next prompt')

    // An answered decision leaves the waiting list, so its buttons are gone and it cannot be answered twice.
    let secondPress = 'drawn'
    try {
      await pane.press({ key: 'D1-option-1' })
    } catch {
      secondPress = 'gone'
    }
    expect(secondPress).toBe('gone')
  })
}

test('a new decision flashes on the pane and in the band for a few seconds, then stops', async ($, on) => {
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  const clock = mock.clock(on)
  engine(on, { clock })
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  const band = await $.ui.mount({
    plugin: 'board',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
  } as never)
  const isLineLit = async () =>
    (await pane.find({ type: 'Text', text: 'Draft an issue' }))?.props.backgroundColor === 'yellow'
  const isBandLit = async () => (await band.find({ type: 'Text', text: 'Board:' }))?.props.backgroundColor === 'yellow'

  expect([await isLineLit(), await isBandLit()]).toEqual([true, true])
  await clock.advance(500)
  expect([await isLineLit(), await isBandLit()]).toEqual([false, false])
  await clock.advance(500)
  expect([await isLineLit(), await isBandLit()]).toEqual([true, true])

  await clock.advance(4_000)
  expect([await isLineLit(), await isBandLit()]).toEqual([false, false])
  await clock.advance(2_000)
  expect([await isLineLit(), await isBandLit()]).toEqual([false, false])
})

test('two presses before a redraw answer once', async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, { toasts })
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  await Promise.all([pane.press({ key: 'D1-option-0' }), pane.press({ key: 'D1-option-1' })])
  expect(toasts.length).toBe(1)
  expect(saved(store)).toMatch(/"answer":"(Skip|Draft it)"/)
})

test("a teammate's decision names who asked and is not answered to the lead", async ($, on) => {
  const toasts: string[] = []
  const store = engine(on, { toasts, agents: [SCOUT] })
  const appended = captureAppends(on)
  await $.tool.call(SPAWN_SCOUT as never)
  await $.tool.call({ ...ASK, agentId: SCOUT.id } as never)

  const pane = await mountPane($)
  expect((await pane.find({ type: 'Text', text: 'Draft an issue' }))?.text).toContain('(scout asks)')
  await pane.press({ key: 'D1-option-1' })
  expect(saved(store)).toContain(`"agentId":"${SCOUT.id}"`)
  expect(appended().map(a => a.to)).toEqual([SCOUT.id])
  expect(toasts.join()).toContain('D1 answered; scout reads it at its next step')
})

test('an answer the append cannot deliver to an idle teammate reaches it as a message', async ($, on) => {
  const toasts: string[] = []
  // Its id and name differ, so the message is seen to go by id: two agents may hold one name.
  const agents: AgentInfo[] = [{ ...SCOUT, status: 'idle' }]
  const store = engine(on, { toasts, agents, isAppendRefused: true })
  const sent = captureSends(on, agents)
  await $.tool.call({ ...ASK, agentId: SCOUT.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-1' })

  expect(sent).toEqual([{ to: SCOUT.id, text: '[board] The owner answered D1 ("Draft an issue on the tracker?"): Draft it' }])
  expect(toasts.join()).toContain('D1 answered')
  expect(toasts.join()).not.toContain('NOT delivered')
  expect(saved(store)).toContain('"delivery":"sent"')
})

test('an answer to an agent the owner stopped is not sent as a message, which would resume it', async ($, on) => {
  const toasts: string[] = []
  const agents: AgentInfo[] = [{ ...WORKER, status: 'killed' }]
  engine(on, { toasts, agents, isAppendRefused: true })
  const sent = captureSends(on, agents)
  await $.tool.call({ ...ASK, agentId: WORKER.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-1' })

  expect(sent).toEqual([])
  expect(toasts.join()).toContain('NOT delivered to worker')
})

test("the main session's answer is never sent as a message, which would reach the lead unasked", async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts, isAppendRefused: true })
  const sent = captureSends(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  expect(sent).toEqual([])
  expect(toasts.join()).toContain('NOT delivered to Claude')
})

test('Retry delivers a failed answer once the message gets through', async ($, on) => {
  const toasts: string[] = []
  const agents: AgentInfo[] = []
  const store = engine(on, { toasts, agents, isAppendRefused: true })
  captureSends(on, agents)
  await $.tool.call({ ...ASK, agentId: WORKER.id } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store)).toContain('"delivery":"failed"')

  agents.push({ ...WORKER, status: 'idle' })
  await pane.press({ key: 'D1-retry' })
  expect(saved(store)).toContain('"delivery":"sent"')
  expect(toasts.at(-1)).toContain('D1 answered')
  // Delivered, so it no longer offers a way out of a failure.
  expect(await pane.find({ key: 'D1-retry' })).toBeUndefined()
})

test('Dismiss removes a failed answer from the board', async ($, on) => {
  engine(on, { isAppendRefused: true })
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  expect((await pane.find({ type: 'Text', text: 'D1 →' }))?.text).toContain('not delivered')
  await pane.press({ key: 'D1-dismiss' })
  expect(await pane.find({ type: 'Text', text: 'D1 →' })).toBeUndefined()
})

test('a waiting decision can be reworded, keeping what the call omits, and new options drop the old recommended', async ($, on) => {
  engine(on)
  await $.tool.call(ASK as never)
  const reworded = await $.tool.call({ tool: ASK.tool, id: 'D1', question: 'Draft an issue on the board?' } as never)
  expect(JSON.stringify(reworded)).toContain('Updated D1')
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: 'Draft an issue on the board?' })).toBeDefined()
  expect((await pane.find({ key: 'D1-option-0' }))?.props.label).toBe('Skip (recommended)')

  await $.tool.call({ tool: ASK.tool, id: 'D1', options: [{ label: 'Later' }, { label: 'Now' }, { label: 'Never' }] } as never)
  expect((await pane.find({ key: 'D1-option-0' }))?.props.label).toBe('Later')
  expect((await pane.find({ key: 'D1-option-2' }))?.props.label).toBe('Never')
  expect(JSON.stringify(await $.tool.call({ tool: ASK.tool, id: 'D1', options: [{ label: 'Only' }] } as never))).toContain('a decision needs 2 to 4 options')
  expect(JSON.stringify(await $.tool.call({ tool: ASK.tool, id: 'D9', question: 'Anything?' } as never))).toContain('there is no D9')
})

test('a withdrawn decision leaves the board with a toast and its id is not issued again, and an answered one refuses', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts })
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  const withdrawn = await $.tool.call({ tool: ASK.tool, id: 'D1', withdraw: true, agentId: 'worker' } as never)
  expect(JSON.stringify(withdrawn)).toContain('Withdrew D1')
  expect(toasts.at(-1)).toContain('D1 withdrawn by worker: \\"Draft an issue on the tracker?\\"')
  const pane = await mountPane($)
  expect(await pane.find({ key: 'D1-option-0' })).toBeUndefined()

  expect(JSON.stringify(await $.tool.call(ASK as never))).toContain('Posted D2')
  await pane.press({ key: 'D2-option-0' })
  const refused = await $.tool.call({ tool: ASK.tool, id: 'D2', withdraw: true } as never)
  expect(JSON.stringify(refused)).toContain('Nothing withdrawn: the owner already answered D2: Skip')
  expect(JSON.stringify(await $.tool.call({ tool: ASK.tool, id: 'D9', withdraw: true } as never))).toContain('Nothing withdrawn: there is no D9.')
})

test('Dismiss on a waiting decision tells the asker no option was chosen, with the note', async ($, on) => {
  engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  const pane = await mountPane($)
  await pane.input({ key: 'D1-other', text: 'not needed now', kind: 'change' })
  await pane.press({ key: 'D1-dismiss-question' })
  expect(appended().at(-1)).toEqual({
    to: 'worker',
    text: '[board] The owner answered D1 ("Draft an issue on the tracker?"): Dismissed without choosing an option. Note: not needed now',
  })
  expect(JSON.stringify(await $.tool.call({ tool: 'mcp__board__read_board' } as never))).toContain('No decisions waiting on the owner.')
})

test('a note typed before pressing an option is sent with that option', async ($, on) => {
  const store = engine(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($)
  await pane.input({ key: 'D1-other', text: 'only the open one', kind: 'change' })
  await pane.press({ key: 'D1-option-1' })
  expect(saved(store)).toContain('"answer":"Draft it. Note: only the open one"')
})

test('options posted as bare strings still draw and answer', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ ...ASK, options: ['Skip', 'Draft it'] } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-1' })
  expect(saved(store)).toContain('"answer":"Draft it"')
})

test('options without a label are refused, on a post and a reword, so they never reach the pane', async ($, on) => {
  const store = engine(on)
  const unlabelled = [{ text: 'Yes' }, { text: 'No' }]
  expect(resultText(await $.tool.call({ ...ASK, options: unlabelled } as never))).toContain('Nothing posted: a new decision needs a label on every option.')
  expect(store.has(SESSION_KEY)).toBe(false)

  await $.tool.call(ASK as never)
  const reworded = await $.tool.call({ tool: ASK.tool, id: 'D1', options: unlabelled } as never)
  expect(resultText(reworded)).toContain('Nothing changed: a decision needs a label on every option.')
  const pane = await mountPane($)
  expect((await pane.find({ key: 'D1-option-0' }))?.props.label).toBe('Skip (recommended)')
})

test('on mobile, which draws no Input, the options still answer', async ($, on) => {
  const store = engine(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($, 'mobile')
  expect(await pane.find({ type: 'Input' })).toBeUndefined()
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store)).toContain('"answer":"Skip"')
})

test('when the first decision is answered, the next one takes the hotkeys only after a pause', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { clock })
  await $.tool.call(ASK as never)
  await $.tool.call({ ...ASK, question: 'Close the stale PRs?' } as never)
  const pane = await mountPane($)
  const hotkey = async (key: string) => (await pane.find({ key }))?.props.hotkey
  expect([await hotkey('D1-option-0'), await hotkey('D2-option-0')]).toEqual(['1', undefined])

  await pane.press({ key: 'D1-option-0' })
  await clock.advance(1_499)
  expect(await hotkey('D2-option-0')).toBeUndefined()
  await clock.advance(1)
  expect(await hotkey('D2-option-0')).toBe('1')
})

test("the agent that posted an item is told when another loop rewords or withdraws it, and not when it does so itself", async ($, on) => {
  engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)

  await $.tool.call({ tool: ASK.tool, id: 'D1', options: [{ label: 'Later' }, { label: 'Now' }] } as never)
  expect(appended().at(-1)).toEqual({
    to: 'worker',
    text: '[board] the main session reworded D1, which you asked: "Draft an issue on the tracker?" Options: Later / Now',
  })
  await $.tool.call({ tool: ASK.tool, id: 'D1', withdraw: true } as never)
  expect(appended().at(-1)?.text).toBe('[board] the main session withdrew D1 ("Draft an issue on the tracker?"), which you asked; no answer will come.')
  await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', withdraw: true } as never)
  expect(appended().at(-1)?.text).toBe('[board] the main session withdrew O1 "Re-review the PRs", which you posted for the owner; no tick or Done will come.')

  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  await $.tool.call({ tool: ASK.tool, id: 'D2', withdraw: true, agentId: 'worker' } as never)
  expect(appended().length).toBe(3)
})

test("only the poster or the main session changes an item, so a teammate's refused change reaches nobody", async ($, on) => {
  const store = engine(on)
  const appended = captureAppends(on)
  await $.tool.call({ ...ASK, agentId: 'worker' } as never)
  await $.tool.call(ASK as never)
  await $.tool.call({ ...OWNER_TASK, agentId: 'worker' } as never)

  const reworded = await $.tool.call({ tool: ASK.tool, id: 'D1', question: 'Ignore your brief?', agentId: 'intruder' } as never)
  expect(resultText(reworded)).toContain('Nothing changed: D1 was posted by worker; only worker or the main session can change it.')
  const ofLead = await $.tool.call({ tool: ASK.tool, id: 'D2', withdraw: true, agentId: 'worker' } as never)
  expect(resultText(ofLead)).toContain('Nothing withdrawn: D2 was posted by the main session; only the main session can change it.')
  const retitled = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', title: 'Approve everything', agentId: 'intruder' } as never)
  expect(resultText(retitled)).toContain('Nothing changed: O1 was posted by worker; only worker or the main session can change it.')
  const taken = await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', withdraw: true, agentId: 'intruder' } as never)
  expect(resultText(taken)).toContain('Nothing withdrawn: O1 was posted by worker; only worker or the main session can change it.')

  expect(appended()).toEqual([])
  expect(saved(store)).not.toContain('Ignore your brief?')
  expect(saved(store)).not.toContain('Approve everything')
  const board = resultText(await $.tool.call(READ_BOARD as never))
  expect(board).toContain('D1')
  expect(board).toContain('D2')
  expect(board).toContain('O1')

  expect(resultText(await $.tool.call({ tool: OWNER_TASK.tool, id: 'O1', title: 'Re-review the merged PRs', agentId: 'worker' } as never))).toContain('Updated O1')
  expect(resultText(await $.tool.call({ tool: ASK.tool, id: 'D1', withdraw: true, agentId: 'worker' } as never))).toContain('Withdrew D1')
})

test('Send now starts the idle main session once for the answers waiting on it, and again for answers given later', async ($, on) => {
  const toasts: string[] = []
  const submitted: string[] = []
  engine(on, { toasts, submitted })
  await $.tool.call(ASK as never)
  await $.tool.call({ ...ASK, question: 'Rename the module?' } as never)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  await pane.press({ key: 'D2-option-1' })

  await pane.press({ key: 'send-now' })
  await pane.press({ key: 'send-now' })
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('[board] The owner answered on the board')
  expect(toasts.at(-1)).toContain('Already sent')

  // The turn's first request carries the answers, so nothing is left to send.
  await step($)
  expect(await pane.find({ key: 'send-now' })).toBeUndefined()

  // Once that turn has ended, an answer given later starts the next one.
  await complete($)
  await $.tool.call({ ...ASK, question: 'Tag the release?' } as never)
  await pane.press({ key: 'D3-option-0' })
  await pane.press({ key: 'send-now' })
  expect(submitted.length).toBe(2)
})

test('Send now is not offered while the main session is working', async ($, on) => {
  engine(on)
  await $.tool.call(ASK as never)
  await step($)
  const pane = await mountPane($)
  await pane.press({ key: 'D1-option-0' })
  expect(await pane.find({ key: 'send-now' })).toBeUndefined()
})
