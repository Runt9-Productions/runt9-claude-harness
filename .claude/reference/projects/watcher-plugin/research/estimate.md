---
title: Watcher Plugin Estimate
type: note
permalink: projects/watcher-plugin/research/estimate
tags:
- watcher
- estimate
---

# Watcher Plugin Estimate

## Headline

**Large.** About 1,100 to 1,600 production lines of TypeScript and 1,000 to 1,500 test lines, plus 200 to 300 lines
of check and judge prose and 450 to 650 lines of docs, in 32 to 38 files. Scope: the frame, 16 checks, and the board
opt-in so a plugin keeps the answers to its own decisions. Much of the real cost is not code: tuning the judge prompt
and each check's wording until findings are rare and right, which only real sessions show.

## Existing pieces

- Posting to the board from a mod: `plugins/away/hooks/board-posts.ts:51` (`postDecision` through `$.tool.call`).
- Hidden message the model reads: `plugins/away/hooks/register.tsx:228-238` (`$.session.append`), and per-loop
  delivery with `agentId` in `plugins/teammate-delivery/hooks/register.ts:153-156`.
- Agent roster polling: `plugins/board/hooks/register.tsx:60` (`$.clock.every`), status and `parentId` reads in
  `plugins/away/hooks/register.tsx:288-299`.
- Per-session keys in `$.store`: `plugins/board/hooks/persistence.ts:84-96`.
- Telling the main loop from a plugin's own call: `next.origin`, `plugins/board/hooks/register.tsx:67`.
- Board's answer path, which a posting plugin cannot use today: `plugins/board/hooks/decisions.ts:252` (`sendAnswer`)
  and `:270` (`deliver`), handler at `plugins/board/hooks/register.tsx:132` (no `next`, so no origin).

## Changes

| Piece | Files | Production | Test | Notes |
|---|---|---|---|---|
| Check loader: frontmatter, three locations, precedence (machine-local, repository, shipped) | `hooks/checks.ts` | 120-180 | 120-180 | Parsing without a YAML library; malformed file reported, not fatal |
| Event capture and digest: tool calls, results, refusal kind (`tool.check`), replies, user messages, per-agent buffers, stripping by each check's `reads` | `hooks/digest.ts` | 220-320 | 200-300 | Size caps per item and per digest |
| Triggers and one batched judge call per trigger: turn end, refusal, teammate idle, compaction, commit or push | `hooks/judge.ts`, `hooks/register.tsx` | 220-320 | 200-300 | Structured answer per check, confidence bar, `$.model.complete` on Haiku |
| Noise control and feedback: cap per agent per hour, dedupe, useful and noise counts | `hooks/quiet.ts` | 80-130 | 100-150 | |
| Delivery: nudge as observation with evidence, the lead receives teammate nudges, every flag a board decision with three answers, Send to session | `hooks/deliver.ts` | 140-200 | 150-220 | Depends on the board change |
| Shared state: per-session summary line, files changed, findings; input for the overlap check | `hooks/shared.ts` | 100-160 | 100-150 | Per-session keys |
| Secret pattern match for the secret check | `hooks/secrets.ts` | 30-60 | 40-60 | Own small pattern list; the harness scan is not available to a plugin at run time |
| Judge prompt and 16 checks | `checks/*.md`, `judge.md` | 200-300 prose | | 1 to 2 sentences per check plus frontmatter |
| Board opt-in for kept answers | `plugins/board/hooks/{register.tsx,tools.ts,decisions.ts,test-support.ts,decisions.test.ts}`, `types/index.d.ts`, `README.md` | 30-55 | 35-60 | Board version rise; contract row in `.claude/code-review-profile.md` |
| Plugin shell | `.claude-plugin/plugin.json`, `hooks/hooks.json`, `types/index.d.ts`, `local.example/`, marketplace entry | 40-70 | | |
| README | `plugins/watcher/README.md` | 120-180 | | |
| Knowledge base | plugins domain note (refusal kinds, observer agents, store), project files | 300-450 | | |

## Comparison

The away plugin (#80, `15e18f3`): 30 files, 2,299 lines added, of which about 910 production TypeScript and 836 test
lines, plus 278 in its knowledge base project. Board (#54, `0991314`): 22 files, about 2,000 production and 1,360
test lines. The watcher sits between them in code. It differs in depending on model output, which kit tests can only
stub, so its tests check the frame's handling of answers, not the judgments themselves.

## Risks

- Judgment quality: Haiku may raise too much or too little. The frame can be right and the product still noisy;
  wording is tuned after the merge, with the noise counts.
- Cost per turn: one Haiku call per trigger per agent. A long digest on a busy teammate team multiplies it.
- Injection from the watched session into the judge; mitigated by each check's `reads` and by stripping.
- `$.model.complete`'s default `maxTokens` of 1024 may be too small for 16 structured answers on one trigger.

## Not verified

- In-process teammate rows reaching `session.append` (needs an interactive session). If they do not, the stalled-teammate check falls back
  to the roster and `TeammateIdle`: small effect on lines.
- How the kit test engine handles `$.model.complete` (a stub, or a refusal). If it cannot be stubbed, judge tests
  move behind an injected function: +50 to 100 production lines.
- Another plugin's `state.set` hook firing on board's writes, live. If it does not, board needs an event instead
  (a board event): +20 to 40 lines.
- The kit types on 2.1.318 versus the 2.1.316 copy read so far.

## Questions that move the estimate

- Whether any check needs a stronger model than Haiku: a per-check `model` field is already in the frontmatter, so
  lines barely move; cost does.

## Actual

- 62 files against the base: 22 production files (+2,195 / -25), 9 test files (+1,180 / -1), 31 prose files (+956 /
  -25: the 16 checks, the judge prompt, both READMEs, examples and the knowledge base), plus one CI line.
- Missed: production ran past the range because the review round added hardening (record bounds that never go blind,
  owner-only edits of kept decisions, fenced evidence, redaction of every input, carrying the entry over a `/clear`);
  the file count missed that 16 checks are 16 files.

## Relations

- part_of [[Watcher Plugin]]
