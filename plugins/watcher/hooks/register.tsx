import type { Register } from 'claude-code'

import { captureCall, captureRow, isCommitOrPush, noteDenial, noteVerdict, takeDenial } from './capture'
import { loadChecks } from './checks'
import { noteMainTurn, readBoardAnswers } from './deliver'
import { judgeAt, judgeIdleTeammate } from './judge'
import { noteCleared, pruneEntries } from './shared'

const COMPACT_BOUNDARY = 'compact_boundary'

export const register: Register = on => {
  // Read at the start, so a bad check file is reported before the first judgment needs the checks.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await loadChecks($)
    await pruneEntries($)
    return result
  })

  // A `/clear` goes on in this process under a new id, with no session.start for it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') noteCleared(e.sessionId)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    await captureRow($, e)
    if (e.message.name === COMPACT_BOUNDARY) await judgeAt($, e.agentId, 'compaction')
    return stored
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (next.origin.plugin === 'engine') noteVerdict(e.tool_use_id, verdict)
    return verdict
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    noteDenial(e.tool_use_id)
    return next(e)
  })

  // Another plugin's own call is not the agent's work.
  on('tool.call', async ($, e, next) => {
    if (next.origin.plugin !== 'engine') return next(e)
    const result = await next(e)
    const secretCall = await captureCall($, e, result)
    // Judged on the matched call alone, which keeps the call small.
    if (secretCall !== undefined) await judgeAt($, e.agentId, 'secret-match', [secretCall])
    if (isCommitOrPush(e, result)) await judgeAt($, e.agentId, 'commit')
    if (takeDenial(e.tool_use_id)) await judgeAt($, e.agentId, 'refusal')
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await noteMainTurn($, true)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await noteMainTurn($, false)
    await judgeAt($, e.agentId, 'turn-end')
    return result
  })

  // Board retries a write that lost a race, so only a write that landed is read.
  on('state.set', { plugin: 'board', key: 'decisions' }, async ($, e, next) => {
    const written = await next(e)
    if (written.value?.isSet) await readBoardAnswers($, e.previous ?? [], e.value)
    return written
  })

  on('classic.TeammateIdle', async ($, e, next) => {
    const result = await next(e)
    await judgeIdleTeammate($, e.agent_id, e.teammate_name)
    return result
  })
}
