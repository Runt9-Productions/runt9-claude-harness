---
title: Test Review Batch Breaks Spec
type: note
permalink: projects/test-review-batch/spec
tags: [test-review, cost]
---

# Test Review Batch Breaks Spec

The settled design for #55. The rulings behind it are in [[Test Review Batch Breaks Decisions]].

## The script

`plugins/test-review/skills/test-review/scripts/run_breaks.py`, run from inside the repository under review:

```
run_breaks.py --profile <profile> --kind <kind> --breaks <file.jsonl> --out <dir> [--jobs N] [--timeout S] <test path>...
```

- **Break file:** one JSON object per line with exactly `id`, `file`, `old`, `new` and `expect` (the test names the
  break should turn red). Unknown keys, duplicate ids, a `file` that is not one of the listed files the copies hold
  (or is a symlink), `old` equal to `new`, and an `old` that matches the working-tree file zero or several times are
  refused with exit 2 before anything runs. `file` and the test paths are relative to the repository root, and
  `--profile` defaults to `.claude/test-review-profile.md` there. An
  empty file runs the baseline alone, which gives test counts.
- **Profile:** the fenced `toml` block under `## Batch runs`. `link` lists globs of ignored paths symlinked into each
  copy; `[kinds.<kind>]` gives `run` (an argv list, with the item `{tests}` replaced by the test paths), and `pass` and
  `fail` regexes, each with a `name` group, matched per output line after colour codes are stripped. An optional
  `subfail` regex, also with a `name` group, reads a later line that turns a named test red, such as pytest's summary
  line for a failed unittest subTest.
- **Copies:** one temporary copy per break plus a baseline, from `git ls-files --cached --others --exclude-standard`
  as the files stand on disk, symlinks kept as links. No `.git` goes in, so a suite that needs one shows as a baseline
  error. Copies are removed at the end; the checkout is never written.
- **Runs:** in parallel with a thread pool, default half the CPUs; each run in its own process group, killed on
  timeout.
- **Comparison:** baseline red tests are reported once and left out of every break's comparison. Per break: expected
  red but green, red but not expected, missing from the run, expected but already red in the baseline, or `expect`
  naming no baseline test. A run that could not
  start, timed out or matched no test lines is an error.
- **Output:** `<out>/results.tsv` (a row per test, a column for the baseline and each break) and `<out>/<id>.log` per
  run. Stdout: the baseline counts and failures, then only the breaks that differ or errored, then a one-line summary.
  Exit 0 when every break ran as predicted, 1 otherwise, 2 when refused.

## Per-file map

- `scripts/run_breaks.py` (new) and `scripts/test_run_breaks.py` (new): the script, and pytest tests driving it as a
  subprocess against a scratch repository with a synthetic suite.
- `agents/test-reviewer.md`: proof by forced failure becomes a batch written with predictions, one script run, the
  logs read in one call for failure reasons, follow-up batches for later assertions, and the same file rerun after the
  fixes. Restoring goes. Independent tool calls go in one turn.
- `skills/test-review/SKILL.md`: step 4 (dirty production files) goes, since the checkout is never broken; step 5
  passes the script's path and the profile's Batch runs kinds.
- `skills/test-review/references/profile-template.md`: a `## Batch runs` section with an example block.
- `.claude/test-review-profile.md`: this repository's Batch runs block for bats, mod kit and pytest.
- `plugins/test-review/README.md`, `.claude-plugin/plugin.json`: say what the script does; version 0.2.0.

## Relations

- part_of [[Test Review Batch Breaks]]
