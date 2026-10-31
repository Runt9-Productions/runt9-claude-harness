import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BoardActivity, BoardDecision, BoardOwnerTask, BoardTask, BoardTaskStatus } from '../types'
import { agentLabel, elapsed, isMainOutsideTurn } from './activity'
import { DISMISSED_ANSWER, answerOther, answerWithNote, asOption, dismiss, openBoard, retry, sendNow, setNote, unreadByMain } from './decisions'
import { completeOwnerTask, dismissOwnerChange, ownerTaskStatus, retryOwnerChange, toggleItem, toggleStart } from './owner-tasks'
import { boundSession, pressOnBoard } from './persistence'
import { OPEN_ORDER, clearDone } from './tasks'

const STATUS_MARK: Record<BoardTaskStatus, string> = { done: '✓', in_progress: '◐', blocked: '!', pending: '○' }

// Explicit per status: dim text is unreadable on a gray pane.
const STATUS_COLOR: Record<BoardTaskStatus, string | undefined> = {
  done: 'green',
  in_progress: 'cyan',
  blocked: 'yellow',
  pending: undefined,
}

const ACTIVITY_MARK: Record<BoardActivity['state'], string> = { permission: '!', working: '●', idle: '○' }

function activityColor(state: BoardActivity['state'], hasOpenWork: boolean): string | undefined {
  if (state === 'permission') return 'red'
  if (state === 'working') return 'cyan'
  return hasOpenWork ? 'yellow' : undefined
}

function activityText(row: BoardActivity): string {
  if (row.state !== 'permission') return row.state
  return `waiting on a permission prompt (${row.permissionTool ?? 'a tool'})`
}

const LIT_STYLE = { color: 'black', backgroundColor: 'yellow' }

// Declared again in each file that uses them, since the loader refuses an imported atom (register.tsx has the rule).
const decisions =atom({ plugin: 'board', key: 'decisions' } as const, [])
const tasks = atom({ plugin: 'board', key: 'tasks' } as const, [])
const ownerTasks = atom({ plugin: 'board', key: 'ownerTasks' } as const, [])
const isDoneShown = atom({ plugin: 'board', key: 'isDoneShown' } as const, false)
const expandedNotes = atom({ plugin: 'board', key: 'expandedNotes' } as const, [])
const activity = atom({ plugin: 'board', key: 'activity' } as const, [])
const now = atom({ plugin: 'board', key: 'now' } as const, 0)
const litIds = atom({ plugin: 'board', key: 'litIds' } as const, [])
const areHotkeysHeld = atom({ plugin: 'board', key: 'areHotkeysHeld' } as const, false)

/** A description longer than one line of the pane collapses its entry. */
function isLongText(text: string | undefined, columns: number): boolean {
  if (text === undefined) return false
  return text.includes('\n') || text.length > columns
}

async function toggleExpanded($: EngineInterface, id: string) {
  await update($, expandedNotes, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]))
}

