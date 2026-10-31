import type { ModelCompleteInput, ModelCompleteResult, On, PromptOrigin } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const INSTALL = { tool: 'Bash', command: 'sudo apt-get install -y example-tool', description: 'Install a tool' } as const

function verdict(line: string): ModelCompleteResult {
  return { isAnswered: true, text: `Reason: synthetic reason.\n${line}`, usage: NO_USAGE }
}

// The engine beneath the plugin: the judge answers `reply`, and a call that gets past the plugin runs.
function engine(on: On, reply: ModelCompleteResult, previousAgentText = 'May I install example-tool with apt?'): ModelCompleteInput[] {
  const asked: ModelCompleteInput[] = []
  on('model.complete', (_, e) => {
    asked.push(e)
    return { value: reply }
  })
  on('clock.now', () => ({ value: 0 }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: previousAgentText, toolUses: [] }] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { stdout: 'ran' } }))
  return asked
}

function submit($: Engine, text: string, origin: PromptOrigin) {
  return $.prompt.submit({ text, origin, wait: false })
}

test('a call the judge denies is refused with its reason', async ($, on) => {
  engine(on, verdict('Verdict: DENY'))

  const ran = await $.tool.call(INSTALL)

  expect(ran.deny).toBe('guardrails: synthetic reason.')
})

test('a call the judge allows runs', async ($, on) => {
  engine(on, verdict('Verdict: ALLOW'))

  const ran = await $.tool.call(INSTALL)

  expect(ran.deny).toBeUndefined()
})

test('a reply that allows and also denies is a denial', async ($, on) => {
  engine(on, verdict('Verdict: ALLOW\nVerdict: DENY'))

  const ran = await $.tool.call(INSTALL)

  expect(ran.deny).toBe('guardrails: synthetic reason.')
})

test('a verdict written on the reason line is read, and left out of the reason', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Reason: synthetic reason. Verdict: DENY', usage: NO_USAGE })

  const ran = await $.tool.call(INSTALL)

  expect(ran.deny).toBe('guardrails: synthetic reason.')
})

test('a failed judge request refuses the call', async ($, on) => {
  engine(on, { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: NO_USAGE })

  const ran = await $.tool.call(INSTALL)

  expect(ran.deny).toContain('the judge\'s request failed (overloaded, status 529)')
})

test('a call with nothing to judge runs without asking the judge', async ($, on) => {
  const asked = engine(on, verdict('Verdict: DENY'))

  const ran = await $.tool.call({ tool: 'Bash', command: 'npm run build && git status' })

  expect(ran.deny).toBeUndefined()
  expect(asked).toHaveLength(0)
})

test('the judge reads what the owner typed and what it answered, and not a plugin prompt', async ($, on) => {
  const asked = engine(on, verdict('Verdict: ALLOW'))

  await submit($, 'yes, go ahead', { kind: 'composer' })
  await submit($, 'synthetic plugin instruction', { kind: 'plugin', name: 'example-plugin' })
  await $.tool.call(INSTALL)

  const prompt = asked[0]?.prompt ?? ''
  expect(prompt).toContain('yes, go ahead')
  expect(prompt).toContain('May I install example-tool with apt?')
  expect(prompt).not.toContain('synthetic plugin instruction')
})
