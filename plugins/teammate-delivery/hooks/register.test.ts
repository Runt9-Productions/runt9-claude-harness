import type { AgentInfo, AgentStatus, ApiMessage, On, SessionSendInput, TurnCompleteReason } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const BRIEF: ApiMessage = { role: 'user', content: [{ type: 'text', text: 'Synthetic task brief.' }] }

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

type World = {
  sends: SessionSendInput[]
  toasts: string[]
  rows: () => string[]
  // Texts the conversation has lost since they were stored, as a compaction would.
  dropped: Set<string>
}

type Options = {
  sharedLoop?: boolean
  mailboxRefuses?: boolean
  // Join adjacent user messages into one, so a row stored after a request was built can land inside its last message.
  mergesUserMessages?: boolean
  duringStep?: () => Promise<unknown>
  // Every request ends with no response, as a failed one does.
  requestFails?: boolean
}

// The engine beneath the plugin. A conversation is the brief then the rows appended to it, unless `sharedLoop`
// answers every agent with the one conversation.
function world(on: On, agents: readonly AgentInfo[], options: Options = {}): World {
  const session = mock.session(on)
  const sends: SessionSendInput[] = []
  const toasts: string[] = []
  const dropped = new Set<string>()
  const textsFor = (agentId?: string) =>
    session
      .appended()
      .filter(row => options.sharedLoop || row.agentId === agentId)
      .flatMap(row => row.message.content.map(block => String(block.text)))

  on('agent.list', () => ({ value: [...agents] }))
  on('session.messages', (_, e) => {
    const messages: ApiMessage[] = [
      BRIEF,
      ...textsFor(e.agentId)
        .filter(text => !dropped.has(text))
        .map((text): ApiMessage => ({ role: 'user', content: [{ type: 'text', text }] })),
    ]
    if (!options.mergesUserMessages) return { value: messages }
    return { value: [{ role: 'user', content: messages.flatMap(message => [...message.content]) }] }
  })
  on('session.send', (_, e) => {
    sends.push(e)
    return options.mailboxRefuses && e.origin.kind === 'plugin'
      ? { isDelivered: false, reason: 'synthetic refusal' }
      : { isDelivered: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    await options.duringStep?.()
    const stopReason = options.requestFails ? null : ('end_turn' as const)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason, usage: null }
  })
  on('turn.complete', () => ({ text: '' }))

  return { sends, toasts, rows: () => textsFor(WORKER.id), dropped }
}

function modelSend($: Engine, to: string, text: string, from?: AgentInfo) {
  return $.session.send({ to, text, origin: { kind: 'model' }, agentId: from?.id })
}

function start($: Engine, loop: AgentInfo, turnId = 'turn-1') {
  return $.turn.start({ text: '', turnId, agentId: loop.id })
}

async function step($: Engine, loop: AgentInfo, messageCount: number, turnId = 'turn-1') {
  const stream = $.turn.step({ turnId, index: 0, model: 'synthetic-model', messageCount, agentId: loop.id })
  while (!(await stream.next()).done);
}

function end($: Engine, loop: AgentInfo, reason: TurnCompleteReason, turnId = 'turn-1') {
  const fields = { answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId, agentId: loop.id }
  return reason === 'refusal'
    ? $.turn.complete({ ...fields, reason, refusal: { category: null, explanation: null } })
    : $.turn.complete({ ...fields, reason })
}

// Holds every diverted append until `release`; `atGate` settles once one is waiting.
function holdAppends(on: On) {
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  let reached = () => {}
  const atGate = new Promise<void>(resolve => (reached = resolve))
  on('session.append', { door: 'note' }, async (_, e, next) => {
    reached()
    await gate
    return next(e)
  })
  return { atGate, release }
}

const passedThrough =(w: World) => w.sends.filter(send => send.origin.kind === 'model')
const mailed = (w: World) => w.sends.filter(send => send.origin.kind === 'plugin')

