---
title: Away Plugin Decisions
type: note
permalink: projects/away-plugin/decisions
tags:
- away
- sandbox
- board
- handoff
---

# Away Plugin Decisions

Rulings for building the `away` plugin. Facts about the sandbox and protected paths that outlive the project go in
[[Guardrails]].

## Decisions

- [decision] Harness writes while distracted or away are stopped by turning the Bash sandbox on, not by the mod
  refusing each write; making "sandbox while away" its own option can follow #superseded (owner, 2026-10-30; D6
  narrowed it to away only)
- [decision] D1: the mod turns the sandbox on by writing `sandbox.enabled: true` into the session root's
  `.claude/settings.local.json` and puts back the value it found on the return to present; the rest of the sandbox
  config comes from the user's settings, since a local key overrides only that key (owner, 2026-10-31)
- [decision] D2: Edit and Write calls under `~/.claude` are left to Claude Code's protected-path handling (prompted
  in default and acceptEdits, so refused while away; sent to the classifier in auto mode), and the README states that
  gap per permission mode; the mod adds no guard or deny rules (owner, 2026-10-31)
- [decision] Each mode change appends a hidden row with the mode's rules, re-sent after a compaction, rather than a
  system prompt section (owner, issue #67)
- [decision] The automatic handoff fires at handoff's `ceilingPercent`, not at a number of away's own (owner, issue
  #67)
- [decision] Plugins with a contract between them name each other in `dependencies` (owner, 2026-10-24)
- [proposal] Sessions sharing one checkout share its local settings file, so the mod tracks per root which sessions
  hold the sandbox on, restores the earlier value only when none does, and a `/mode present` typed there clears holders
  left by a session that died away (approved with the spec, D3)
- [proposal] Kit tests cover the README's mode table at its boundaries only (approved with the spec, D3)
- [decision] D5: present mode also posts questions as board decisions, with the context a reply would normally give
  (owner, 2026-10-31)
- [decision] D6: the sandbox is on only while away; distracted leaves it as the settings set it, and leaving away for
  either mode releases this session's hold (owner, 2026-10-31)
- [decision] D3: spec and issue text approved with D5 and D6 applied (owner, 2026-10-31)
- [decision] D4: edit scope is `plugins/away/**`, `.claude-plugin/marketplace.json`, away's row in
  `.claude/code-review-profile.md`, the matching line in `plugins/board/README.md`, this project, and the sandbox fact
  in the Guardrails note (owner, 2026-10-31)
- [decision] D7: after a compaction the rules are re-sent in distracted and away only, never in present (owner,
  2026-10-31)
- [decision] D8: CI's types step in `.github/workflows/ci.yml` also loads each plugin named in a plugin's
  `dependencies` with its own `--plugin-dir`, fixed in this PR; the edit scope widens to that step, which needs the
  owner's review (owner, 2026-10-31). The scope also covers `.claude/reference/domains/plugins/mod-ci.md`, which
  lists that workflow as a source and goes stale without a matching edit, and the Scope line of
  `.claude/reference/domains/development-process/overview.md`, which lists it too (lead, 2026-10-31)
- [decision] D9: the Plugin Platform note under `.claude/reference/domains/plugins/` records how a same-named plugin
  in the settings' `CLAUDE_CODE_PLUGIN_DIRS` interacts with `--plugin-dir`, and that
  `--settings '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":""}}'` drops the settings copy; in this PR, edit scope widened to
  that note (owner, 2026-10-31). The `--plugin-dir` copy is the one that loads, and the "another plugin of that name
  loads first" warning prints either way, so it does not show which copy was refused (lead, 2026-10-31)
- [decision] D10: a session records which root's sandbox it holds and releases it there, so a `/cd` or worktree move
  while away does not leave the old root sandboxed (owner, 2026-10-31). The hold also follows the move: at the main
  loop's next model request (`turn.step`), so a move inside a turn is covered too, an away session whose root differs
  from its recorded one moves its hold to the new root (lead, 2026-10-31, from the owner's answer)

## Open Questions

- [question] None open.