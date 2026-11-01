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

Designs ruled out:

- **A bundled script running every break in its own copy of the tree.** Built and measured: the same gain as breaking
  in place, at no lower cost, so it was removed.
- **The reviewer writes its own script each review.** It pays output tokens every time, and a bug in an untested
  script gives a false verdict that reads like a true one.
- **A coordinator turn that spawns the reviewer.** It was a quarter or more of a medium-effort run's cost.
- **A Sonnet reviewer.** Cheaper for the same gain, but it added three times the test cases.
- **Cutting the reviewer's fixed starting load** (system prompt, tools, loaded instructions). A separate issue, #86.

## Where it stands

- [status] Built and staged on the pull request; the test review, lens review and reviewer guide are next

## Documents

- [[Test Review Breaks Checklist]]: the units of work and which is live
- [[Test Review Breaks Decisions]]: rulings taken and questions still open
- [[Test Review Breaks Spec]]: what the plugin ships and the per-file map

## Relations

- see_also [[Test Review Breaks Spec]]
