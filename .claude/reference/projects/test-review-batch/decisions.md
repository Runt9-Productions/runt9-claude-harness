---
title: Test Review Breaks Decisions
type: note
permalink: projects/test-review-batch/decisions
tags: [test-review, cost]
---

# Test Review Breaks Decisions

Rulings for #55. The scope comment on the issue holds the first eight in full.

## Decisions

- [decision] Standard-library Python 3.12 script in `plugins/test-review/skills/test-review/scripts/`, pytest tests beside it #superseded (owner, #55 scope; replaced by breaks made and restored in place, 2026-11-01)
- [decision] Break file is JSON Lines with an `id`, the production `file`, an exact `old` string and its `new` replacement; an `old` matching zero or several times is refused before anything runs #superseded (owner, #55 scope; replaced by breaks made and restored in place, 2026-11-01)
- [decision] Each break runs in its own copy of the working tree as it stands (tracked plus untracked not ignored), with ignored directories the profile names linked rather than copied #superseded (owner, #55 scope; replaced by breaks made and restored in place, 2026-11-01)
- [decision] Each batch also runs once unbroken, so a failing or flaky test is not read as caught #superseded (owner, #55 scope; replaced by breaks made and restored in place, 2026-11-01)
- [decision] The profile names each kind's run command and its pass and fail line patterns, and the script runs no other command #superseded (owner, #55 scope; replaced by breaks made and restored in place, 2026-11-01)
- [decision] The full result table goes to a file; parallel runs up to half the CPUs by default, with `--jobs` #superseded (owner, #55 scope; replaced by breaks made and restored in place, 2026-11-01)
- [decision] `test-reviewer.md` writes breaks as a batch and runs them through the script; the edit, run and restore steps on the checkout go, and the prediction is still written before the run #superseded (owner, #55 scope; replaced by breaks drawn from the rules and made in place, 2026-11-01)
- [decision] Measure one review of a fixed suite at a fixed commit, headless with `--output-format json`, before and after (owner, #55 scope)
- [decision] The suite measured is `harness/leak-scan/test_review_text.bats` at main 0e218d8 (owner, 2026-10-31)
- [decision] Each break carries its prediction as an `expect` list of the tests it should turn red, and stdout prints only the breaks whose result differs from the prediction, plus any that errored #superseded (owner, 2026-10-31; replaced by breaks made and restored in place, 2026-11-01)
- [decision] The agent definition tells the reviewer to put independent tool calls in one turn and to rerun the same batch file after its fixes #superseded (owner, 2026-10-31; replaced by the measured agent definition, which reruns the breaks after its changes, 2026-11-01)
- [decision] Cutting the reviewer's fixed starting load is a separate issue, #86 (owner, 2026-10-31)
- [decision] This project is written in the knowledge base rather than left on the issue comment (owner, 2026-10-31)
- [decision] The per-kind run command, patterns and linked paths live in a fenced TOML block under a "Batch runs" section of the profile rather than as table columns, since a regex's `|` breaks a Markdown table #superseded (owner, 2026-10-31; replaces the table columns in the earlier profile ruling; replaced by dropping the section with the script, 2026-11-01)
- [decision] The reviewer lists each rule the spec or documented contract states and makes one break per rule, the change a plausible wrong reading of it would make, since that matched the best gain measured at the lowest cost (owner, 2026-11-01)
- [decision] Breaks are made and restored in place and the in-copy script, its tests and its profile section are removed, since over six suites the script gave the same gain at no lower cost (owner, 2026-11-01)
- [decision] The skill forks straight into the reviewer with `context: fork` and `agent: test-review:test-reviewer`, since a coordinator turn was a quarter or more of a run's cost (owner, 2026-11-01)
- [decision] The reviewer runs on Opus at medium effort, since against high it cost about 45% less and took half the time for about one fewer mutant caught (owner, 2026-11-01)
- [decision] The reviewer does not run on Sonnet, since it added three times the test cases for the same gain (owner, 2026-11-01)
- [decision] The engineer agent, in this repository and in the delegation plugin's template, gains three lines on writing tests from the spec, as measured on the engineer definition (owner, 2026-11-01)
- [decision] lens-review runs as one reviewer agent at `.claude/agents/lens-review/lens-review.md`, each lens a file in `.claude/agents/lens-review/reference/<id>.md` with no frontmatter, since such a file is not loaded as an agent (owner, 2026-11-01)
- [decision] lens-review keeps its lens arguments: `auto`, with the profile's routing rows binding where they match, `default` for the profile's default lenses, or an id list (owner, 2026-11-01)
- [decision] `correctness` and `test-quality` join this repository's lenses (owner, 2026-11-01)
- [decision] The reviewer is the measured agent, untuned, on Opus with effort inherited (owner, 2026-11-01)
- [decision] The deep pass is dropped, with `principal-review` (owner, 2026-11-01)
- [decision] The plugin ships lens templates for `correctness`, `test-quality`, `code-health`, `simplification`, `staleness-and-debris` and `guard-security`; `public-leak` stays this repository's own lens (owner, 2026-11-01)
- [decision] The lens-review rebuild is folded into this pull request, on its branch (owner, 2026-11-01)
- [decision] With no lens argument, lens-review runs `auto`, since one reviewer has no panel cost to propose first (owner, 2026-11-01)
- [decision] The pre-push leak gate reads `public-leak.md` at the new path only, with no fallback to the old one, since the old path has no other users or copies (owner, 2026-11-01)
- [decision] The `correctness` lens owns behaviour and the approach alike, judged by whether the change delivers what its spec, issue or documented contract states; what a user might expect where nothing states it is not a defect, since a departure from what is stated ships something unintended (owner, 2026-11-01)
- [decision] `auto` ignores the profile's default lenses: it applies every lens whose routing row matches the change plus any the reviewer judges it needs, and this repository's `public-leak` row matches every change, since every merged line is public (owner, 2026-11-01)

## Open Questions

- [question] None open