export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const elements = $.ui.resolve(e)
  const { Box, Button, Text } = elements
  // Mobile draws no Input yet, so there the note box is left out and only the option buttons answer.
  const Input = 'Input' in elements ? elements.Input : undefined
  const allDecisions: BoardDecision[] = await read($, decisions)
  const allTasks: BoardTask[] = await read($, tasks)
  const allOwnerTasks: BoardOwnerTask[] = await read($, ownerTasks)
  const waiting = allDecisions.filter(d => d.answer === undefined)
  const waitingOwnerTasks = allOwnerTasks.filter(t => !t.isDone)
  // An answer stays listed until a request of the loop that asked has carried it, or until the owner dismisses it.
  const unsent = allDecisions.filter(d => d.delivery !== undefined && d.delivery !== 'seen')
  const unsentOwnerTasks = allOwnerTasks.filter(t => t.lastChange !== undefined && t.lastChange.delivery !== 'seen')
  const loops: BoardActivity[] = await read($, activity)
  // A main loop inside a turn, held on a permission prompt included, reads its answers at its next request anyway.
  const isMainIdle = await isMainOutsideTurn($)
  const hasAnswersForMain = (await unreadByMain($)).length > 0
  const at = (await read($, now)) || (await $.clock.now())
  const hasOpenWork = allTasks.some(t => t.status === 'in_progress' || t.status === 'pending')
  const openTasks = OPEN_ORDER.flatMap(status => allTasks.filter(t => t.status === status))
  const doneTasks = allTasks.filter(t => t.status === 'done')
  const isDoneListed: boolean = await read($, isDoneShown)
  const expanded: string[] = await read($, expandedNotes)
  const lit: string[] = await read($, litIds)
  const hotkeysHeld: boolean = await read($, areHotkeysHeld)
  const drawnFor = boundSession()
  const onBoard = (act: () => Promise<void>) => () => void pressOnBoard($, drawnFor, act)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>ACTIVITY</Text>
      {loops.length === 0 && <Text>Nothing observed yet.</Text>}
      {loops.map(a => (
        <Box key={a.agentId} flexDirection="column">
          {/* One line per agent whatever the pane's width: a wrapped row moves everything below it. */}
          <Text wrap="truncate-end" color={activityColor(a.state, hasOpenWork)} bold={a.state === 'permission'}>
            {ACTIVITY_MARK[a.state]} {a.label} {activityText(a)} {elapsed(a.since, at)}
            {a.status ? ` · ${a.status} (${elapsed(a.statusAt, at)} ago)` : ''}
          </Text>
        </Box>
      ))}
      <Text> </Text>

      <Text bold>WAITING ON YOU ({waiting.length + waitingOwnerTasks.length})</Text>
      {/* Each decision card already ends in a blank line; this gives the empty list the same gap. */}
      {waiting.length + waitingOwnerTasks.length === 0 && (
        <Box marginBottom={1}>
          <Text dimColor>Nothing waiting.</Text>
        </Box>
      )}
      {waiting.map((d, index) => (
        <Box key={d.id} flexDirection="column" marginBottom={1}>
          <Text bold {...(lit.includes(d.id) ? LIT_STYLE : {})}>
            {d.id} {d.askedBy ? `(${d.askedBy} asks) ` : ''}
            {d.question}
          </Text>
          {d.context && <Text italic>{d.context}</Text>}
          <Box flexDirection="row" flexWrap="wrap">
            {d.options.map(asOption).map((option, i) => (
              <Button
                key={`${d.id}-option-${i}`}
                label={i === d.recommended ? `${option.label} (recommended)` : option.label}
                hotkey={index === 0 && !hotkeysHeld ? String(i + 1) : undefined}
                variant={i === d.recommended ? 'primary' : undefined}
                onPress={onBoard(() => answerWithNote($, d.id, option.label))}
              />
            ))}
            <Button key={`${d.id}-dismiss-question`} label="Dismiss" onPress={onBoard(() => answerWithNote($, d.id, DISMISSED_ANSWER))} />
          </Box>
          {Input && (
            // Input wraps to the pane's full width rather than its own box, so it must not sit inside the root's paddingX.
            <Box marginX={-1}>
              <Input
                key={`${d.id}-other`}
                placeholder="Note: goes with the option you press, or Enter sends it alone as Other"
                submitLabel="send"
                onInput={value => void pressOnBoard($, drawnFor, () => setNote($, d.id, value))}
                onSubmit={value => void pressOnBoard($, drawnFor, () => answerOther($, d.id, value))}
              />
            </Box>
          )}
        </Box>
      ))}
      {waitingOwnerTasks.map(t => {
        // Less the pane's paddingX on both sides.
        const isCollapsible = t.items.length > 0 || isLongText(t.description, e.props.bodyColumns - 2)
        const isExpanded = !isCollapsible || expanded.includes(t.id)
        const ticked = t.items.filter(item => item.isTicked).length
        const status = ownerTaskStatus(t)
        return (
          <Box key={t.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" flexWrap="wrap">
              <Text bold color={STATUS_COLOR[status]} {...(lit.includes(t.id) ? LIT_STYLE : {})}>
                {STATUS_MARK[status]} {t.id} {t.postedBy ? `(from ${t.postedBy}) ` : ''}
                {t.title}
                {t.items.length > 0 ? ` ${ticked}/${t.items.length}` : ''}{' '}
              </Text>
              {isCollapsible && (
                <Button key={`${t.id}-expand`} label={isExpanded ? 'Collapse' : 'Expand'} onPress={() => void toggleExpanded($, t.id)} />
              )}
              {/* A ticked item keeps the task started, so Unstart would change nothing. */}
              {ticked === 0 && (
                <Button key={`${t.id}-start`} label={t.isStartPressed ? 'Unstart' : 'Start'} onPress={onBoard(() => toggleStart($, t.id))} />
              )}
              <Button key={`${t.id}-done`} label="Done" onPress={onBoard(() => completeOwnerTask($, t.id))} />
            </Box>
            {isExpanded && t.description && <Text italic>{t.description}</Text>}
            {isExpanded &&
              t.items.map((item, i) => (
                <Button
                  key={`${t.id}-item-${i}`}
                  plain
                  label={`${item.isTicked ? '[x]' : '[ ]'} ${item.label}`}
                  onPress={onBoard(() => toggleItem($, t.id, item.label))}
                />
              ))}
          </Box>
        )
      })}

      <Text bold>TASKS</Text>
      {allTasks.length === 0 && <Text dimColor>No tasks.</Text>}
      {[...openTasks, ...(isDoneListed ? doneTasks : [])].map(t => {
        const items = t.items ?? []
        const isCollapsible = items.length > 0 || t.note !== undefined
        const isExpanded = isCollapsible && expanded.includes(t.id)
        const ticked = items.filter(item => item.isTicked).length
        return (
          <Box key={t.id} flexDirection="column">
            <Box flexDirection="row">
              <Text color={STATUS_COLOR[t.status]}>
                {STATUS_MARK[t.status]} {t.id} {t.title}
                {items.length > 0 ? ` ${ticked}/${items.length}` : ''}
                {t.holderId === undefined ? '' : ` · ${agentLabel(loops, t.holderId) ?? 'Claude'}`}{' '}
              </Text>
              {isCollapsible && (
                <Button key={`${t.id}-expand`} label={isExpanded ? 'Collapse' : 'Expand'} onPress={() => void toggleExpanded($, t.id)} />
              )}
            </Box>
            {isExpanded && t.note !== undefined && <Text key={`${t.id}-note-text`}>    {t.note}</Text>}
            {/* Text, not the owner task's Buttons: these are the agent's to tick. */}
            {isExpanded &&
              items.map((item, i) => (
                <Text key={`${t.id}-item-${i}`}>{`    ${item.isTicked ? '[x]' : '[ ]'} ${item.label}`}</Text>
              ))}
          </Box>
        )
      })}
      {doneTasks.length > 0 && (
        <Box key="done" flexDirection="row">
          <Text color={STATUS_COLOR.done}>
            {STATUS_MARK.done} {doneTasks.length} done{' '}
          </Text>
          <Button
            key="done-toggle"
            label={isDoneListed ? 'Hide' : 'Show'}
            onPress={() => void update($, isDoneShown, shown => !shown)}
          />
          <Button key="done-clear" label="Clear" onPress={onBoard(() => clearDone($))} />
        </Box>
      )}

      {unsent.length + unsentOwnerTasks.length > 0 && (
        <Box key="unsent" flexDirection="column" marginTop={1}>
          <Text bold>ANSWERED, NOT YET SENT TO CLAUDE</Text>
          {unsent.map(d => (
            <Box key={d.id} flexDirection="row" flexWrap="wrap">
              <Text color={d.delivery === 'failed' ? 'red' : undefined}>
                {d.id} → {d.answer}
                {d.delivery === 'failed' ? ` (not delivered${d.askedBy ? ` to ${d.askedBy}` : ''}) ` : ''}
              </Text>
              {d.delivery === 'failed' && <Button key={`${d.id}-retry`} label="Retry" onPress={onBoard(() => retry($, d.id))} />}
              {d.delivery === 'failed' && (
                <Button key={`${d.id}-dismiss`} label="Dismiss (I told it)" onPress={onBoard(() => dismiss($, d.id))} />
              )}
            </Box>
          ))}
          {unsentOwnerTasks.map(t => {
            const isFailed = t.lastChange?.delivery === 'failed'
            return (
              <Box key={t.id} flexDirection="row" flexWrap="wrap">
                <Text color={isFailed ? 'red' : undefined}>
                  {t.id} → {t.lastChange?.summary}
                  {isFailed ? ` (not delivered${t.postedBy ? ` to ${t.postedBy}` : ''}) ` : ''}
                </Text>
                {isFailed && <Button key={`${t.id}-retry`} label="Retry" onPress={onBoard(() => retryOwnerChange($, t.id))} />}
                {isFailed && (
                  <Button key={`${t.id}-dismiss`} label="Dismiss (I told it)" onPress={onBoard(() => dismissOwnerChange($, t.id))} />
                )}
              </Box>
            )
          })}
          {isMainIdle && hasAnswersForMain && (
            <Button key="send-now" label="Send now" onPress={onBoard(() => sendNow($))} />
          )}
        </Box>
      )}
    </Box>
  )
}

