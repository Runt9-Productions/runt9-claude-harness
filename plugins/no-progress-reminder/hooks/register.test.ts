import { expect, test } from 'claude-code/testing'

const ENGINE = { kind: 'engine' } as const

test('the progress reminder is left out of the request', async ($, on) => {
  on('prompt.attachment', (_, e) => ({ text: e.text }))

  const result = await $.prompt.attachment({ type: 'silent_turn_reminder', text: 'say what you are doing', origin: ENGINE })

  expect(result.text).toBeNull()
})

test('every other attachment reaches the model unchanged', async ($, on) => {
  on('prompt.attachment', (_, e) => ({ text: e.text }))

  const result = await $.prompt.attachment({ type: 'todo_reminder', text: 'todo list is empty', origin: ENGINE })

  expect(result.text).toBe('todo list is empty')
})
