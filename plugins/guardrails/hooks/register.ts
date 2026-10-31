import { atom, read, update } from 'claude-code'
import type { ModelCompleteResult, PromptOrigin, Register, SessionMessage } from 'claude-code'

import type { OwnerMessage } from '../types'
import { OWNER_MESSAGES_KEPT, isCandidate, judgeRequest, judgedCall, verdictOf } from './judge'
import type { Verdict } from './judge'

// Change the tag when an entry's shape changes: it declines what an earlier version stored, which outlives a reload.
const ownerMessages = atom({ plugin: 'guardrails', key: 'ownerMessages' } as const, [], { shape: 'owner-messages-1' })

// Prompts whose text the owner typed; `sdk` is the prompt of a `claude -p` run.
const OWNER_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge', 'sdk'])

const ASK_THE_OWNER = 'If this call is needed, stop and ask the owner.'

function hasText(message: SessionMessage): boolean {
  return message.role === 'assistant' && message.text !== ''
}

function failureOf(reply: ModelCompleteResult): string {
  if (reply.isAnswered) return `the judge's reply held no verdict: ${JSON.stringify(reply.text.slice(0, 200))}`
  if (reply.reason === 'api-error') return `the judge's request failed (${reply.error}, status ${reply.status ?? 'none'})`
  return `the judge gave no answer (${reply.reason})`
}

function denial(verdict: Verdict | undefined, reply: ModelCompleteResult): string {
  if (verdict !== undefined) return `guardrails: ${verdict.reason}`
  return `guardrails: refused because ${failureOf(reply)}. ${ASK_THE_OWNER}`
}

export const register: Register = (on, options) => {
  const model = options.model
  if (typeof model !== 'string') throw new Error(`guardrails: option "model" is ${JSON.stringify(model)}, not a model name`)

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta === true || !OWNER_ORIGINS.has(e.origin.kind)) return next(e)
    const conversation = await $.session.messages()
    const message: OwnerMessage = { text: e.text, replyingTo: conversation.findLast(hasText)?.text }
    await update($, ownerMessages, messages => [...messages, message].slice(-OWNER_MESSAGES_KEPT))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Another plugin's own call is that plugin's code, not the model's choice.
    if (next.origin.plugin !== 'engine') return next(e)
    if (!isCandidate(e)) return next(e)

    const request = judgeRequest(judgedCall(e), await read($, ownerMessages), model)
    const startedAt = await $.clock.now()
    const reply = await $.model.complete(request)
    const elapsedMs = (await $.clock.now()) - startedAt
    const verdict = reply.isAnswered ? verdictOf(reply.text) : undefined
    const usage = reply.usage

    const outcome = verdict?.isAllowed === true ? 'allow' : 'deny'
    $.ui.log(
      `guardrails: ${outcome} ${e.tool} agent=${e.agentId ?? 'main'} ms=${elapsedMs} in=${usage.input_tokens} ` +
        `out=${usage.output_tokens} cacheRead=${usage.cache_read_input_tokens} cacheWrite=${usage.cache_creation_input_tokens} ` +
        `reply=${JSON.stringify(reply.isAnswered ? reply.text : reply.reason)}`,
      { to: 'debug' },
    )

    if (verdict?.isAllowed === true) return next(e)
    return { deny: denial(verdict, reply) }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `guardrails: refused because the judge failed. ${ASK_THE_OWNER}` }))
}
