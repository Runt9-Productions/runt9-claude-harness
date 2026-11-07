---
title: Watcher Plugin
type: note
permalink: projects/watcher-plugin/overview
tags:
- watcher
- mods
- board
- model-judge
status: complete
opened: '2026-11-05'
---

# Watcher Plugin

Builds the `watcher` plugin (issue #35): a mod in every session that has a model read what the session does, nudge
the agent when the work drifts, and flag to the owner what the owner should know. The mechanism is code and the
checks are short prose files, so a new check needs no code change. It ends when the plugin merges with its first
checks, board's opt-in for answers a plugin keeps, and the README describing both.

## Where it stands

- [status] Complete: the watcher plugin ships with its 15 checks, and board keeps the answers to a plugin's own
  decisions; the platform facts it measured are in the plugins domain notes.

## Goal

- A frame that captures each session's activity, decides when the judge looks, batches every check subscribed to
  that moment into one Haiku call, and delivers each finding as a nudge the agent reads, a board decision for the
  owner, or both.
- Checks as Markdown files: shipped with the plugin, added per repository, and added or replaced per machine.
- Shared state across sessions on the machine, under per-session keys, which other watchers read.
- Security stays with auto mode, permission rules and the sandbox; the watcher adds only what those cannot see.

## Designs ruled out

- Deterministic security checks (a refusal followed by the same action another way, git safety rules, credential
  paths): they duplicate the auto-mode classifier, which reads every tool call.
- Parsing transcript files as the primary source: the format is internal and changes between releases, and a
  process outside the session has no route to the owner that a mod lacks.
- OpenTelemetry to a local collector: it needs a collector process, `safety_event` is no longer sent, and a mod sees
  more of each refusal.
- Observer agents as the judge for now: they attach only to agent types declared in `.claude/agents/`, never to a
  plugin's agents, and to the main session only when it runs as a declared agent; they stay a later option for
  teammates.
- `$.model.fork` as the judge: it reads the conversation in its own context, so the judge anchors on the agent's
  reasoning the way self-review does.
- Desktop notifications: not wanted; the board and toasts are the channels.
- The model relaying "useful" and "noise" answers through a watcher tool: it costs the model a turn per answer and
  depends on the model doing it, so board gains an opt-in for answers a plugin keeps.

## Documents

- [[Watcher Plugin Checklist]]: the units of work and which is live
- [[Watcher Plugin Decisions]]: rulings taken and questions still open
- [[Watcher Plugin Spec]]: the per-file map, the check format and the draft issue text
- [[Watcher Plugin Estimate]]: the size, in files and lines

## Relations

- depends_on [[Plugin Platform]]
- depends_on [[Guardrails]]
- see_also [[Watcher Plugin Checklist]]
- see_also [[Watcher Plugin Decisions]]
- see_also [[Watcher Plugin Spec]]
- see_also [[Watcher Plugin Estimate]]
