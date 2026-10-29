---
name: delegation
description: How a lead session runs Agent Teams teammates, covering when to delegate at all, how many teammates to run, how to size and brief a task, how to wait on and reply to teammates, how to receive their reports, and how to shut them down. Use it before every Agent call that spawns a teammate or subagent, and before replying to a message from a teammate. Triggers on "spawn a teammate", "spawn an agent", "delegate this", "hand this to an agent", "brief an agent", "fan out", "run this in parallel", "split this across agents", "get a teammate to", and on any incoming teammate message or idle notification. Load it even when the delegation looks routine, since the rules it holds are the ones skipped when it does.
allowed-tools: Read(~/.claude/local/delegation/**)
---

# Delegation

Rules for a lead session that hands work to teammates. Each rule carries its reason, so it can be applied to a case
it does not name. The agent templates in `${CLAUDE_PLUGIN_ROOT}/templates/` follow the parts of this skill that
belong in an agent definition.

## Before spawning

### Whether and how many

- **Stop delegating when coordinating costs more context than the work saves.** Compare the words written to
  teammates with the words they save the lead; delegation exists to save the lead's context and can spend more than
  it saves without anything signalling it.
- **The default is one worker, which runs its own builds and reads its own output.** Its build output is the evidence
  it debugs from.
- **Add a second worker only when parallel work shortens wall-clock time**, not because two things exist to do. Each
  extra teammate adds coordination the lead pays for.
- **Three or more live teammates is the user's call.** The cost of that many is the user's to accept.

### Sizing a task

- **Size each task so the worker finishes it below the degradation point, counting its ramp-up.** Rule-following
  degrades past about 30% of the context window on Opus 5.5, and 60% is the ceiling. Local additions may change both
  numbers.
- **A project too big for one worker becomes a task list in its spec, one worker per task**, run in sequence unless
  the tasks are genuinely independent. Sequential tasks build on each other's finished state.
- **Ramp-up cost comes from the repository's development profile**, not from this skill. What a worker has to read
  before it can work differs per repository.
- **One task per teammate, after which it goes away.** A warm teammate handed an unrelated second task carries the
  first task's context into it, and a brief that bundles two tasks leaves each less context than the sizing assumed.
- **A shared resource is a reason to order spawns, never to merge them.** Merging two tasks to avoid contention
  rebuilds the bundled brief above.

### Roles

- **A worker never judges its own work.** It reads its own result as the result it meant to produce.
- **A runner agent is for builds the lead would otherwise run, or for several workers contending for one build
  directory.** Never put one between a worker and its own build: the worker then loses the output it debugs from.
- **Check a worker's tool grant before assuming it can spawn agents.** An agent definition without `Agent` in its
  grant cannot, and a brief that asks it to fails late.

### Writing the brief

- **Name the decisions that stay with the lead**, typically scope, whether a known gap may ship, and sequencing access
  to a shared resource. The teammate decides the rest; one that does not know which are the lead's escalates all of
  them.
- **Brief for intent and constraints, not the line to change.** A worker that knows the goal can catch a wrong
  instruction; one given only the edit carries it out.
- **A brief carries the task and the context the agent cannot discover, and never restates or overrides the agent's
  definition.** No steps, no order, no tool choices and no checklist of what to look for: the agent anchors on the
  list and stops looking past it.
- **For an agent with no definition, such as general-purpose, name the job as a lens in one phrase**, for example "as
  a reviewer checking error paths". The phrase sets what it attends to without fencing it in.
- **If an agent's definition is wrong, fix the definition.** A correction in one brief is lost at the next spawn.
- **Ask for a bounded deliverable**: an artifact, a file, specific numbers. Open-ended reasoning returns as a long
  report that has to be re-read to find the answer.
- **Say which branch the teammate owns and whether it may switch.** The main checkout's HEAD is shared by every agent
  working in it, so a branch switch there moves it for all of them.

### Shared structures

- **Real parallel work goes in a shared task list that teammates take from and coordinate on directly.** The lead is
  not a message router; routing every handoff through it spends its context on traffic.
- **Work of any size has a living spec, in the location the repository's development profile names, edited as
  decisions land.** Teammates read it and take tasks from it, so a decision recorded there reaches every later
  teammate without a brief repeating it.

### Worktrees and the language server

- **Worktree-isolated agents share one language server with the lead**, rooted wherever it was first started. Once
  the lead has started it in the main checkout, a worktree agent's symbol queries resolve against the main checkout,
  and a symbol that exists only in the worktree comes back "not found" with no error.
- **So a worktree agent confirms its own new symbols with the build or a text search**, never with the language
  server. A "not found" there is the shared server's view of the main checkout, not evidence about the worktree.

## While teammates run

- **With any teammate running concurrently, let messages accumulate and answer once.** A message can be read without
  a reply, and each reply costs both sides a turn.
- **A teammate sees new mail only after its current tool call ends**, so hold instructions and send them together
  when it reports. Messages sent one at a time land together anyway, and a later one can contradict an earlier one.
- **A teammate that backgrounds a command and goes idle waiting for it is stuck**: nothing wakes it. Teammates run
  builds in the foreground with a timeout long enough for the build. When one is stuck, message it to check the job.
- **A build or test run is an exclusive, global resource, compile-only phases included.** Nobody changes a shared
  tree while one runs, even in files the run does not touch, because the build reads whatever is on disk when it gets
  there. A teammate about to change a shared tree announces it first.
- **Judge a teammate's state with `ListAgents`**, never from the filesystem or an idle notification. Files show what
  was written, not whether the agent is still writing.

## Receiving work

- **The report channel is part of every agent definition**, never of a spawn prompt, so it holds for every spawn:
  - The report goes by `SendMessage` addressed to `main`, which is how a teammate reaches the lead.
  - Long content goes to a file, and the message carries a few lines and the path.
  - The final turn text is one line. The lead receives it too, in the idle notification or, in a headless run, as a
    task notification, so a report written there as well arrives twice.
  - A forked skill has no `SendMessage` and reports through its own channel.
- **A forked skill that a teammate invokes reports to the main session, and the teammate gets only a "launched"
  notice.** The lead passes the result on to the teammate that needs it.
- **An idle notification is not a result.** Check the deliverable directly, on disk or with one command, instead of
  asking the teammate whether it finished.
- **Relay conclusions and the evidence needed to act on them**, not the teammate's raw findings. Raw findings move the
  noise the teammate absorbed back into the lead.
- **Carry a number's method with it.** A number without what it measured, and how, cannot be weighed.
- **Check a teammate's claim about another teammate's work against the evidence before recording it.** Second-hand
  claims are where a confident error enters the record.
- **Teammates stage by path and never commit or push.** The lead commits, pushes and handles pull requests and their
  threads, because commit identity, remotes and tokens are set per repository and a wrong one fails silently.

## Shutting down

- **Before stopping anyone, confirm the tree is consistent**: it builds, and the working tree matches the index. Work
  written down but left half applied is lost context, not a finished task.
- **Stop teammates when their work is done.** Keeping one alive is an exception, stated with its reason.
- **A shutdown request is processed only when the agent's turn ends**, so it finishes everything it was doing first.
  `TaskStop` stops it at once, including a command in flight.
- **After stopping, confirm the roster is empty with `ListAgents`** and check for processes the agent started outside
  its own tool calls, such as a server or a daemon, which outlive it.

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/delegation/additions.md 2>/dev/null || echo "(none)"`
