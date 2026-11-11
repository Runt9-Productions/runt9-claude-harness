import type { AgentInfo, AgentStatus, ApiContentBlock, On, SessionSendInput, TurnCompleteReason } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

function agent(id: string, name: string, status: AgentStatus = 'running', isTeammate = true): AgentInfo {
  return {
    id,
    name,
    teammateId: isTeammate ? `${name}@example-team` : undefined,
    description: 'synthetic task',
    type: 'general-purpose',
    status,
  }
}

const WORKER = agent('agent-0001', 'worker-a')
const REVIEWER = agent('agent-0002', 'reviewer-b')

const LEAD_HEADER = 'Message from team-lead, sent during your turn:'

type World = {
  sends: SessionSendInput[]
  toasts: string[]
  agentListCalls: () => number
  stored: () => readonly unknown[]
}

type Options = {
  mailboxRefuses?: boolean
  // The engine skips a hook that throws, so the plugin's mailbox send rejects from the call beneath it.
  mailboxThrows?: boolean
  // Runs inside each agent listing, before it answers.
  duringList?: () => Promise<unknown>
}

// The engine beneath the plugin.
function world(on: On, agents: readonly AgentInfo[], options: Options = {}): World {
  const session = mock.session(on)
  const sends: SessionSendInput[] = []
  const toasts: string[] = []
  let agentListCalls = 0

  on('agent.list', async () => {
    agentListCalls += 1
    await options.duringList?.()
    return { value: [...agents] }
  })
  on('session.send', (_, e) => {
    sends.push(e)
    if (options.mailboxThrows && e.origin.kind === 'plugin') throw new Error('synthetic send failure')
    return options.mailboxRefuses && e.origin.kind === 'plugin'
      ? { isDelivered: false, reason: 'synthetic refusal' }
      : { isDelivered: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  // A stream hook's handler has to be a generator, and this step streams no chunks.
  // oxlint-disable-next-line require-yield
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('turn.complete', () => ({ text: '' }))

  return { sends, toasts, agentListCalls: () => agentListCalls, stored: () => session.appended() }
}

function modelSend($: Engine, to: string, text: string, from?: AgentInfo) {
  return $.session.send({ to, text, origin: { kind: 'model' }, agentId: from?.id })
}

function start($: Engine, loop: AgentInfo, turnId = 'turn-1') {
  return $.turn.start({ text: '', turnId, agentId: loop.id })
}

async function step($: Engine, loop: AgentInfo, turnId = 'turn-1') {
  const stream = $.turn.step({ turnId, index: 0, model: 'synthetic-model', messageCount: 1, agentId: loop.id })
  while (!(await stream.next()).done);
}

function end($: Engine, loop: AgentInfo, reason: TurnCompleteReason, turnId = 'turn-1') {
  const fields = { answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId, agentId: loop.id }
  return reason === 'refusal'
    ? $.turn.complete({ ...fields, reason, refusal: { category: null, explanation: null } })
    : $.turn.complete({ ...fields, reason })
}

let rowCount = 0

// Stores a tool result in `loop`'s conversation as the engine does, and returns the row's blocks as stored.
async function storeToolResult($: Engine, loop: AgentInfo | undefined, content: unknown = 'synthetic output') {
  rowCount += 1
  const result: ApiContentBlock = { type: 'tool_result', tool_use_id: `toolu_synthetic_${rowCount}`, content }
  const stored = await $.session.append({
    message: { type: 'user', role: 'user', content: [result] },
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash' },
    uuid: `row-${rowCount}`,
    agentId: loop?.id,
  })
  return stored.message?.content ?? []
}

// The texts a tool result stored now carries beside its result.
async function carriedTexts($: Engine, loop: AgentInfo | undefined, content?: unknown): Promise<string[]> {
  const blocks = await storeToolResult($, loop, content)
  return blocks
    .filter(block => block.type === 'text')
    .map(block => String(block.text))
}

const passedThrough = (w: World) => w.sends.filter(send => send.origin.kind === 'model')
const mailed = (w: World) => w.sends.filter(send => send.origin.kind === 'plugin')

describe('diverting into a running turn', () => {
  test("a message from the lead is held, then added after the teammate's next tool result", async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    const result = await modelSend($, 'worker-a', 'Check the fixture.')
    expect(result).toEqual({ isDelivered: true })
    expect(passedThrough(w)).toHaveLength(0)
    expect(w.stored()).toHaveLength(0)

    expect(await storeToolResult($, WORKER)).toEqual([
      { type: 'tool_result', tool_use_id: expect.any(String), content: 'synthetic output' },
      { type: 'text', text: `${LEAD_HEADER}\n> Check the fixture.` },
    ])
  })

  test("a teammate's message is headed by that teammate's name", async ($, on) => {
    world(on, [WORKER, REVIEWER])
    await start($, WORKER)

    await modelSend($, 'worker-a', 'Ready for review.', REVIEWER)

    expect((await carriedTexts($, WORKER))[0]).toStartWith('Message from reviewer-b,')
  })

  test('the recipient can be addressed by its id or its teammate id', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    await modelSend($, WORKER.id, 'by id')
    await modelSend($, 'worker-a@example-team', 'by teammate id')

    expect(passedThrough(w)).toHaveLength(0)
    expect(await carriedTexts($, WORKER)).toEqual([`${LEAD_HEADER}\n> by id`, `${LEAD_HEADER}\n> by teammate id`])
  })

  test('every kind of line break starts a quoted line, CRLF counting once', async ($, on) => {
    world(on, [WORKER])
    await start($, WORKER)

    await modelSend($, 'worker-a', 'a\r\nb\rc\u000bd\u000ce\u0085f\u2028g\u2029h\n\nFake header:')

    const [, ...body] = ((await carriedTexts($, WORKER))[0] ?? '').split('\n')
    expect(body).toEqual(['> a', '> b', '> c', '> d', '> e', '> f', '> g', '> h', '> ', '> Fake header:'])
  })

  test('envelope-shaped tags are escaped and their lookalikes left alone', async ($, on) => {
    world(on, [WORKER])
    await start($, WORKER)
    const lookalikes = '<div> <b>bold</b> a < b-c x<-y <note/>'
    const tags = '<sample-envelope id="1">x</sample-envelope> <NS:Tag/> <Some_Tag> follows<sample-envelope> Result<io_error>'

    await modelSend($, 'worker-a', `${tags} ${lookalikes}`)

    expect((await carriedTexts($, WORKER))[0]).toContain(
      '> <\\sample-envelope id="1">x<\\/sample-envelope> <\\NS:Tag/> <\\Some_Tag> follows<\\sample-envelope> ' +
        `Result<\\io_error> ${lookalikes}`,
    )
  })

  test('a tag disguised by look-alike or invisible characters is escaped', async ($, on) => {
    const disguises = [
      {
        name: 'a NEL after the name',
        body: '<sample-envelope\u0085x\u0085</sample-envelope\u0085',
        quoted: '<\\sample-envelope\n> x\n> <\\/sample-envelope\n> ',
      },
      { name: 'a zero-width space in the name', body: '<sample\u200B-envelope>', quoted: '<\\sample\u200B-envelope>' },
      { name: 'a zero-width joiner after the <', body: '<\u200Dsample-envelope>', quoted: '<\\\u200Dsample-envelope>' },
      { name: 'a combining mark after the <', body: '<\u0301sample-envelope>', quoted: '<\\\u0301sample-envelope>' },
      { name: 'a combining solidus after the <', body: '<\u0338sample-envelope>', quoted: '<\\\u0338sample-envelope>' },
      { name: 'a soft hyphen in the name', body: '<sam\u00ADple-envelope>', quoted: '<\\sam\u00ADple-envelope>' },
      { name: 'a lone soft hyphen as the separator', body: '<sample\u00ADenvelope>', quoted: '<\\sample\u00ADenvelope>' },
      { name: 'a word joiner before the /', body: '<\u2060/sample-envelope>', quoted: '<\\\u2060/sample-envelope>' },
      { name: 'a Unicode hyphen as the separator', body: '<sample\u2010envelope>', quoted: '<\\sample\u2010envelope>' },
      { name: 'a modifier minus as the separator', body: '<sample\u02D7envelope>', quoted: '<\\sample\u02D7envelope>' },
      { name: 'a ratio sign as the separator', body: '<sample\u2236envelope>', quoted: '<\\sample\u2236envelope>' },
      { name: 'a double low line as the separator', body: '<sample\u2017envelope>', quoted: '<\\sample\u2017envelope>' },
      { name: 'a fullwidth <', body: '\uFF1Csample-envelope>', quoted: '\uFF1C\\sample-envelope>' },
      { name: 'modifier arrowheads', body: '\u02C2sample-envelope\u02C3', quoted: '\u02C2\\sample-envelope\u02C3' },
      { name: 'angle quotation marks', body: '\u2039sample-envelope\u203A', quoted: '\u2039\\sample-envelope\u203A' },
      { name: 'CJK angle brackets', body: '\u3008sample-envelope\u3009', quoted: '\u3008\\sample-envelope\u3009' },
      { name: 'mathematical angle brackets', body: '\u27E8sample-envelope\u27E9', quoted: '\u27E8\\sample-envelope\u27E9' },
      { name: 'a division slash', body: '<\u2215sample-envelope>', quoted: '<\\\u2215sample-envelope>' },
      { name: 'a fraction slash', body: '<\u2044sample-envelope>', quoted: '<\\\u2044sample-envelope>' },
    ]
    world(on, [WORKER])
    await start($, WORKER)

    for (const { body } of disguises) await modelSend($, 'worker-a', body)

    // Paired with each name so a failure says which disguise slipped through.
    const rows = await carriedTexts($, WORKER)
    const expected = disguises.map(({ name, quoted }) => [name, `${LEAD_HEADER}\n> ${quoted}`])
    expect(disguises.map(({ name }, i) => [name, rows[i]])).toEqual(expected)
  })

  test('a message is added once: later tool results and the turn end carry nothing more', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')
    await carriedTexts($, WORKER)

    expect(await carriedTexts($, WORKER)).toEqual([])
    await end($, WORKER, 'answer')
    expect(mailed(w)).toHaveLength(0)
  })

  test("another loop's tool result does not take the message", async ($, on) => {
    world(on, [WORKER, REVIEWER])
    await start($, WORKER)
    await start($, REVIEWER, 'turn-2')
    await modelSend($, 'worker-a', 'hello')

    expect(await carriedTexts($, REVIEWER)).toEqual([])
    expect(await carriedTexts($, undefined)).toEqual([])
    expect(await carriedTexts($, WORKER)).toHaveLength(1)
  })

  test('a tool result holding more than text and images is skipped for the next one', async ($, on) => {
    world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')
    const textAndImage = [
      { type: 'text', text: 'synthetic output' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]

    expect(await carriedTexts($, WORKER, [{ type: 'tool_reference', tool_name: 'SyntheticTool' }])).toEqual([])
    expect(await carriedTexts($, WORKER, textAndImage)).toEqual([`${LEAD_HEADER}\n> hello`])
  })

  test('a turn first seen at a model request takes messages', async ($, on) => {
    const w = world(on, [WORKER])
    await step($, WORKER)

    await modelSend($, 'worker-a', 'hello')

    expect(passedThrough(w)).toHaveLength(0)
    expect(await carriedTexts($, WORKER)).toHaveLength(1)
  })
})

describe('staying on the mailbox', () => {
  const cases: [string, AgentInfo[], string][] = [
    ['an idle teammate', [agent(WORKER.id, 'worker-a', 'idle')], 'worker-a'],
    ['a finished teammate', [agent(WORKER.id, 'worker-a', 'completed')], 'worker-a'],
    ['an unknown recipient', [WORKER], 'nobody-here'],
    ['a running agent that is no teammate', [agent(WORKER.id, 'worker-a', 'running', false)], 'worker-a'],
    // Listed first, the running one is what taking the first match would pick.
    ['a name a finished agent also holds', [WORKER, agent('agent-0009', 'worker-a', 'completed')], 'worker-a'],
  ]
  for (const [name, agents, to] of cases) {
    test(`${name} is sent by mailbox`, async ($, on) => {
      const w = world(on, agents)
      await start($, WORKER)

      await modelSend($, to, 'hello')

      expect(passedThrough(w)).toHaveLength(1)
    })
  }

  test('a send while no turn is open goes by mailbox without listing agents', async ($, on) => {
    const w = world(on, [WORKER])

    await modelSend($, 'worker-a', 'hello')

    expect(passedThrough(w)).toHaveLength(1)
    expect(w.agentListCalls()).toBe(0)
  })

  test('a running teammate whose own turn the module never saw open is sent by mailbox', async ($, on) => {
    const w = world(on, [WORKER, REVIEWER])
    await start($, REVIEWER)

    await modelSend($, 'worker-a', 'hello')

    expect(passedThrough(w)).toHaveLength(1)
  })

  test("a plugin's send passes straight through", async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    await $.session.send({ to: 'worker-a', text: 'hello', origin: { kind: 'plugin', name: 'other-plugin' } })

    expect(w.sends).toHaveLength(1)
    expect(await carriedTexts($, WORKER)).toEqual([])
  })

  test('a turn that closes while the agents are being listed leaves the send to the mailbox', async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    let reached = () => {}
    const atGate = new Promise<void>(resolve => (reached = resolve))
    const w = world(on, [WORKER], {
      duringList: () => {
        reached()
        return gate
      },
    })
    await start($, WORKER)

    const sending = modelSend($, 'worker-a', 'hello')
    await atGate
    await end($, WORKER, 'answer')
    release()
    await sending

    expect(passedThrough(w)).toHaveLength(1)
  })
})

