---
title: Teammate Lifecycle
type: note
permalink: agent-teams/lifecycle
tags: [agent-teams, teammates, forked-skills, delegation, headless, resume]
verified: 2026-11-01
coverage: partial
measured_on: "Claude Code 2.1.312 and 2.1.322"
sources:
  - plugins/delegation/skills/delegation/SKILL.md
---

# Teammate Lifecycle

> **Scope.** What a lead receives from an Agent Teams teammate, where a forked skill a teammate invokes reports, whether a finished background command wakes a teammate, how a teammate is stopped, what an agent without `Write` can still write, what a named `Agent` spawn makes in `claude -p` and in an interactive lead, and whether `--resume` brings a `-p` agent back. The `-p` lines are carried from headless runs on 2.1.312 (2026-10-28) and the interactive lines from a re-run in an interactive lead session with Agent Teams on (2026-10-29, version not recorded beside it); neither was re-measured when this note was written. The spawn and `--resume` lines were measured on 2.1.322 on 2026-11-11 for issue #143: seven `claude -p` sessions (one probe and six verification runs, three of them woken again by a `--resume` process) and three interactive lead sessions with `--teammate-mode in-process`, driven in tmux, read from transcripts, metadata files and a diagnostic plugin's log of `$.agent.list()`. The delegation skill lines cited were read, and re-read on 2026-11-01, when the lens-review skill was checked and found to say nothing about where its report goes. Not covered: the interactive idle notification's content, a lead in `-p` with nothing of its own still running, teammates in a terminal pane of their own, teammate compaction, any other way to start a `-p` agent that has a `teammateId`, and `--resume` of an interactive session's teammate.

Read this before writing a rule about how teammates report, wait or stop, or before testing one headless. `-p` and
interactive sessions differ on several of these behaviours, and on 2.1.322 a `-p` spawn is not a teammate at all, so a
headless run does not answer for an interactive lead.

## Observations

- [fact] Each time a background teammate stops, the lead gets a `<task-notification>` whose `<result>` holds the teammate's final turn text verbatim, uncut at 54.6 KB #measured (`-p`)
- [trap] A foreground `Agent` result of the same size comes back as `<persisted-output>` with a 2 KB preview, so the lead cannot read the end of a long foreground report #measured (`-p`, 55.3 KB)
- [fact] A teammate reaches the lead with `SendMessage` to `main`; to `lead` it fails with "No agent named 'lead' is reachable" #measured (`-p`)
- [fact] Interactive, the lead's idle notification carries the teammate's final turn text in its `result` field, so a teammate that also sends the same report with `SendMessage` lands it twice #measured (interactive, 2026-10-30)
- [fact] A teammate's `Skill` call on a `context: fork` skill returns only "launched (forked execution, running in the background)"; the fork's result reaches the lead as a task notification and never the teammate #measured (interactive)
- [trap] In `-p` the same call returns the fork's result to the teammate's own `Skill` call, and the lead model gets no notification for the fork, though the stream-json still emits its task events #measured (`-p`)
- [fact] The delegation skill tells the lead to pass a forked skill's result on to the teammate that needs it ("Receiving work", `SKILL.md:114`), which rests on the interactive result.
- [trap] A background command finishing does not wake a teammate that ended its turn: it ran again only when the lead messaged it, 65 s after the command finished #silent-failure #measured (interactive). A headless forked skill fails worse, in [[Skill Loading]]: ending its turn ends the run
- [fact] In `-p`, with the lead kept alive, the same completion restarted the teammate under its own task id and it read the output #measured (`-p`)
- [fact] The delegation skill has teammates run builds in the foreground for that reason ("While teammates run", `SKILL.md:98`).
- [fact] `ListAgents` and `TaskStop` are in the tool list with Agent Teams on and off alike, and there is no `TeamCreate` #measured (`-p`, the session's `init` tool list; still no `TeamCreate` on 2.1.322)
- [trap] In `claude -p` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, the lead's `Agent` call with a `name` and `subagent_type: general-purpose` makes a background subagent, not an Agent Teams teammate: it returns "Async agent launched", `$.agent.list()` gives the agent no `teammateId`, and its metadata file has no `taskKind` or `teamName`. It runs in the lead's process and writes `subagents/agent-<agentId>.jsonl` beside the session's transcript. The `Agent` tool's `team_name` reads "Deprecated; ignored. The session has a single implicit team." #measured (2.1.322: `teammateId` logged in two runs, the metadata file read in two)
- [fact] An interactive lead's same call makes an in-process teammate: `$.agent.list()` gives it a `teammateId` of the form `<name>@<team>`, and its metadata file records `taskKind: in_process_teammate` and a `teamName` #measured (2.1.322, three interactive sessions)
- [trap] Both metadata files record `requestShape: background`, so that key does not tell a `-p` subagent from a teammate; `teammateId` and `taskKind` do. A `-p` run on 2.1.322 tests a background subagent, and a mod that acts only on agents with a `teammateId`, as teammate-delivery does ([[Teammate Mailbox]]), does nothing there #measured (2.1.322, the metadata files of two `-p` agents and three interactive teammates)
- [risk] The `-p` lines above that were measured on 2.1.312 call the spawned agent a teammate; which kind it was on that version was not recorded, so they may describe a background subagent. Not checked.
- [fact] A later `claude -p --resume <session id>` in a new process brings that background subagent back: the lead's `SendMessage` to it by name returned "Resuming agent <name>", the agent's first request was rebuilt in full from its transcript, carrying text stored in its earlier rows, and it ran a tool call and handed its report back #measured (2.1.322, three runs: the rebuilt request in all three, the "Resuming agent" reply read in two, and the tool call and report in two, since the probe's woken turn failed on an API error the probe caused; the request's `api-request` row had `base: null` and `keep: 0`, decoded as [[Plugin Platform]] describes)
- [fact] Interactive, a teammate whose turn ended and that a message woke again stays in the same process: its next request extends the previous one (`base` the previous request, `keep` all of its messages) rather than starting a new chain #measured (2.1.322, two interactive sessions with no plugin row off the chain; [[Teammate Mailbox]] has the case where the request after a wake re-sends part of the conversation)
- [fact] `TaskStop` stops a teammate at once, including the `Bash` call it has in flight #measured (`-p`, teams on and off)
- [trap] A shutdown request is processed only when the teammate's turn ends: it ran its remaining four steps, ended its turn, then approved #measured (interactive)
- [trap] In `-p` a shutdown request reported success and never reached the teammate at all #measured (`-p`)
- [fact] In `-p` a shutdown request sent as a JSON string is refused ("message text must not be a teammate protocol frame"); only the structured object form is sent #measured (`-p`)
- [fact] Interactive, `SendMessage` with the JSON string `{"type": "shutdown_request", ...}` as its message is sent as a shutdown request, and the teammate approves it #measured (interactive, 2026-10-30)
- [fact] A stopped teammate drops out of `ListAgents`, whose "Peer sessions" section lists every Claude Code session on the machine, nested `-p` runs included #measured (`-p`)
- [trap] An agent granted `Edit` but not `Write` still creates files: `Edit` with an empty `old_string` on a missing path creates it, and `Bash` can as well #measured (`-p`, a custom agent with `tools: Bash, Edit, Read`)

## Relations

- see_also [[Teammate Mailbox]]
- see_also [[Built-in Worktrees]]
- see_also [[Skill Loading]]
- see_also [[Plugin Platform]]
