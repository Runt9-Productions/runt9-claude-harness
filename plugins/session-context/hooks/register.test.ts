import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PromptOrigin, PromptSubmitInput, SessionMessage, SessionRateLimit } from 'claude-code'

const MINUTE_MS = 60_000
// 2026-01-15 12:00 UTC, on a minute boundary so the note's minutes name the instant exactly.
const START_MS = Date.UTC(2026, 0, 15, 12, 0)
// Thirty minutes after START_MS falls on START_MS's local date in every zone.
const SOON_MS = START_MS + 30 * MINUTE_MS
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

type World = { dropNext: boolean; skipCompaction: boolean; windows: SessionRateLimit[]; registeredTools: string[] }

/**
 * Stands for the engine: a prompt enters with the context it arrived with, unless `dropNext` is set, a compaction
 * leaves only its summary, unless `skipCompaction` is set, and the usage windows are whatever `windows` holds.
 */
function engine(on: On): World {
  const world: World = { dropNext: false, skipCompaction: false, windows: [], registeredTools: [] }
  on('session.usage', () => ({ value: { startedAt: START_MS, context: { window: 200_000 }, rateLimits: world.windows } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => {
    world.registeredTools.push(e.name)
    return { value: { tool: `mcp__session-context__${e.name}` } }
  })
  on('prompt.submit', (_, e) => {
    if (!world.dropNext) return { text: e.text, context: e.context }
    world.dropNext = false
    return { drop: 'blocked by a settings hook' }
  })
  on('session.compact', () => (world.skipCompaction ? { skip: 'blocked by a PreCompact hook' } : { messages: [SUMMARY_MESSAGE] }))
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

function usageWindow(kind: string, percentUsed: number, resetMs?: number): SessionRateLimit {
  if (resetMs === undefined) return { kind, percentUsed }
  return { kind, percentUsed, resetsAt: new Date(resetMs).toISOString() }
}

/** A reset time as the local clock shows it: 16:00 on the local date of `nowMs`, 01-22 09:00 on any other. */
function resetLabel(resetMs: number, nowMs: number): string {
  const reset = new Date(resetMs)
  const time = reset.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const resetDate = reset.toLocaleDateString('en-CA')
  if (resetDate === new Date(nowMs).toLocaleDateString('en-CA')) return time
  return `${resetDate.slice('YYYY-'.length)} ${time}`
}

/** The first local midnight after `ms`, in the zone the test runs in. */
function nextLocalMidnight(ms: number): number {
  const date = new Date(ms)
  date.setHours(24, 0, 0, 0)
  return date.getTime()
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

test('the first prompt carries the local date and time, and with no usage windows nothing else', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)

  const context = await submit($, clock, 0, USER)

  expect(context).toHaveLength(1)
  const note = parseNote(context?.[0])
  expect(note.instantMs).toBe(START_MS)
  expect(note.rest).toBeUndefined()
})

// Either side of local midnight, so one of the two falls on another UTC date in any zone but UTC.
test('the date and weekday are the local ones on either side of local midnight', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  engine(on)
  const midnightMinute = (nextLocalMidnight(START_MS) - START_MS) / MINUTE_MS

  const beforeMidnight = await submit($, clock, midnightMinute - 30, USER)
  const afterMidnight = await submit($, clock, midnightMinute + 30, USER)

  expect(parseNote(beforeMidnight?.[0]).instantMs).toBe(START_MS + (midnightMinute - 30) * MINUTE_MS)
  expect(parseNote(afterMidnight?.[0]).instantMs).toBe(START_MS + (midnightMinute + 30) * MINUTE_MS)
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
  const fromPeer = await submit($, clock, 20, PEER)
  const fromTask = await submit($, clock, 40, TASK)
  const fromPlugin = await submit($, clock, 60, PLUGIN)
  const context = await submit($, clock, 85, PEER)

  expect(parseNote(fromPeer?.[0]).instantMs).toBe(START_MS + 20 * MINUTE_MS)
  expect(parseNote(fromTask?.[0]).instantMs).toBe(START_MS + 40 * MINUTE_MS)
  expect(parseNote(fromPlugin?.[0]).instantMs).toBe(START_MS + 60 * MINUTE_MS)
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

test('a compaction of a subagent, one computed ahead of time, or one a hook skipped leaves the time where it was', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)

  await submit($, clock, 0, USER)
  await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: [PROMPT_MESSAGE] })
  const afterSubagent = await submit($, clock, 1, USER)
  await $.session.compact({ trigger: 'precompute', messages: [PROMPT_MESSAGE] })
  const afterPrecompute = await submit($, clock, 2, USER)
  world.skipCompaction = true
  await $.session.compact({ trigger: 'manual', messages: [PROMPT_MESSAGE] })
  const afterSkipped = await submit($, clock, 3, USER)

  expect(afterSubagent).toBeUndefined()
  expect(afterPrecompute).toBeUndefined()
  expect(afterSkipped).toBeUndefined()
})

test('a prompt that never entered does not hold back the time from the next one', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)

  world.dropNext = true
  await submit($, clock, 0, USER)
  const context = await submit($, clock, 1, USER)

  expect(parseNote(context?.[0]).rest).toBeUndefined()
})

// Resets either side of local midnight, so one falls on another UTC date than its local one in any zone but UTC.
test('the time line carries each usage window, with its reset time when it has one', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)
  const midnightMs = nextLocalMidnight(START_MS)
  const tomorrowMs = midnightMs + MINUTE_MS
  world.windows = [
    usageWindow('five_hour', 52, midnightMs - MINUTE_MS),
    usageWindow('seven_day', 31.5, tomorrowMs),
    usageWindow('spend_limit', 104),
    usageWindow('example_window', 7),
  ]

  const context = await submit($, clock, 0, USER)

  expect(context).toHaveLength(1)
  const tomorrow = resetLabel(tomorrowMs, START_MS)
  expect(parseNote(context?.[0]).rest).toBe(`Plan usage: 5h 52% (resets 23:59), 1wk 31.5% (resets ${tomorrow}), spend 104%, example_window 7%.`)
})

