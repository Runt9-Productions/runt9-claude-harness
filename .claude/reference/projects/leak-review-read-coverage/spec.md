---
title: Leak Review Read Coverage Spec
type: note
permalink: projects/leak-review-read-coverage/spec
tags: ["leak-scan", "pre-push"]
---

# Leak Review Read Coverage Spec

The per-file map for issue #144, with the rulings in [[Leak Review Read Coverage Decisions]]. Line numbers are at
6fb3bf1.

## `harness/leak-scan/review.sh`

- Schema (`:114-128`): drop `read` from `required` and from `properties`.
- Request (`:130-134`): keep "Read every input file to its last line, in pages where it is long", drop the part asking
  for each file's name and last line in `read`.
- The `claude -p` call (`:155-158`): `--output-format stream-json --verbose`, writing `$scratch/stream.jsonl`. Then
  take the last line whose `type` is `result` into `$scratch/result.json`, so the "did not run" check and the jq calls
  after it stay as they are. Output that is not JSON lines counts as did not run.
- Coverage (`:169-177`): for each input, take every user line's `.tool_use_result.file` (an object; the StructuredOutput tool's line carries a string)
  whose `filePath` is the input's name, as a Read given a relative path reports it, or ends in
  `/<input>`, as ranges from `startLine` for `numLines`. Sort by start and walk them from line 1, extending the covered
  prefix while a range touches it. The first line not covered must be past `wc -l` of the input, or exit 2 with
  `leak-review: did not read line <n> of the <lines> lines in <input>`. An input with no Read result reports line 1.
- A comment over the walk states the mechanism: what the review read is taken from Read's own results, not from the
  model.

## Tests

- `harness/githooks/test_pre_push.bats`: the stub prints one user line per file in the bundle, as a Read result
  covering the whole file, then the result line. `short` stops one line before the end of `commits.patch`; a new `gap`
  mode returns `commits.patch` as two ranges with one line missing between them. `unstructured` prints a result line
  with no `structured_output`. The short-read test's expected message changes to the new wording; a gap test is added.
- `harness/leak-scan/test_review_text.bats`: the same stub shape. One test where the stub returns no Read result for
  `body.md`, which must exit 2.

## Docs and version

- `harness/githooks/README.md:44`: the refusal is for a review whose Read calls did not reach the end of every input.
- `.claude/code-review-profile.md:192-194`: `review.sh` asks for every input to be read to its last line and checks
  that against Read's results; nothing is reported.
- `harness/harness.json`: 0.1.24.

## Knowledge base

- New `domains/development-process/leak-review.md`, title Leak Review: the measured shape of Read's
  `tool_use_result` in stream-json (`startLine`, `numLines`, `totalLines`, `numLines` counting the empty line after a
  final newline), that one Read returned a 2,500-line file whole, and that `review.sh` fails closed on a changed
  shape. `measured_on` Claude Code 2.1.322, `sources` `harness/leak-scan/review.sh`.
- `domains/development-process/overview.md`: a `see_also [[Leak Review]]` relation back. Its claims about
  `review.sh:70-92` do not move, since the change starts at `:114`.
- `README.md`: a line for this project in the entry-point table.

## Draft ticket description

The ticket is #144 as posted, whose second technical option is the chosen design. Step 11 rewrites its description to
the result: the measured fields in place of the "untested" line, and the size-limit option dropped.