export async function renderAbovePrompt($: EngineInterface, e: RenderInput<'AbovePrompt'>, below: RenderElement): Promise<RenderElement> {
  const allDecisions: BoardDecision[] = await read($, decisions)
  const allTasks: BoardTask[] = await read($, tasks)
  const allOwnerTasks: BoardOwnerTask[] = await read($, ownerTasks)
  const lit: string[] = await read($, litIds)
  const waitingDecisions = allDecisions.filter(d => d.answer === undefined)
  const waitingOwnerTasks = allOwnerTasks.filter(t => !t.isDone)
  const waiting = waitingDecisions.length
  const forYou = waitingOwnerTasks.length
  const running = allTasks.filter(t => t.status === 'in_progress').length
  if (e.props.hasSurvey || (waiting + forYou === 0 && running === 0)) return below
  const isLit = [...waitingDecisions, ...waitingOwnerTasks].some(item => lit.includes(item.id))
  const forYouText = forYou === 0 ? '' : ` · ${forYou} task${forYou === 1 ? '' : 's'} for you`

  const { Box, Button, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Box key="board">
        <Text {...(isLit ? LIT_STYLE : { color: waiting + forYou > 0 ? 'yellow' : undefined })}>
          Board: {waiting} decision{waiting === 1 ? '' : 's'} waiting{forYouText} · {running} in progress{' '}
        </Text>
        <Button key="open" label="Open board" onPress={() => void openBoard($)} />
      </Box>
      {below}
    </Box>
  )
}
