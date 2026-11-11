---
title: Leak Review
type: note
permalink: development-process/leak-review
tags: [leak-scan, pre-push, stream-json, read-tool]
verified: 2026-11-11
coverage: partial
measured_on: "Claude Code 2.1.322, jq 1.7"
sources:
  - harness/leak-scan/review.sh
  - harness/githooks/test_pre_push.bats
  - harness/leak-scan/test_review_text.bats
---

# Leak Review

> **Scope.** How `harness/leak-scan/review.sh` decides that the `public-leak` review read every input, read on pull request #145: the input copy and `split_long_lines`, the `claude` call, the verdict extraction and the coverage walk in `review.sh`, and the `claude` stubs in `test_pre_push.bats` and `test_review_text.bats`. The Read result shape was measured by running `claude -p --restricted --tools Read --model haiku --setting-sources project --strict-mcp-config --no-session-persistence --output-format stream-json --verbose --json-schema <schema>` over a 3-line file, a 2,500-line file (66,393 bytes) and a 3-line file with no final newline, with a whole read of each and two paged reads, plus one whole read each of a file over Read's token cap and one over its size cap, and a Read called with a relative path, and the walk was run on that output and on hand-made lines. The `FileReadOutput` and `SDKUserMessage` lines come from the Agent SDK TypeScript reference, https://code.claude.com/docs/en/agent-sdk/typescript, fetched 2026-11-11. Not covered: a run with `--agent` and `--agents` or with the review's own model and effort, as `review.sh` runs it (the measurement used neither); a repeated Read of one file; the cache key, the lens and brief lookup, and the review's environment.

Read this before changing `review.sh`'s `claude` flags or its coverage walk, or the stubs that stand in for `claude` in its
bats tests. A shape the walk does not expect refuses every push, and a stub that drifts from the real shape tests a
stream that never occurs.

## Observations

- [fact] Each Read call's result is on a `type == "user"` line as `tool_use_result: {type: "text", file: {filePath, content, startLine, numLines, totalLines}}`, with `filePath` the path Read was given #measured
- [fact] `numLines` counts one more line than `wc -l`: the empty line after a final newline, so a 3-line file reads as `numLines` 4 and `totalLines` 4 #measured
- [fact] A file with no final newline reads with `numLines` equal to its line count, which is also `wc -l` plus one, since `wc -l` counts newlines #measured
- [fact] One Read with no offset returned the 2,500-line, 66,393-byte file whole, as `startLine` 1 and `numLines` 2501 #measured
- [fact] A paged Read reports `startLine` equal to the `offset` it was given (a 1-based line number) and `numLines` equal to the lines returned: offset 2000 and limit 50 gave 2000 and 50, and offset 2490 and limit 50 on that file gave 2490 and 12, ending on the empty line #measured
- [fact] With `--json-schema`, the StructuredOutput tool's result is a `type == "user"` line whose `tool_use_result` is the string `"Structured output provided successfully"`, not an object #measured
- [fact] The verdict is the `structured_output` object on the last `type == "result"` line, which `review.sh` takes with `last(inputs | select(.type == "result"))` (`harness/leak-scan/review.sh:156`) and refuses unless it is an object (`:158`) #measured
- [vendor] The Agent SDK types `tool_use_result` as `unknown` on `SDKUserMessage`: it is the tool's structured output, and its shape depends on the tool. Read's is `FileReadOutput`, a union discriminated on `type` (`text`, `image`, `notebook`, `pdf`, `parts`, `file_unchanged`), of which only `text` carries `startLine` and `numLines`.
- [vendor] A `file_unchanged` result carries only `filePath`.
- [fact] A whole read of a file over Read's token cap but under its size cap (2,300 lines, 201,293 bytes) returned `truncatedByTokenCap: true` with `numLines` 744 and `totalLines` 2301: `numLines` counts only the lines returned, so the walk counts the partial page and no more #measured
- [fact] A whole read of a file over Read's size cap (526,893 bytes, against 256KB) returned an error, a string `tool_use_result`, which the walk drops #measured
- [trap] The walk's `.tool_use_result | objects` (`harness/leak-scan/review.sh:176`) is what lets the StructuredOutput line's string through: without it jq stops with "Cannot index string with string" and the review exits 2 on every run #measured
- [trap] A result whose `filePath`, `startLine` or `numLines` is missing or of another type is dropped (`.file | objects`, `strings`, `select(all(type == "number"))`, `review.sh:176-178`), so a renamed or retyped field leaves no ranges and the review refuses at line 1 rather than passing. A `file_unchanged` result drops the same way and adds nothing #measured
- [trap] The ranges are sorted before the walk (`sort`, `review.sh:179`) because the walk extends coverage only from a range that starts at or before the first unread line: pages 3-5 then 1-2 walk to line 6 sorted and stop at line 3 unsorted #measured
- [fact] A Read called with an absolute `file_path` reports it as `filePath`, and one called with a relative `file_path` (`a.txt`) reports that same relative string, not the absolute path #measured
- [fact] `filePath` is matched when it equals the input's name or ends in `/` and the name, so a relative read counts and an input `a.txt` takes no range from `ba.txt` (`review.sh:177`) #measured
- [fact] A range that starts inside what was read extends it to the later of the two ends (`max`, `review.sh:180`), so a re-read of part of an input, sorted after a whole read, does not shrink what counts as read #measured
- [fact] The review passes an input when the walk's first unread line is past `wc -l` (`review.sh:174`, `:182`), so a real whole read, which ends at `wc -l` plus two, passes with a line to spare: the empty line Read adds #measured
- [trap] `wc -l` is the line count only because `split_long_lines`' awk ends every line, the last included, with a newline (`review.sh:46-60`). A bundle file left without a final newline makes `wc -l` one short, and a read that stops one line before the end then passes #silent-failure #measured
- [fact] An input that is empty after `split_long_lines` is left out of the bundle and of the walk (`review.sh:61-65`), so every input walked has at least one line.
- [trap] Both stubs report a whole read as `numLines` equal to `wc -l` (`harness/githooks/test_pre_push.bats:44-46`, `harness/leak-scan/test_review_text.bats:55`), one less than the real Read: the smallest value that passes, so a stricter bound in `review.sh` fails the tests, while a stub copied from the real shape would not.
- [fact] Only the `test_pre_push.bats` stub prints the StructuredOutput line with a string `tool_use_result` (`:59`) and pages one input out of order, the later page first, then re-reads its line 3 (`:49-57`), with `short` and `gap` modes that stop one line early and skip one line; the re-read is why a walk without `max` fails every test whose push passes the review. `test_review_text.bats` emits whole reads only, reads the file named in `~/unread` under a name that only ends in its own (`:48-49`), the one named in `~/unnumbered` with no `startLine` (`:50-51`) and the one named in `~/relative` by its bare name (`:52-53`).
- [fact] The `test_review_text.bats` stub reads its `--output-format` and `--verbose` flags: like the real `claude`, it exits 1 for stream-json without `--verbose` (`:36-39`), and for any other format it prints the result line with no Read results (`:44-46`), so a `review.sh` that drops either flag fails its tests

## Relations

- part_of [[Development Process]]
