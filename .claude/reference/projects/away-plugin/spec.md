---
title: Away Plugin Spec
type: note
permalink: projects/away-plugin/spec
tags:
- away
- mods
- sandbox
---

# Away Plugin Spec

The per-file map for issue #67 and the issue text reconciled with the rulings in [[Away Plugin Decisions]].

## Behaviour

`plugins/away/README.md` is the authority on what the plugin does: the mode table, switching, the continuation,
permission prompts, the ceiling handoff, the return report and the sandbox. This note keeps only the engine choices
the README does not state, each with its reason.

- The mode is rebound on a change of session id, which resets `$.state` with no `session.start`.
- The continuation, the return report and the ceiling handoff are started from a `$.clock.after` timer, since a
  prompt or command started inside `command.run` or `turn.complete` waits on the turn the hook holds.
- A board tool's own permission prompt is refused without a post, since each post is itself a board tool call.

## Files

| File | What it holds |
|---|---|
| `plugins/away/.claude-plugin/plugin.json` | name `away`, version `0.1.0`, author, `types`, `dependencies: ["board", "handoff"]` |
| `plugins/away/hooks/hooks.json` | the one module |
| `plugins/away/types/index.d.ts` | the `away` state keys and `AttentionMode` |
| `plugins/away/hooks/register.tsx` | every hook; atoms declared in the file that reads them |
| `plugins/away/hooks/board-posts.ts` | posting refused prompts and auto mode denials to the board |
| `plugins/away/hooks/sandbox-hold.ts` | the sandbox hold: writing, sharing and putting back the local settings' sandbox keys |
| `plugins/away/hooks/settings-file.ts` | pure JSON edit of the local settings, never touching `$` |
| `plugins/away/hooks/register.test.ts` | kit tests at the boundaries of each table row |
| `plugins/away/README.md` | the table, the sandbox gap, the contracts it relies on |
| `.claude-plugin/marketplace.json` | the entry |
| `.claude/code-review-profile.md` | away's row: it relies on what `read_board` lists |
| `plugins/board/README.md` | the same contract from board's side |

## Draft issue text

Approved with the spec. Three edits to the posted issue body:

1. The "Per mode" bullet's questions clause becomes: "questions posted as a board decision (while present, with the
   context a reply would give), or posted with a recommended option and proceeded on when reversible".
2. The sandbox bullet becomes: "While away, the mod writes `sandbox.enabled: true` into the session root's
   `.claude/settings.local.json` (local settings override user settings per key, so the user's sandbox config
   applies) and puts the earlier value back when the last session holding it leaves away. Edit and Write under
   `~/.claude` are not sandboxed; they are Claude Code protected paths, and the README says what each permission mode
   does with them. Making 'sandbox while away' its own option can follow."
3. The last acceptance criterion becomes: "Harness writes while away are stopped by the sandbox, not by the mod."

## Relations

- part_of [[Away Plugin]]