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
  refusing each write #superseded (owner, 2026-10-30; replaced by the sandbox being on only while away)
- [decision] The sandbox is on only while away; distracted leaves it as the settings set it, and leaving away for
  either mode releases this session's hold (owner, 2026-10-31)
- [decision] The mod turns the sandbox on by writing `sandbox.enabled: true` into the session root's
  `.claude/settings.local.json` and puts back the value it found on the return to present; the rest of the sandbox
  config comes from the user's settings, since a local key overrides only that key (owner, 2026-10-31)
- [decision] Edit and Write calls under `~/.claude` are left to Claude Code's protected-path handling (prompted in
  default and acceptEdits, so refused while away; sent to the classifier in auto mode), and the README states that gap
  per permission mode; the mod adds no guard or deny rules (owner, 2026-10-31)
- [decision] Sessions sharing one checkout share its local settings file, so the mod tracks per root which sessions
  hold the sandbox on, restores the earlier value only when none does, and a `/mode present` typed there clears holders
  left by a session that died away (owner, 2026-10-31, with the spec)
- [decision] A session records which root's sandbox it holds and releases it there, so a `/cd` or worktree move while
  away does not leave the old root sandboxed (owner, 2026-10-31)
- [decision] An away session whose root differs from its recorded one moves its hold to the new root at the main
  loop's next model request (`turn.step`), so a move inside a turn is covered too, at one store read per request while
  away (owner, 2026-10-31)
- [decision] Each mode change appends a hidden row with the mode's rules rather than a system prompt section (owner,
  issue #67)
- [decision] After a compaction the rules are re-sent in distracted and away only, never in present (owner,
  2026-10-31)
- [decision] Present mode also posts questions as board decisions, with the context a reply would normally give
  (owner, 2026-10-31)
- [decision] The board decisions posted for a refused permission prompt or an auto mode denial carry no recommended
  option, so each is judged cold (owner, 2026-10-31)
- [decision] The automatic handoff fires at handoff's `ceilingPercent`, not at a number of away's own (owner, issue
  #67)
- [decision] Plugins with a contract between them name each other in `dependencies` (owner, 2026-10-24)
- [decision] Kit tests cover the README's mode table at its boundaries only (owner, 2026-10-31, with the spec)
- [decision] CI's mod type-check step also loads each plugin named in a plugin's `dependencies`, in this pull request
  (owner, 2026-10-31)
- [decision] The edit scope is `plugins/away/**`, `.claude-plugin/marketplace.json`, away's row in
  `.claude/code-review-profile.md`, the matching line in `plugins/board/README.md`, this project, the sandbox fact in
  [[Guardrails]], the type-check step in `.github/workflows/ci.yml`, and a note in `.claude/reference/domains/plugins/`
  on two copies of one plugin (owner, 2026-10-31)
- [decision] The edit scope also covers what goes stale without a matching edit: `mod-ci.md` and the Scope line of
  the development process note, which list `ci.yml` as a source, and handoff's contract row, its README line and a
  Mirrors row in the review profile, which named state away does not read or a copy nobody tracked (owner,
  2026-10-31)

## Open Questions

- [question] None open.
