---
title: Bootstrap Split Estimate
type: note
permalink: projects/bootstrap-split/research/estimate
tags:
- bootstrap
- estimate
---

# Bootstrap Split Estimate

**Moderate, and mechanical.** Production: `bootstrap.py` falls from 672 lines to about 100, and 11 new modules hold
600 to 680, a net rise of 40 to 110 lines from imports and module docstrings. Tests: 2 to 5 lines in the fixture.
Docs: 6 to 12 lines across `CLAUDE.md`, `.claude/code-review-profile.md` and one knowledge base note. Files: 11 new,
4 edited. Rests on: a move with function bodies unchanged, and the module map in [[Bootstrap Split Spec]]. The cost
lies in keeping every name reachable without a cycle, not in new logic.

## Comparison

da5ad9f moved the leak review out of `harness/githooks/pre-push` into `harness/leak-scan/review.sh` (11 files, 295
added, 141 removed). This one moves four times as much code but adds no behaviour and no new test.

## Risks

- An import cycle between the helper modules and the component modules, which shows only when the script runs.
- `functools.cache` on a function reached through two module paths would run twice; each lives in one module, so
  it holds as long as nothing re-exports them.

## Not verified

- None left. ruff's import sorting treats `bootstrap` as first-party with `ruff.toml` unchanged: `ruff check` with
  CI's flags passes on the built branch.

## Relations

- part_of [[Bootstrap Split]]
- see_also [[Bootstrap Split Spec]]