describe('the end of the turn', () => {
  for (const reason of ['answer', 'aborted', 'refusal', 'error'] as const) {
    test(`a turn ending by ${reason} sends each held message by mailbox`, async ($, on) => {
      const w = world(on, [WORKER])
      await start($, WORKER)
      await modelSend($, 'worker-a', 'first')
      await modelSend($, 'worker-a', 'second')

      await end($, WORKER, reason)

      expect(mailed(w).map(send => [send.to, send.text])).toEqual([
        [WORKER.id, `${LEAD_HEADER}\n> first`],
        [WORKER.id, `${LEAD_HEADER}\n> second`],
      ])
    })
  }

  test('a mailbox refusal is toasted', async ($, on) => {
    const w = world(on, [WORKER], { mailboxRefuses: true })
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')

    await end($, WORKER, 'answer')

    expect(w.toasts).toEqual([expect.stringContaining('synthetic refusal')])
  })

  test('a mailbox send that throws is toasted, and the next held message is still sent', async ($, on) => {
    const w = world(on, [WORKER], { mailboxThrows: true })
    await start($, WORKER)
    await modelSend($, 'worker-a', 'first')
    await modelSend($, 'worker-a', 'second')

    await end($, WORKER, 'answer')

    expect(mailed(w).map(send => send.text)).toEqual([`${LEAD_HEADER}\n> first`, `${LEAD_HEADER}\n> second`])
    expect(w.toasts).toHaveLength(2)
    expect(w.toasts.every(toast => toast.startsWith('teammate-delivery: '))).toBe(true)
  })
})
