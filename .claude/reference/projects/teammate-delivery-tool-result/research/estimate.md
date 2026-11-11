---
title: Teammate Delivery Tool Result Estimate
type: note
permalink: projects/teammate-delivery-tool-result/research/estimate
tags:
- plugins
- estimate
---

# Teammate Delivery Tool Result Estimate

**Moderate.** 5 files changed, removals ahead of additions in production code.

| Piece | File | Lines | Notes |
|---|---|---|---|
| Hold and attach | `plugins/teammate-delivery/hooks/register.ts` | about 120 touched, net about -50 | the matching, the wake-up and the ending race go |
| Tests | `plugins/teammate-delivery/hooks/register.test.ts` | 150 to 250 changed, net about -50 | the kit's engine `$.session.append` call takes a full tool-result input |
| Docs | `plugins/teammate-delivery/README.md` | 20 to 30 | three sections |
| Version | `plugins/teammate-delivery/.claude-plugin/plugin.json` | 1 | |
| Knowledge base | `domains/agent-teams/mailbox.md`, `projects/watcher-plugin/decisions.md` | 5 to 10 | |

- No shipped plugin hooks `session.append` on the `tool-result` door. [[Rewriting Session History]] measured the same
  rewrite on the main loop, which is the closest prior work.
- Risks: the strict validator's warning on a gating `session.append` hook; a top-level block beside a
  `tool_reference` row, which the skip rule avoids rather than tests.
- Not verified: whether parallel tool calls arrive as one row or several. Attaching to the first row that passes the
  skip rule is right either way, so the numbers do not move.
- Keeping held messages across a reload was ruled out, which kept about 30 production lines, their tests and a probe
  out of the change.

## Relations

- part_of [[Teammate Delivery Tool Result]]
