---
title: Leak Review Read Coverage Estimate
type: note
permalink: projects/leak-review-read-coverage/research/estimate
tags: ["leak-scan", "estimate"]
---

# Leak Review Read Coverage Estimate

**Small.** Production 20 to 35 lines changed over 4 files, tests 30 to 50 lines over 2 files, knowledge base 40 to 60
lines over 6 files. It assumes the stream-json design in [[Leak Review Read Coverage Decisions]].

| Piece | Files | Lines | Notes |
|---|---|---|---|
| Output and coverage check | `harness/leak-scan/review.sh` | +15 to 25, -10 | stream-json flags, result line pulled out, `read` dropped from schema and request, coverage walk in jq |
| Docs | `harness/githooks/README.md`, `.claude/code-review-profile.md` | 2 to 6 | both describe the self-report |
| Version | `harness/harness.json` | 1 | 0.1.23 to 0.1.24 |
| Stubs and tests | `harness/githooks/test_pre_push.bats`, `harness/leak-scan/test_review_text.bats` | +30 to 50, -12 | both fake `claude` emit stream-json; a gap test and a never-opened test |
| Knowledge base | this project, a new `domains/development-process/leak-review.md`, `domains/development-process/overview.md`, `README.md` | 40 to 60 | the overview gains one relation |

## Existing pieces

- The check: the loop over `inputs` in `harness/leak-scan/review.sh:169-177`, comparing the `read` report with `wc -l`.
- Its only callers: `harness/githooks/pre-push:189` and `harness/leak-scan/review-text.sh:32`, which read nothing but
  the exit status and stderr, so the output format is private to `review.sh`.
- Both bats files stub `claude` and print `{"structured_output": ...}` with a `read` list built from `wc -l`
  (`harness/githooks/test_pre_push.bats:29-58`, `harness/leak-scan/test_review_text.bats:15-34`).

## Comparison

f474499 (proxy variables for the leak review, #45) changed `review.sh`, one bats file, the githooks README and
`harness.json`: 4 files, 13 added, 8 removed. This change touches the same files plus the second bats stub and the
knowledge base, and its tests carry more of the weight.

## Not verified

- The shape of `tool_use_result` for Read is not documented per tool; the Agent SDK reference types it as `unknown`
  and says it holds the tool's structured output. Measured once on Claude Code 2.1.322. A change of shape fails every
  review closed (exit 2), so it is loud, not silent.
- Whether Read ever reports a truncated read in the same shape (a token-capped call errors instead, which leaves no
  `file` object). If it does, the coverage walk still counts only the lines reported.