test('a time line sent before any usage figures comes again once they arrive, and one with figures waits its 15 minutes', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)

  const beforeFigures = await submit($, clock, 0, USER)
  const stillNone = await submit($, clock, 1, USER)
  world.windows = [usageWindow('five_hour', 20, SOON_MS)]
  const figuresArrived = await submit($, clock, 2, USER)
  const afterFigures = await submit($, clock, 3, USER)

  expect(parseNote(beforeFigures?.[0]).rest).toBeUndefined()
  expect(stillNone).toBeUndefined()
  const note = parseNote(figuresArrived?.[0])
  expect(note.instantMs).toBe(START_MS + 2 * MINUTE_MS)
  expect(note.rest).toBe(`The user's previous message was 1 min ago. Plan usage: 5h 20% (resets ${resetLabel(SOON_MS, note.instantMs)}).`)
  expect(afterFigures).toBeUndefined()
})

test('a window passing 90% adds one line to the next prompt that enters, and again only once the reset it showed has passed', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)
  // Inside the 15 minutes, so no time line comes between the readings.
  const resetMs = START_MS + 10 * MINUTE_MS
  const driftedResetMs = resetMs + 5_000
  const nextPeriodMs = resetMs + 5 * 60 * MINUTE_MS

  // The seven-day window is past 90% throughout, so only the time line shows it.
  const weekly = usageWindow('seven_day', 95, nextPeriodMs)

  world.windows = [usageWindow('five_hour', 40, resetMs), weekly]
  await submit($, clock, 0, USER)
  world.windows = [usageWindow('five_hour', 91, resetMs), weekly]
  world.dropNext = true
  await submit($, clock, 1, USER)
  const crossed = await submit($, clock, 2, USER)
  // A reading with no figures, then one of the same period whose reset time is a few seconds off.
  world.windows = []
  await submit($, clock, 3, USER)
  world.windows = [usageWindow('five_hour', 97, driftedResetMs), weekly]
  const samePeriod = await submit($, clock, 4, USER)
  // Idle across the reset: the figures are still the last response's, from the period that ended.
  world.windows = [usageWindow('five_hour', 97, driftedResetMs), weekly]
  const endedPeriod = await submit($, clock, 11, USER)
  world.windows = [usageWindow('five_hour', 92, nextPeriodMs), weekly]
  const nextPeriod = await submit($, clock, 12, USER)

  const startMinute = (minute: number) => START_MS + minute * MINUTE_MS
  expect(crossed).toEqual([`Plan usage passed 90%: 5h 91% (resets ${resetLabel(resetMs, startMinute(2))}).`])
  expect(samePeriod).toBeUndefined()
  expect(endedPeriod).toBeUndefined()
  expect(nextPeriod).toEqual([`Plan usage passed 90%: 5h 92% (resets ${resetLabel(nextPeriodMs, startMinute(12))}).`])
})

test('a window with no reset time warns again only after a reading shows it back under 90%', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)

  world.windows = [usageWindow('spend_limit', 50)]
  await submit($, clock, 0, USER)
  world.windows = [usageWindow('spend_limit', 95)]
  const crossed = await submit($, clock, 1, USER)
  world.windows = []
  await submit($, clock, 2, USER)
  world.windows = [usageWindow('spend_limit', 95)]
  const afterEmpty = await submit($, clock, 3, USER)
  world.windows = [usageWindow('spend_limit', 10)]
  const fellBack = await submit($, clock, 4, USER)
  world.windows = [usageWindow('spend_limit', 90)]
  const crossedAgain = await submit($, clock, 5, USER)

  expect(crossed).toEqual(['Plan usage passed 90%: spend 95%.'])
  expect(afterEmpty).toBeUndefined()
  expect(fellBack).toBeUndefined()
  expect(crossedAgain).toEqual(['Plan usage passed 90%: spend 90%.'])
})

test('a window past 90% on a prompt that carries the time gets no line of its own, then or later', async ($, on) => {
  const clock = mock.clock(on, { now: START_MS })
  const world = engine(on)
  world.windows = [usageWindow('five_hour', 93, SOON_MS)]

  const withTime = await submit($, clock, 0, USER)
  const after = await submit($, clock, 1, USER)

  expect(withTime).toHaveLength(1)
  expect(parseNote(withTime?.[0]).rest).toBe(`Plan usage: 5h 93% (resets ${resetLabel(SOON_MS, START_MS)}).`)
  expect(after).toBeUndefined()
})

test('the tool the session registers answers with the local time and each window, or that there are no figures yet', async ($, on) => {
  mock.clock(on, { now: START_MS })
  const world = engine(on)

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const tool = `mcp__session-context__${world.registeredTools[0]}` as const
  const beforeFigures = await $.tool.call({ tool, tool_use_id: 'toolu_01' })
  world.windows = [usageWindow('five_hour', 52, SOON_MS)]
  const call = await $.tool.call({ tool, tool_use_id: 'toolu_02' })

  expect(world.registeredTools).toHaveLength(1)
  expect(beforeFigures.result).toBe(
    'No plan usage figures: they arrive with the first model response, and an account off a subscription has none.',
  )
  const report = parseNote(String(call.result))
  expect(report.instantMs).toBe(START_MS)
  expect(report.rest).toBe(`Plan usage: 5h 52% (resets ${resetLabel(SOON_MS, START_MS)}).`)
})
