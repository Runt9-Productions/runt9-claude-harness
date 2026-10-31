---
title: Test Review Batch Breaks Decisions
type: note
permalink: projects/test-review-batch/decisions
tags: [test-review, cost]
---

# Test Review Batch Breaks Decisions

Rulings for #55. The scope comment on the issue holds the first eight in full.

## Decisions

- [decision] Standard-library Python 3.12 script in `plugins/test-review/skills/test-review/scripts/`, pytest tests beside it (owner, #55 scope)
- [decision] Break file is JSON Lines with an `id`, the production `file`, an exact `old` string and its `new` replacement; an `old` matching zero or several times is refused before anything runs (owner, #55 scope)
- [decision] Each break runs in its own copy of the working tree as it stands (tracked plus untracked not ignored), with ignored directories the profile names linked rather than copied (owner, #55 scope)
- [decision] Each batch also runs once unbroken, so a failing or flaky test is not read as caught (owner, #55 scope)
- [decision] The profile names each kind's run command and its pass and fail line patterns, and the script runs no other command (owner, #55 scope)
- [decision] The full result table goes to a file; parallel runs up to half the CPUs by default, with `--jobs` (owner, #55 scope)
- [decision] `test-reviewer.md` writes breaks as a batch and runs them through the script; the edit, run and restore steps on the checkout go, and the prediction is still written before the run (owner, #55 scope)
- [decision] Measure one review of a fixed suite at a fixed commit, headless with `--output-format json`, before and after (owner, #55 scope)
- [decision] The suite measured is `harness/leak-scan/test_review_text.bats` at main 0e218d8 (owner, 2026-10-31)
- [decision] Each break carries its prediction as an `expect` list of the tests it should turn red, and stdout prints only the breaks whose result differs from the prediction, plus any that errored (owner, 2026-10-31; replaces stdout listing every test that differs from the baseline)
- [decision] The agent definition tells the reviewer to put independent tool calls in one turn and to rerun the same batch file after its fixes (owner, 2026-10-31)
- [decision] Cutting the reviewer's fixed starting load is a separate issue, #86 (owner, 2026-10-31)
- [decision] This project is written in the knowledge base rather than left on the issue comment (owner, 2026-10-31)
- [decision] The per-kind run command, patterns and linked paths live in a fenced TOML block under a "Batch runs" section of the profile rather than as table columns, since a regex's `|` breaks a Markdown table (owner, 2026-10-31; replaces the table columns in the earlier profile ruling)

## Open Questions

- [question] None open
