# board

A pane where Claude and its agents post the decisions and tasks that wait on you, keep their own tasks with a
checklist, and say what each of them is doing. A decision stays on screen until you answer it, so a question cannot
scroll away in the transcript. There are no settings.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install board@runt9
```

`/board` opens the pane. It also opens by itself when an agent posts something for you.

## What Claude is told

While a surface draws the pane, Claude's system prompt says to post a question whose answer changes its next step
as a decision rather than asking it in a reply, to post anything it needs you to do as a task for you, to track its
own multi-step work as a task with a checklist, to keep a one-line status, and to read the board after a compaction.
With no surface, as in `claude -p`, nothing is added.

## The tools

| Tool | What it does |
|---|---|
| `mcp__board__ask_decision` | Posts a decision with 2 to 4 options, one of them marked recommended, and returns its id (`D1`, `D2`, ...) at once. Called again with the id, it rewords the decision or withdraws it. |
| `mcp__board__set_owner_task` | Posts a task for you (`O1`, ...), with an optional description and checklist. Called again with the id, it changes the title, the description or the items you have not ticked, or withdraws the task. |
| `mcp__board__set_task` | Adds or updates one of the agents' own tasks (`T1`, ...), with a status, a note and a checklist the agent ticks. `in_progress` claims the task for the caller and is refused while another running agent holds it; `done`, `pending` and `dropped` release it, `blocked` keeps the claim. |
| `mcp__board__set_status` | Sets the caller's one-line status. |
| `mcp__board__read_board` | Lists the open tasks with who holds each, and the decisions and tasks still waiting on you. |

Only the agent that posted a decision or a task for you, or the main session, can change or withdraw it. When the
main session rewords or withdraws another agent's decision, or withdraws its task for you, that agent is told with a
`[board]` message. An id is never issued twice in a session, even after its item is dropped or cleared.

## The pane

- **Activity**: one line per agent, saying whether it is working, idle or held by a permission prompt, for how
  long, and its status.
- **Waiting on you**: each decision with its option buttons, a Dismiss button and a note box, then each task for
  you with Start, Done and its items to tick. A new decision or task flashes for four seconds. A note typed before
  pressing an option goes with that option; Enter in the note box sends the note alone as "Other". Dismiss answers
  that no option was chosen. Keys 1 to 4 press the first decision's options; once it is answered or withdrawn, the
  next one takes them after a second and a half.
- **Tasks**: the agents' own tasks, in progress first, with who holds each and how much of its checklist is ticked.
  Expand shows the note and the items. Done tasks are counted until Show lists them, and Clear removes them.
- **Answered, not yet sent to Claude**: each answer or change until a model request of the agent that asked has
  carried it. One that failed to arrive has Retry and "Dismiss (I told it)". While the main session is idle with
  answers waiting for it, **Send now** starts its turn with a short `[board]` prompt, so it reads them all without
  your typing one.

A line above the prompt counts the decisions and tasks waiting on you and the tasks in progress, with an
**Open board** button. It flashes with a new decision or task for you.

## How answers arrive

Your answer, and each tick, Start and Done on a task for you, is added to the conversation of the agent that posted
it as a message starting `[board]`. A running agent reads it at its next step; an idle main session reads it with
your next prompt. A teammate idle between turns is sent the same text as a message instead, which wakes it. An agent
that has finished or been stopped is not, since a message would start it again: the answer or change is listed as
not delivered, and "Dismiss (I told it)" clears it. A toast says whether an answer or a Done arrived; a tick or a
Start has one only when it did not.

## Nudges

The board watches every tool call the model makes, and while a surface draws the pane it adds a `[board]` line to
the result the calling agent reads:

- When an agent's status is 20 tool calls or 10 minutes of working time old, once per status. Time spent idle or on
  a permission prompt does not count. The line also names the tasks the agent holds and their unticked items. An
  agent with no status yet is asked to set one only if its prompt carries the board's guidance (the main session
  and teammates) or it holds a task.
- Every 20 tool calls, and after each commit, while the agent holds an in-progress task with unticked items: the
  line names those items. Each `set_task` call by that agent starts the count again.

Calls a plugin makes itself are neither counted nor nudged.

## What is kept

The decisions and tasks are saved per session id, for the 20 most recent sessions that had any. A conversation that
continues under a new session id, as one moved to the background does, finds its board again by the tool calls its
transcript shares with the saved one. Activity is not saved.

## The away plugin

A plugin named `away` posts decisions through `mcp__board__ask_decision` and relies on five things, which do not
change without it:

- The result of a new decision starts with `Posted D<n>`.
- `mcp__board__read_board` lists the decisions and the tasks waiting on you, each with its id and its question or
  title; `away`'s return report has Claude read them there.
- A decision a plugin posts has no asking agent, so its answer goes to the main session.
- A new decision flashes on the pane and in the line above the prompt; it is `away`'s only alert in its distracted
  mode.
- An agent counts as ended when `$.agent.list()` lists it as `completed`, `failed` or `killed`; `away` keeps a copy
  of that list.
