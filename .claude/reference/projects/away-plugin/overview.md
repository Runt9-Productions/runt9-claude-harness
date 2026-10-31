---
title: Away Plugin
type: note
permalink: projects/away-plugin/overview
tags:
- away
- mods
- board
- handoff
- sandbox
status: implementation
opened: '2026-10-31'
---

# Away Plugin

Builds the `away` plugin (issue #67): a mod that lets the owner say how present they are (present, distracted or
away) and has Claude work accordingly, carrying on through permission prompts and a filling context window while
away. It ends when the plugin merges with its README's mode table backed by kit tests.

## Where it stands

- [status] Built, verified live and reviewed; its draft pull request (#80) waits on the owner's review.

## Goal

- A mod with three attention modes whose behaviour the mode table in `plugins/away/README.md` sets, which stops
  harness writes while away by turning the Bash sandbox on rather than by refusing them itself.
- Couple to `board` and `handoff` only through the contract rows in `.claude/code-review-profile.md`, adding away's
  own row: it relies on what `read_board` lists.

## Designs ruled out

- The mod refusing harness writes itself (a `tool.call` guard parsing each call's write targets): ruled out for the
  sandbox, because a guard reading command text misses shapes and can take a read of a harness path for a write.
- The rules as a system prompt section: a section change invalidates the cached conversation on every switch, so
  each change appends a hidden row instead.
- A `settings.read` hook answering `sandbox.enabled` from the mode: the engine requires that hook's answer to depend
  only on the settings layers, and re-merges only when a file or the loaded plugins change, so a mode change would not
  reach it.
- Desktop notifications while distracted: `PushNotification` delivers nothing while it judges the terminal active,
  and it judged an open terminal active when tried, so the board's flash on a new decision is the only alert.

## Documents

- [[Away Plugin Checklist]]: the units of work and which is live
- [[Away Plugin Decisions]]: rulings taken and questions still open
- [[Away Plugin Spec]]: the per-file map, the draft issue text and the engine choices the README does not state
- [[Away Plugin Estimate]]: the size, in files and lines

## Relations

- depends_on [[Guardrails]]
- see_also [[Mod CI Checks]]
- see_also [[Away Plugin Spec]]