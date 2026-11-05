import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PromptOrigin, PromptSubmitInput, SessionMessage } from 'claude-code'

const MINUTE_MS = 60_000
// 2026-01-15 12:00 UTC, on a minute boundary so the note's minutes name the instant exactly.
const START_MS = Date.UTC(2026, 0, 15, 12, 0)
const NOTE = /^Local time: (\w+) (\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d) \(UTC([+-])(\d\d):(\d\d)\)\.(?: (.*))?$/

const USER: PromptOrigin = { kind: 'composer' }
const REMOTE: PromptOrigin = { kind: 'bridge' }
const SDK: PromptOrigin = { kind: 'sdk' }
const SLACK: PromptOrigin = { kind: 'slack-ping' }
const PEER: PromptOrigin = { kind: 'peer-send-message' }
const TASK: PromptOrigin = { kind: 'task-notification' }
const PLUGIN: PromptOrigin = { kind: 'plugin', name: 'reminder' }
const PLUGIN_AS_USER: PromptOrigin = { kind: 'plugin', name: 'dictation', asUser: true }

const PROMPT_MESSAGE: SessionMessage = { role: 'user', text: 'next step', toolUses: [] }
const SUMMARY_MESSAGE: SessionMessage = { role: 'user', text: 'a summary of the session so far', toolUses: [] }

/**
 * Stands for the engine: a prompt enters with the context it arrived with, unless `dropNext` is set, and a
 * compaction leaves only its summary.
 */
function engine(on: On): { dropNext: boolean } {
  const world = { dropNext: false }
  on('prompt.submit', (_, e) => {
    if (!world.dropNext) return { text: e.text, context: e.context }
    world.dropNext = false
    return { drop: 'blocked by a settings hook' }
  })
  on('session.compact', () => ({ messages: [SUMMARY_MESSAGE] }))
  return world
}

/** What the model reads beside a prompt sent at `minute` past the start, the clock moved there first. */
async function submit(
  $: Engine,
  clock: MockClock,
  minute: number,
  origin: PromptOrigin,
  context?: readonly string[],
): Promise<readonly string[] | undefined> {
  await clock.set(START_MS + minute * MINUTE_MS)
  // The kit raises the event with the origin given here, which a plugin's own submission never has.
  const prompt: PromptSubmitInput = { text: 'next step', origin, wait: false, context }
  const result = await $.prompt.submit(prompt)
  return result.drop === undefined ? result.context : undefined
}

/**
 * Reads a note back to the instant it names, whatever zone the test runs in, and what follows the time. Fails when
 * the weekday is not the wall-clock date's.
 */
function parseNote(note: string | undefined): { instantMs: number; rest: string | undefined } {
  const match = NOTE.exec(note ?? '')
  if (match === null) throw new Error(`not a time note: ${note}`)
  const numberAt = (group: number): number => Number(match[group] ?? Number.NaN)
  const year = numberAt(2)
  const month = numberAt(3)
  const day = numberAt(4)
  const hour = numberAt(5)
  const minute = numberAt(6)
  const offsetHours = numberAt(8)
  const offsetMinutes = numberAt(9)
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute)
  const offsetMs = (offsetHours * 60 + offsetMinutes) * MINUTE_MS
  const signedOffsetMs = match[7] === '-' ? -offsetMs : offsetMs
  const dayStart = new Date(Date.UTC(year, month - 1, day))
  expect(match[1]).toBe(dayStart.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }))
  return { instantMs: wallClockMs - signedOffsetMs, rest: match[10] }
}

test('the first prompt carries the local date and time, and nothing else', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  const context = await submit($, clock, 0, USER)

  expect(context).toHaveLength(1)
  const note = parseNote(context?.[0])
  expect(note.instantMs).toBe(START_MS)
  expect(note.rest).toBeUndefined()
})

test('the time joins the context other hooks attached, after it', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  const context = await submit($, clock, 0, USER, ['an earlier note'])

  expect(context?.[0]).toBe('an earlier note')
  expect(parseNote(context?.[1]).instantMs).toBe(START_MS)
})

test('the time comes again only 15 minutes after it last did, with the time since the user last wrote from any client', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  await submit($, clock, 0, USER)
  expect(await submit($, clock, 10, REMOTE)).toBeUndefined()
  const context = await submit($, clock, 15, USER)
  await submit($, clock, 29.5, USER)
  const underAMinute = await submit($, clock, 30, USER)

  const note = parseNote(context?.[0])
  expect(note.instantMs).toBe(START_MS + 15 * MINUTE_MS)
  expect(note.rest).toBe("The user's previous message was 5 min ago.")
  expect(parseNote(underAMinute?.[0]).rest).toBe("The user's previous message was less than 1 min ago.")
})

test('prompts from other sessions, tasks and plugins get the time but are not the user writing, while an SDK host is', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  await submit($, clock, 0, SDK)
  await submit($, clock, 20, PEER)
  await submit($, clock, 40, TASK)
  await submit($, clock, 60, PLUGIN)
  const context = await submit($, clock, 85, PEER)

  expect(parseNote(context?.[0]).rest).toBe("The user's previous message was 1 h 25 min ago.")
})

test('the user writing from Slack, or a plugin passing on their own words, is the user writing', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  await submit($, clock, 0, SLACK)
  const afterSlack = await submit($, clock, 20, PLUGIN_AS_USER)
  const afterPlugin = await submit($, clock, 40, TASK)

  expect(parseNote(afterSlack?.[0]).rest).toBe("The user's previous message was 20 min ago.")
  expect(parseNote(afterPlugin?.[0]).rest).toBe("The user's previous message was 20 min ago.")
})

test('the first prompt after a compaction carries the time, however soon it comes', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  await submit($, clock, 0, USER)
  await $.session.compact({ trigger: 'auto', messages: [PROMPT_MESSAGE] })
  const context = await submit($, clock, 5, USER)

  expect(parseNote(context?.[0]).rest).toBe("The user's previous message was 5 min ago.")
})

test('a prompt that never entered does not hold back the time from the next one', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)

  world.dropNext = true
  await submit($, clock, 0, USER)
  const context = await submit($, clock, 1, USER)

  expect(parseNote(context?.[0]).rest).toBeUndefined()
})
