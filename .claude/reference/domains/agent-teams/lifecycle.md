---
title: Teammate Lifecycle
type: note
permalink: agent-teams/lifecycle
tags: [agent-teams, teammates, forked-skills, delegation]
verified: 2026-11-01
coverage: partial
measured_on: "Claude Code 2.1.312"
sources:
  - plugins/delegation/skills/delegation/SKILL.md
---

# Teammate Lifecycle

> **Scope.** What a lead receives from an Agent Teams teammate, where a forked skill a teammate invokes reports, whether a finished background command wakes a teammate, how a teammate is stopped, and what an agent without `Write` can still write. The `-p` lines are carried from headless runs on 2.1.312 (2026-10-28) and the interactive lines from a re-run in an interactive lead session with Agent Teams on (2026-10-29, version not recorded beside it); neither was re-measured when this note was written. The delegation skill lines cited were read, and re-read on 2026-11-01, when the lens-review skill was checked and found to say nothing about where its report goes. Not covered: the interactive idle notification's content, a lead in `-p` with nothing of its own still running, teammates in a terminal pane of their own, and teammate compaction.

Read this before writing a rule about how teammates report, wait or stop, or before testing one headless. `-p` and
interactive sessions differ on three of these behaviours, so a headless run does not answer for an interactive lead.

## Observations

- [fact] Each time a background teammate stops, the lead gets a `<task-notification>` whose `<result>` holds the teammate's final turn text verbatim, uncut at 54.6 KB #measured (`-p`)
- [trap] A foreground `Agent` result of the same size comes back as `<persisted-output>` with a 2 KB preview, so the lead cannot read the end of a long foreground report #measured (`-p`, 55.3 KB)
- [fact] A teammate reaches the lead with `SendMessage` to `main`; to `lead` it fails with "No agent named 'lead' is reachable" #measured (`-p`)
- [fact] Interactive, the lead's idle notification carries the teammate's final turn text in its `result` field, so a teammate that also sends the same report with `SendMessage` lands it twice #measured (interactive, 2026-10-30)
- [fact] A teammate's `Skill` call on a `context: fork` skill returns only "launched (forked execution, running in the background)"; the fork's result reaches the lead as a task notification and never the teammate #measured (interactive)
- [trap] In `-p` the same call returns the fork's result to the teammate's own `Skill` call, and the lead model gets no notification for the fork, though the stream-json still emits its task events #measured (`-p`)
- [fact] The delegation skill tells the lead to pass a forked skill's result on to the teammate that needs it (`SKILL.md:114`), which rests on the interactive result.
- [trap] A background command finishing does not wake a teammate that ended its turn: it ran again only when the lead messaged it, 65 s after the command finished #silent-failure #measured (interactive). A headless forked skill fails worse, in [[Skill Loading]]: ending its turn ends the run
- [fact] In `-p`, with the lead kept alive, the same completion restarted the teammate under its own task id and it read the output #measured (`-p`)
- [fact] The delegation skill has teammates run builds in the foreground for that reason (`SKILL.md:98`).
- [fact] `ListAgents` and `TaskStop` are in the tool list with Agent Teams on and off alike, and there is no `TeamCreate` #measured (`-p`, the session's `init` tool list)
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
