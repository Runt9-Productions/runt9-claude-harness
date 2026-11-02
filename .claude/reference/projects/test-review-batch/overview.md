---
title: Test Review Breaks
type: note
permalink: projects/test-review-batch/overview
tags: [test-review, cost]
status: implementation
opened: "2026-10-31"
---

# Test Review Breaks

Issue #55: the test reviewer proves each verdict by breaking production code and running the suite, and a review's
cost grows with turns times context, since every turn re-reads the whole context. The project measured reviewer
variants on suites graded by the mutants they catch, and ships the one that kept the gain at the least cost: breaks
drawn from the spec's rules and made in place, a skill that forks straight into the reviewer, and medium effort. The
engineer agent gains the testing lines measured beside it. It ends when that version is reviewed and merged.

The pull request also carries a rebuilt `lens-review`, measured the same way on review benchmarks: the skill forks
straight into one reviewer agent, which picks its lenses, reads each lens file it picked and writes the graded report
itself, with no coordinator and no panel of agents. In a repository the agent is
`.claude/agents/lens-review/lens-review.md` and each lens a frontmatter-less file in `reference/` beside it.

Designs ruled out:

- **A bundled script running every break in its own copy of the tree.** Built and measured: the same gain as breaking
  in place, at no lower cost, so it was removed.
- **The reviewer writes its own script each review.** It pays output tokens every time, and a bug in an untested
  script gives a false verdict that reads like a true one.
- **A coordinator turn that spawns the reviewer.** It was a quarter or more of a medium-effort run's cost.
- **A Sonnet reviewer.** Cheaper for the same gain, but it added three times the test cases.
- **Cutting the reviewer's fixed starting load** (system prompt, tools, loaded instructions). A separate issue, #86.
- **A lens-review panel of one agent per lens, with a deep pass.** Replaced by the single reviewer holding every lens.

## Where it stands

- [status] test-review and lens-review are built, checked on a planted-defect bench, test-reviewed and lens-reviewed;
  the review fixes and the reviewer guide are next
- [trap] The pre-push gate reads `public-leak.md` from the default branch at the path its installed version knows, so
  `bootstrap.py harness` runs right after this pull request merges: an installed harness 0.1.18 refuses every push
  before the merge, and 0.1.17 refuses every push after it

## Documents

- [[Test Review Breaks Checklist]]: the units of work and which is live
- [[Test Review Breaks Decisions]]: rulings taken and questions still open
- [[Test Review Breaks Spec]]: what the plugin ships and the per-file map

## Relations

- see_also [[Test Review Breaks Spec]]
