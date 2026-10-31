---
title: Test Review Batch Breaks
type: note
permalink: projects/test-review-batch/overview
tags: [test-review, cost]
status: implementation
opened: "2026-10-31"
---

# Test Review Batch Breaks

Issue #55: the test reviewer proves each verdict by breaking production code and running the suite, and each break
has cost several model turns (edit, run, read, restore). A review's cost grows with turns times context, since every
turn re-reads the whole context, so this project moves every break into one bundled script run. It ends when the
reviewer runs its breaks in batches and a before/after measurement of one fixed suite is recorded on the pull request.

Designs ruled out:

- **The reviewer writes its own script each review.** It pays output tokens every time, and a bug in an untested
  script gives a false verdict that reads like a true one. The bundled script takes only data.
- **Two breaks in one copy.** Out of scope on #55: breaks would see each other.
- **Cutting the reviewer's fixed starting load** (system prompt, tools, loaded instructions). A separate issue, so the
  measurement here shows what batching alone saves.

## Where it stands

- [status] Built; the after measurement of the fixed suite is next

## Documents

- [[Test Review Batch Breaks Checklist]]: the units of work and which is live
- [[Test Review Batch Breaks Decisions]]: rulings taken and questions still open
- [[Test Review Batch Breaks Spec]]: the script's interface and the per-file map

## Relations

- see_also [[Test Review Batch Breaks Spec]]
