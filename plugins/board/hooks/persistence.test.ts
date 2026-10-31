import { expect, test } from 'claude-code/testing'

import { ASK, OWNER_TASK, SESSION_KEY, SET_TASK, captureAppends, engine, mountPane, resultText, saved } from './test-support'

test('a pane press after the session id changed does not answer the old conversation', async ($, on) => {
  const session = { id: 'old' }
  const toasts: string[] = []
  const store = engine(on, { session, toasts })
  await $.tool.call(ASK as never)
  const pane = await mountPane($)

  session.id = 'new'
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store, 'session:old')).not.toContain('"answer"')
  expect(store.has('session:new')).toBe(false)
  expect(toasts).toEqual([])
})

test("a press on a frame drawn for one session does not answer another session's decision with the same id", async ($, on) => {
  const session = { id: 'old' }
  const otherBoard = {
    decisions: [
      { id: 'D1', question: 'Force-push the release branch?', options: [{ label: 'Skip' }, { label: 'Push' }], agentId: 'worker', askedBy: 'worker' },
    ],
    lastDecisionNumber: 1,
    savedAt: 500,
  }
  const store = engine(on, { session, seed: { 'session:new': otherBoard } })
  const appended = captureAppends(on)
  await $.tool.call(ASK as never)
  const pane = await mountPane($)

  session.id = 'new'
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store, 'session:new')).not.toContain('"answer"')
  expect(appended()).toEqual([])

  // The press redrew the pane for the new session, whose own options answer.
  expect((await pane.find({ key: 'D1-option-1' }))?.props.label).toBe('Push')
  await pane.press({ key: 'D1-option-0' })
  expect(saved(store, 'session:new')).toContain('"answer":"Skip"')
})

test('clearing the highest id of a board saved without its counter does not reissue it', async ($, on) => {
  const withoutCounter = {
    decisions: [],
    tasks: [
      { id: 'T1', title: 'Open', status: 'pending' },
      { id: 'T9', title: 'Finished', status: 'done' },
    ],
    savedAt: 500,
  }
  engine(on, { seed: { [SESSION_KEY]: withoutCounter } })
  // A turn's start is what restores the saved board.
  await $.turn.start({ text: '', turnId: 't0' })
  const pane = await mountPane($)
  await pane.press({ key: 'done-clear' })
  expect(JSON.stringify(await $.tool.call({ tool: SET_TASK, title: 'Next', status: 'pending' } as never))).toContain('Task T10')
})

test('a board emptied by drops is removed from the store, not saved empty', async ($, on) => {
  const store = engine(on)
  await $.tool.call({ tool: SET_TASK, title: 'Only', status: 'pending' } as never)
  expect(store.has(SESSION_KEY)).toBe(true)
  await $.tool.call({ tool: SET_TASK, id: 'T1', title: 'Only', status: 'dropped' } as never)
  expect(store.has(SESSION_KEY)).toBe(false)
})

const OLD_BOARD = {
  decisions: [],
  tasks: [{ id: 'T1', title: 'Carried over', status: 'pending' }],
  savedAt: 500,
  toolUseIds: ['toolu_shared'],
}

for (const [name, transcriptId, isAdopted] of [
  ['adopts the board of a conversation moved to a new session id', 'toolu_shared', true],
  ['leaves an unrelated session with an empty board', 'toolu_other', false],
] as const) {
  test(name, async ($, on) => {
    const store = engine(on, { seed: { 'session:old-session': OLD_BOARD }, transcriptToolUseIds: [transcriptId] })
    await $.tool.call({ tool: SET_TASK, title: 'Probe', status: 'pending' } as never)

    expect(saved(store).includes('Carried over')).toBe(isAdopted)
  })
}

test('a board holding only tasks for the owner is restored, and their ids are not issued again', async ($, on) => {
  const onlyOwnerTasks = {
    ownerTasks: [{ id: 'O4', title: 'Carried over', items: [], isDone: false }],
    // O5 and O6 were withdrawn before the save, so only the restored counter knows them.
    lastOwnerTaskNumber: 6,
    savedAt: 500,
  }
  engine(on, { seed: { [SESSION_KEY]: onlyOwnerTasks } })
  await $.turn.start({ text: '', turnId: 't0' })
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: 'Carried over' })).toBeDefined()
  expect(resultText(await $.tool.call(OWNER_TASK as never))).toContain('Posted O7')
})