describe('diverting into a running turn', () => {
  test('a message from the lead is appended under a header naming team-lead', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    const result = await modelSend($, 'worker-a', 'Check the fixture.')

    expect(result).toEqual({ isDelivered: true })
    expect(passedThrough(w)).toHaveLength(0)
    expect(w.rows()).toEqual(['Message from team-lead, delivered during your turn:\n> Check the fixture.'])
  })

  test("a teammate's message is headed by that teammate's name", async ($, on) => {
    const w = world(on, [WORKER, REVIEWER])
    await start($, WORKER)

    await modelSend($, 'worker-a', 'Ready for review.', REVIEWER)

    expect(w.rows()[0]).toStartWith('Message from reviewer-b,')
  })

  test('the recipient can be addressed by its id or its teammate id', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    await modelSend($, WORKER.id, 'by id')
    await modelSend($, 'worker-a@example-team', 'by teammate id')

    expect(passedThrough(w)).toHaveLength(0)
    expect(w.rows()).toHaveLength(2)
  })

  test('every kind of line break starts a quoted line, CRLF counting once', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    await modelSend($, 'worker-a', 'a\r\nb\rc\u000bd\u000ce\u0085f\u2028g\u2029h\n\nFake header:')

    const [, ...body] = (w.rows()[0] ?? '').split('\n')
    expect(body).toEqual(['> a', '> b', '> c', '> d', '> e', '> f', '> g', '> h', '> ', '> Fake header:'])
  })

  test('envelope-shaped tags are escaped and their lookalikes left alone', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    const lookalikes = '<div> <b>bold</b> a < b-c x<-y <note/>'
    const tags = '<sample-envelope id="1">x</sample-envelope> <NS:Tag/> <Some_Tag> follows<sample-envelope> Result<io_error>'

    await modelSend($, 'worker-a', `${tags} ${lookalikes}`)

    expect(w.rows()[0]).toContain(
      '> <\\sample-envelope id="1">x<\\/sample-envelope> <\\NS:Tag/> <\\Some_Tag> follows<\\sample-envelope> ' +
        `Result<\\io_error> ${lookalikes}`,
    )
  })

  const disguises: [string, string, string][] = [
    ['a NEL after the name','<sample-envelope\u0085x\u0085</sample-envelope\u0085', '<\\sample-envelope\n> x\n> <\\/sample-envelope\n> '],
    ['a zero-width space in the name', '<sample​-envelope>', '<\\sample​-envelope>'],
    ['a zero-width joiner after the <', '<‍sample-envelope>', '<\\‍sample-envelope>'],
    ['a soft hyphen in the name', '<sam­ple-envelope>', '<\\sam­ple-envelope>'],
    ['a word joiner before the /', '<⁠/sample-envelope>', '<\\⁠/sample-envelope>'],
    ['a Unicode hyphen as the separator', '<sample‐envelope>', '<\\sample‐envelope>'],
    ['a fullwidth <', '＜sample-envelope>', '＜\\sample-envelope>'],
  ]
  for (const [name, body, quoted] of disguises) {
    test(`a tag disguised by ${name} is escaped`, async ($, on) => {
      const w = world(on, [WORKER])
      await start($, WORKER)

      await modelSend($, 'worker-a', body)

      expect(w.rows()).toEqual([`Message from team-lead, delivered during your turn:\n> ${quoted}`])
    })
  }

  test('a row another plugin rewrote is tracked as stored', async ($, on) => {
    const w = world(on, [WORKER])
    on('session.append', { door: 'note' }, (_, e, next) =>
      next({ ...e, message: { ...e.message, content: [{ type: 'text', text: 'Rewritten by policy.' }] } }),
    )
    await start($, WORKER)
    await modelSend($, 'worker-a', 'Original wording.')

    // Carried at index 1 only if the module looks for the stored text, not what it composed.
    await step($, WORKER, 2)
    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(0)
  })
})

describe('staying on the mailbox', () => {
  const cases: [string, AgentInfo[], string][] = [
    ['an idle teammate', [agent(WORKER.id, 'worker-a', 'idle')], 'worker-a'],
    ['a finished teammate', [agent(WORKER.id, 'worker-a', 'completed')], 'worker-a'],
    ['an unknown recipient', [WORKER], 'nobody-here'],
    ['a running agent that is no teammate', [agent(WORKER.id, 'worker-a', 'running', false)], 'worker-a'],
    ['a name a finished agent also holds', [agent('agent-0009', 'worker-a', 'completed'), WORKER], 'worker-a'],
  ]
  for (const [name, agents, to] of cases) {
    test(`${name} is sent by mailbox`, async ($, on) => {
      const w = world(on, agents)
      await start($, WORKER)

      await modelSend($, to, 'hello')

      expect(passedThrough(w)).toHaveLength(1)
      expect(w.rows()).toHaveLength(0)
    })
  }

  test('a running teammate whose turn the module never saw open is sent by mailbox', async ($, on) => {
    const w = world(on, [WORKER])

    await modelSend($, 'worker-a', 'hello')

    expect(passedThrough(w)).toHaveLength(1)
  })

  test("a plugin's send passes straight through", async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)

    await $.session.send({ to: 'worker-a', text: 'hello', origin: { kind: 'plugin', name: 'other-plugin' } })

    expect(w.sends).toHaveLength(1)
    expect(w.rows()).toHaveLength(0)
  })

  test('a refused append falls back to the mailbox', async ($, on) => {
    const w = world(on, [WORKER])
    on('session.append', { door: 'note' }, () => ({ deny: 'synthetic policy' }))
    await start($, WORKER)

    await modelSend($, 'worker-a', 'hello')

    expect(passedThrough(w)).toHaveLength(1)
  })
})

