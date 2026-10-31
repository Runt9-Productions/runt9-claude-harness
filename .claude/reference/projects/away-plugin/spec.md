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

## The modes

| | Present | Distracted | Away |
|---|---|---|---|
| Replies | normal | one or two lines; detail only when asked | a line at most, or none |
| Questions | a board decision, with the context a reply would give (D5) | a board decision | a board decision with a recommended option, proceeded on when reversible |
| Stops for | anything | anything, said in the reply's first line | a risk to the machine's or a repository's security or integrity, a change taking hours to unwind, a hard stop the owner named |
| A turn ending with work left | nothing | nothing | one continuation prompt |
| A permission prompt | normal | normal | refused and posted as a board decision |
| An auto mode denial | nothing | posted as a board decision | posted as a board decision |
| Context past handoff's ceiling | handoff's button | handoff's button | handed off and compacted unattended |
| Switching to present | nothing | nothing | a return report, if away since the last one |
| The Bash sandbox | as the settings set it | as the settings set it (D6) | on |

## Behaviour

- `/mode present | distracted | away`, bare `/mode` reports the mode; buttons for the other two modes in the band
  above the prompt, drawn inside `await next(e)`'s tree; the mode in the status line, empty while present.
- Mode kept per session in `$.store` (`session:<id>`, present not stored, the newest 20 kept); rebound on a change of
  session id, which resets `$.state` with no `session.start`; "Restored <mode> mode" toast on a restart or resume.
- Each change appends one hidden user row with the mode's rules; a compaction of the main loop marks the rules owed,
  and the next `turn.start` or main-loop `turn.step` re-sends them.
- Continuation: only when the main loop's turn made a model tool call (`next.origin.plugin === 'engine'`, no
  `agentId`), not after an abort or refusal, not while handoff's `phase` is not `idle`, not while a teammate the main
  loop spawned is mid-run, never for the continuation's own turn, and one at a time. A turn ended by an API error gets
  one continuation a minute later. Submitted from a `$.clock.after` timer, since `turn.complete` still holds the turn.
- Permission prompts while away: always `deny`, never `allow`, with the decision id in the message; a board tool's own
  prompt is refused without posting, which would loop. A teammate's decision says the answer goes to the lead.
- Auto mode denials (`classic.PermissionDenied`) while not present: posted once per loop, tool and bracketed
  category in a session; the options say only a permission rule can let it run.
- At handoff's `ceilingPercent` while away: a hidden row asks the running turn to end, then `/handoff` runs from a
  timer, which handoff treats as unattended. Not again until the fill has dropped below the ceiling.
- Return report on switching to present after an away: a prompt to read the board and report, in order, what waits
  on the owner, what was done, and what stalled.

## The sandbox toggle (D1)

- Switching to away writes `sandbox.enabled: true` into `<session root>/.claude/settings.local.json`, keeping every
  other key; a missing file counts as `{}`. A file that does not parse as a JSON object is left untouched and the
  owner gets a toast saying the sandbox is off.
- The store records per root (`sandbox:<root>`) the value found before (`true`, `false` or absent) and the session ids
  holding it on. Leaving away, for either other mode, removes this session; when no holder is left the earlier value is put back (the
  key removed if it was absent, and an emptied `sandbox` object removed with it) and the record deleted.
- `/mode present` typed while already present clears that root's record and puts the earlier value back, for a
  session that died away and left the sandbox on.
- A rebound session still away re-applies `enabled: true`, and a change of session id moves its
  holder entry to the new id only while the conversation it moved to is away; otherwise the old id's hold is released.
- The session's own record (`session:<id>`) names the root it holds, and leaving away releases under that root. The
  hold follows the session's root: at each main-loop `turn.step` (every model request, a turn's first included) while
  away, a root other than the one named moves the hold there, so a `/cd` or a worktree move, mid-turn included,
  neither leaves the old root sandboxed nor the new one unsandboxed.
- README states, per permission mode, what the sandbox does not cover (D2): Edit and Write under `~/.claude` are
  protected paths, prompted in default and acceptEdits (refused while away), sent to the classifier in auto mode,
  denied in dontAsk.

## Files

| File | What it holds |
|---|---|
| `plugins/away/.claude-plugin/plugin.json` | name `away`, version `0.1.0`, author, `types`, `dependencies: ["board", "handoff"]` |
| `plugins/away/hooks/hooks.json` | the one module |
| `plugins/away/types/index.d.ts` | the `away` state keys and `AttentionMode` |
| `plugins/away/hooks/register.tsx` | every hook; atoms declared in the file that reads them |
| `plugins/away/hooks/settings-file.ts` (optional) | pure JSON edit of the local settings, never touching `$` |
| `plugins/away/hooks/register.test.ts` | kit tests at the boundaries of each table row |
| `plugins/away/README.md` | the table, the sandbox gap, the contracts it relies on |
| `.claude-plugin/marketplace.json` | the entry |
| `.claude/code-review-profile.md` | away's row: it relies on what `read_board` lists |
| `plugins/board/README.md` | the same contract from board's side |

## Draft issue text

Approved (D3). Three edits to the posted issue body:

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