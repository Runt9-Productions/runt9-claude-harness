# Lens: correctness

Checks whether a diff's code does what it is meant to do on every path it can take (wrong results, crashes, paths that silently do nothing, mismatched units or orderings, two sides of one handoff that disagree), and never judges design, style, security or leaks.

## The question

Does the changed code do what it is meant to do, on every path it can take?

## Before the diff

Read "What ships, and why a defect is expensive" and "Fragile spots CI does not catch" in
`.claude/code-review-profile.md`. Take what the code is meant to do from the pull request description, the docs the
diff changes and the code's own names and docs, and test each against the others.

## In scope

- **Wrong results.** A value computed wrongly: an off-by-one, a wrong operator, a wrong default, rounding in the wrong
  place, a condition that is inverted or misses a case.
- **Paths that break.** The first run, empty or missing state, an error from a call the code makes, a timeout, an
  input at a boundary. A path that throws, or quietly does nothing, where the feature needs it to work.
- **Unchecked results.** A call whose failure is ignored, so the code carries on with an empty or wrong value.
- **Handoffs that disagree.** Two pieces of the change, or the change and code it talks to, that each assume
  something different about one thing: a file's place or shape, units, an encoding, an ordering, a key.
- **State over time.** State that grows without bound, is never cleared, is written twice, or is read before it is
  written.

## Out of scope

Hostile input and guards that can be got past belong to `guard-security`; names, structure and style to
`code-health`; code that could be removed to `simplification`; whether tests can fail to `test-quality`. Report one of
those only when it also makes the code give a wrong result.

## How far to read

Follow each changed value from where it is made to where it is used, across files: the callers, the callees, and the
other side of every file, process or message the change hands data to. Every claim rests on code you opened. When
reading cannot settle a path, say what would: a command, an input to try.

## Severity

Every finding names the input or state that goes wrong and what happens then. A worry with no such input is an open
question.

Critical when the feature's main path gives a wrong result or breaks under normal use. High when an ordinary but
less common path does (first run, an error, a worktree, an empty state). Normal for a path only an unusual setup
reaches. For everything else, use the profile's "Severity calibration".
