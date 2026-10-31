import { atom, read, update } from 'claude-code'
import type { ClassicHookInputs, ClassicResultOf, EngineInterface, ToolCallResult } from 'claude-code'

const postedRefusals = atom({ plugin: 'away', key: 'postedRefusals' } as const, {})
const postedDenials = atom({ plugin: 'away', key: 'postedDenials' } as const, [])

// How ask_decision's answer starts, which board's README, "The away plugin", keeps stable.
const POSTED_ID = /^Posted (D\d+)/

const BRACKETED = /\[[^\]]+\]/

const MAX_INPUT_CHARS = 300

const MAX_REASON_CHARS = 150

type DecisionOption = { label: string; description?: string }

type Decision = { question: string; context?: string; options: DecisionOption[] }

/** What a post to the board came to: the decision's id, or why it failed. */
type Posting = { id: string } | { failure: string }

type PermissionRequest = ClassicHookInputs['PermissionRequest']

type PermissionDenied = ClassicHookInputs['PermissionDenied']

// Each post is itself a board tool call, so posting a refused board call would recurse.
export const isBoardTool = (tool: string) => tool.startsWith('mcp__board__')

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)

const describeInput = (input: unknown) => cut(JSON.stringify(input) ?? '', MAX_INPUT_CHARS)

async function loopName($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return 'Claude'
  const agents = await $.agent.list()
  const agent = agents.find(listed => listed.id === agentId)
  return agent?.name ?? agent?.type ?? 'a subagent'
}

// The engine's types say `text` is absent on a hook's own `{ result }`, which is how board answers.
function answerText(result: ToolCallResult): string {
  if (result.text !== undefined) return result.text
  return typeof result.result === 'string' ? result.result : ''
}

/** Posts a decision to the board as away's own call, whose answer board delivers to the main session. */
async function postDecision($: EngineInterface, decision: Decision): Promise<Posting> {
  let result: ToolCallResult
  try {
    result = await $.tool.call({ tool: 'mcp__board__ask_decision', ...decision })
  } catch (err) {
    return { failure: String(err) }
  }
  if (result.deny !== undefined) return { failure: result.deny }
  const text = answerText(result)
  if (result.isError === true) return { failure: text }
  // The rest of the board's answer is written for the loop that asked, which here is nobody.
  const id = POSTED_ID.exec(text)?.[1]
  if (id === undefined) return { failure: `the board answered "${text}"` }
  return { id }
}

const QUESTION_REFUSED = [
  '[away: refused] Nobody is at the computer to answer AskUserQuestion, so it was refused. Post each question as a',
  'board decision (mcp__board__ask_decision) instead, with the option you would take as the recommended one, and when',
  'that option can be undone, proceed on it without waiting for the answer.',
].join(' ')

/**
 * Refuses a permission prompt nobody is there to answer and posts it to the board. Only ever a deny, so what runs
 * unattended never widens.
 */
export async function refuse($: EngineInterface, e: PermissionRequest): Promise<ClassicResultOf['classic.PermissionRequest']> {
  // The question is itself what the owner would answer, so a post saying it was refused would ask nothing.
  if (e.tool_name === 'AskUserQuestion') return { decision: { behavior: 'deny', message: QUESTION_REFUSED } }
  const parts = ['[away: refused] Nobody is at the computer to answer this permission prompt, so it was refused.']
  if (!isBoardTool(e.tool_name)) parts.push(await postRefusal($, e))
  parts.push('Meanwhile, go on with work that does not need it.')
  return { decision: { behavior: 'deny', message: parts.join(' ') } }
}

/**
 * What the refused loop is told about the post. The same call refused again in the same loop names the decision
 * already posted, since a model retrying it would fill the board with copies.
 */
async function postRefusal($: EngineInterface, e: PermissionRequest): Promise<string> {
  const refusal = JSON.stringify([e.agent_id ?? 'main', e.tool_name, e.tool_input])
  const refused: Record<string, string> = await read($, postedRefusals)
  const earlierId: string | undefined = refused[refusal]
  if (earlierId !== undefined) return withAnswerRoute(e, `It was posted to the board as ${earlierId} when this call was first refused`)
  const loop = await loopName($, e.agent_id)
  const posting = await postDecision($, {
    question: `${loop}'s ${e.tool_name} call needed a permission prompt while you were away, so it was refused: ${describeInput(e.tool_input)}`,
    context: e.agent_id === undefined ? undefined : relayedTo(loop),
    options: [{ label: 'Run it', description: 'Claude retries the call once you are back.' }, { label: 'Do not run it' }],
  })
  if ('failure' in posting) return `Posting it to the board failed (${posting.failure}), so name it in your report instead.`
  await update($, postedRefusals, previous => ({ ...previous, [refusal]: posting.id }))
  return withAnswerRoute(e, `It is posted to the board as ${posting.id}`)
}

// Rows such as [mode: present] reach only the main conversation, so a teammate learns of the answer from its lead.
function withAnswerRoute(e: PermissionRequest, posted: string): string {
  const notWaiting = `${posted}; do not wait for the answer.`
  if (e.agent_id !== undefined) return `${notWaiting} The owner's answer goes to your lead, which relays it to you; retry the call if it says to run it.`
  return `${notWaiting} If the owner answers to run it, retry the call once a [mode: present] row shows they are back.`
}

// board gives a decision a plugin posts no asking loop, so the answer reaches the main session whoever was refused.
const relayedTo = (loop: string) => `The answer goes to the main session, which relays it to ${loop}.`

/**
 * Posts an auto mode denial to the board once per loop, tool and category in a session, since a model retrying the
 * call would fill the board with copies. The denied loop is told nothing: the denial's own error already says what
 * to do.
 */
export async function postDenial($: EngineInterface, e: PermissionDenied) {
  // A denial with no classifier verdict may carry no bracketed category, so its reason stands in.
  const category = BRACKETED.exec(e.reason)?.[0] ?? cut(e.reason, MAX_REASON_CHARS)
  const denial = JSON.stringify([e.agent_id ?? 'main', e.tool_name, category])
  const posted: string[] = await read($, postedDenials)
  if (posted.includes(denial)) return
  const loop = await loopName($, e.agent_id)
  const context = ['Answering here does not let the call through; only a permission rule that allows it does.']
  if (e.agent_id !== undefined) context.push(relayedTo(loop))
  const posting = await postDecision($, {
    question: `Auto mode denied ${loop}'s ${e.tool_name} call ${category}: ${describeInput(e.tool_input)}`,
    context: context.join(' '),
    options: [
      { label: 'Retry it', description: 'After you add a permission rule that allows it; without one, auto mode denies it again.' },
      { label: 'Drop it' },
    ],
  })
  if ('failure' in posting) {
    $.ui.toast(`An auto mode denial did not reach the board (${posting.failure}): ${loop}'s ${e.tool_name}`)
    return
  }
  await update($, postedDenials, previous => [...previous, denial])
}