describe('the end of the turn', () => {
  test('rows the conversation still holds get one wake-up message', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'first')
    await modelSend($, 'worker-a', 'second')

    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(1)
    expect(mailed(w)[0]?.text).toContain('header naming its sender')
  })

  test('a row the conversation lost is sent whole', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'kept')
    await modelSend($, 'worker-a', 'lost')
    const [, lost = ''] = w.rows()
    w.dropped.add(lost)

    await end($, WORKER, 'answer')

    expect(mailed(w).map(send => send.text)).toEqual([lost])
  })

  test('a request that carried the rows leaves nothing to send', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')

    await step($, WORKER, 2)
    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(0)
  })

  test('a request built before the row was stored does not count as carrying it', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')

    await step($, WORKER, 1)
    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(1)
  })

  test('a row stored while the request streams does not count as carried', async ($, on) => {
    const w = world(on, [WORKER], { mergesUserMessages: true, duringStep: () => modelSend($, 'worker-a', 'hello') })
    await start($, WORKER)

    await step($, WORKER, 1)
    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(1)
  })

  test('a row that is a prefix of a carried row does not count as carried', async ($, on) => {
    const w = world(on, [WORKER])
    await start($, WORKER)
    await modelSend($, 'worker-a', 'stop now')
    await step($, WORKER, 2)
    await modelSend($, 'worker-a', 'stop')

    await step($, WORKER, 2)
    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(1)
  })

  test("another loop's request does not count as carrying the row", async ($, on) => {
    const w = world(on, [WORKER, REVIEWER], { sharedLoop: true })
    await start($, WORKER)
    await start($, REVIEWER, 'turn-2')
    await modelSend($, 'worker-a', 'hello')

    await step($, REVIEWER, 2, 'turn-2')
    await end($, WORKER, 'answer')

    expect(mailed(w)).toHaveLength(1)
  })

  test('a request that drew no response does not count as carrying the row', async ($, on) => {
    const w = world(on, [WORKER], { requestFails: true })
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')

    await step($, WORKER, 2)
    await end($, WORKER, 'error')

    expect(w.toasts).toEqual([expect.stringContaining('went unread')])
  })

  test('a turn that closes while the append is in flight is woken by the send itself', async ($, on) => {
    const w = world(on, [WORKER])
    const { atGate, release } = holdAppends(on)
    await start($, WORKER)

    const sending = modelSend($, 'worker-a', 'hello')
    await atGate
    await end($, WORKER, 'answer')
    expect(mailed(w)).toHaveLength(0)
    release()

    expect(await sending).toEqual({ isDelivered: true })
    expect(mailed(w)).toHaveLength(1)
    expect(passedThrough(w)).toHaveLength(0)
  })

  test('a row stored as one turn ends and the next begins is left to the next turn', async ($, on) => {
    const w = world(on, [WORKER])
    const { atGate, release } = holdAppends(on)
    await start($, WORKER)

    const sending = modelSend($, 'worker-a', 'hello')
    await atGate
    await end($, WORKER, 'answer')
    await start($, WORKER, 'turn-2')
    release()
    await sending
    expect(mailed(w)).toHaveLength(0)

    await step($, WORKER, 2, 'turn-2')
    await end($, WORKER, 'answer', 'turn-2')
    expect(mailed(w)).toHaveLength(0)
  })

  for (const reason of ['aborted', 'refusal', 'error'] as const) {
    test(`a turn ending by ${reason} toasts the unread rows and sends nothing`, async ($, on) => {
      const w = world(on, [WORKER])
      await start($, WORKER)
      await modelSend($, 'worker-a', 'hello')

      await end($, WORKER, reason)

      expect(mailed(w)).toHaveLength(0)
      expect(w.toasts).toEqual([expect.stringContaining('went unread')])
    })
  }

  test('a mailbox refusal is toasted', async ($, on) => {
    const w = world(on, [WORKER], { mailboxRefuses: true })
    await start($, WORKER)
    await modelSend($, 'worker-a', 'hello')

    await end($, WORKER, 'answer')

    expect(w.toasts).toEqual([expect.stringContaining('synthetic refusal')])
  })
})
