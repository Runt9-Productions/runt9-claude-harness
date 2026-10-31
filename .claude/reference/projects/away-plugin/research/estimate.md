---
title: Away Plugin Estimate
type: note
permalink: projects/away-plugin/research/estimate
tags:
- away
- estimate
---

# Away Plugin Estimate

**Moderate.** Production 600 to 720 lines of TypeScript plus 70 to 90 of README and config; tests 400 to 550 lines;
10 to 11 files, all new except three one-to-three-line edits. Rests on: one hooks module (or one module plus a pure
helper file), the mode table in [[Away Plugin Spec]] as the whole of the behaviour, and the protected-path gap accepted and documented rather than guarded. The cost is mostly in tests that drive timers and turn events through the kit, and in
measuring that turning the sandbox on takes effect live.

## Existing pieces

- handoff's contract side: origin check `plugins/handoff/hooks/register.tsx:297`, atoms `phase`, `isUnattended`,
  `ceilingPercent` at `register.tsx:11-17`, `ceilingPercent` rewritten each turn at `register.tsx:325`, typed in
  `plugins/handoff/types/index.d.ts`.
- board's contract side: `Posted D<n>` result at `plugins/board/hooks/decisions.ts:65`, flash at `decisions.ts:170`,
  `ENDED_STATUSES` at `plugins/board/hooks/activity.ts:240`, README section "The away plugin".
- Contract rows already listed: `.claude/code-review-profile.md:97-102`.
- The sandbox config away turns on: `harness/settings/guardrails-sandbox.json`, shipped with `enabled: false` into the
  user's settings.

## Changes

| Piece | Files | Lines | Notes |
|---|---|---|---|
| Scaffold | `plugins/away/.claude-plugin/plugin.json`, `hooks/hooks.json`, `types/index.d.ts`, `.claude-plugin/marketplace.json` | 45 | `dependencies` on board and handoff |
| Modes core: `/mode`, band, status, store and rebind on id change, rules row and re-send after compaction, return report | `plugins/away/hooks/register.tsx` | 260-300 | |
| Running while away: continuation, permission refusal posted to board, auto mode denials posted, handoff at the ceiling | same | 230-270 | |
| Sandbox toggle with per-root holders | same, or a pure helper beside it | 80-130 | |
| Tests | `plugins/away/hooks/register.test.ts` | 400-550 | timers via `mock.clock` |
| Docs and contracts | `plugins/away/README.md`, `.claude/code-review-profile.md`, `plugins/board/README.md` | 70-90 | board README is exempt from the version rise |

## Comparison

The handoff plugin (#53, a7bc862): 8 files, 380 production and 510 test lines, one hooks module driving timers and
turn events through the kit as away's will. Away's mode table has nine rows of behaviour, hence the larger production
estimate, and unlike handoff it drives two other plugins, so its tests stand in for both.

## Risks

- Turning `sandbox.enabled` on live: no note records it as measured. Verification measures it and adds the
  `#measured` fact to [[Guardrails]].
- Rewriting a JSON settings file the owner may also edit: a parse failure must leave the file untouched.
- oxlint's `await-thenable` misfires with `dependencies` declared (a known workaround exists).

## Not verified

- That the engine calls the mode table needs behave on 2.1.316 as handoff's do; tests will show drift. Up to 20% more
  test lines if the kit's timer handling differs from handoff's use of it.
## Actual

28 files against `main`. Away itself: 929 production lines of TypeScript in four modules (`register.tsx`,
`board-posts.ts`, `sandbox-hold.ts`, `settings-file.ts`) plus 31 of config and types, 836 test lines, and a 151-line
README. Production ran about 30% over the high end, and tests about 50% over. The estimate missed that the sandbox
needed a second key, a check of the settings sources above the local file and the deletion of a file away creates.
It also missed the knowledge base notes and the develop skill change that the branch carried.
