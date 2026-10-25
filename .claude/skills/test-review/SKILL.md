---
name: test-review
description: Reviews existing tests for whether they are worth having (the name matches the assertions, the scenario is reachable, the test can actually fail, and it catches something no other test does), then fixes the tests and reports what it changed. Runs in a forked subagent and hands the review to a cold reviewer agent. Distinct from /code-review, which hunts bugs in production code. Use when the user says "/test-review", "review my tests", "are these tests any good", "do we have too many tests", or asks whether a suite is meaningful or redundant.
context: fork
allowed-tools: Bash, Read, Agent
argument-hint: "[path ...]"
---

# Test review

Answers one question per test: *if the behavior it claims to protect broke, would this test tell us, and would it be
the only one to?* Most bad tests pass forever, so a green suite is not evidence.

**This is not `/code-review`.** That skill hunts for bugs in production code. This one takes the production code as
it is and asks whether the tests are worth having. Run both; they do not overlap.

**This skill runs in a forked subagent (`context: fork`).** The caller is usually the agent that wrote the tests, and
relaying a review means choosing what to say about it; done in the author's context, that choice is filtered by what
the author meant. The fork starts with this file and its arguments, cannot ask the caller anything, and its final
message goes to the main session.

The review itself runs in a **cold agent**, `test-reviewer`, whose model and effort live in its own frontmatter. Never
pass a `model` parameter when spawning it. An author knows what a test was *meant* to check, so a test that encodes
the intention badly still reads correctly to them.

Two inputs come from the repository:

- **`.claude/test-review-profile.md`**: what counts as a test file, how each kind runs and how to read its real
  results, the reference file for each kind, and the repository's policy on which tests it wants at all.
- **The reference files the profile names**: the failure modes and rules specific to that kind of test in that
  repository. The generic criteria live in the reviewer's own definition.

Arguments for this run (empty means none): `$ARGUMENTS`

## Step 0: Read the profile

Read `.claude/test-review-profile.md`. If it does not exist, stop and say so: without it there is no way to run the
tests, read their results or know what the repository wants from them.

## Step 1: Determine scope

- **No argument:** every test file changed on this branch, including uncommitted work: `git status --porcelain` plus
  `git diff --name-only <default branch>...HEAD`, filtered by the profile's test-file patterns.
- **One or more paths:** exactly those files, or the test files under those directories.

If the scope holds no test files, stop and say so.

## Step 2: Resolve references

Match each scoped file against the profile's reference table, collect the distinct reference paths, and confirm each
file exists. Do not read them for the review: the reviewer reads them itself.

**A scoped file with no matching reference is a coverage gap, not a reason to skip it.** Review it on the generic
criteria and report the gap prominently, so a reference can be written. If no scoped file matched any reference,
check the profile's patterns before going on: that is far more often a resolution mistake than a real gap.

## Step 3: Spawn the reviewer

One `test-reviewer` (Agent tool, `subagent_type: test-reviewer`, `run_in_background: false`). Its prompt carries:

- The scoped test files.
- The reference paths it must read before reviewing, and the profile's path, whose suite policy it applies as
  criterion 4's scope rule.
- For each kind of test in scope, the profile's run command and how to read real counts from its output.
- Whether the working tree is clean. If any production file has uncommitted changes, name it and tell the reviewer to
  back it up and restore from the backup, since `git checkout -- <path>` would discard that work along with the
  forced failure.
- That it fixes test defects itself, reports production defects without touching them, and must end with no
  production file modified.

Nothing else. No account of what the tests are for, which ones are known to be fine, or what to focus on: each of
those tells the reviewer what not to question.

Split into more than one reviewer only when the scope is too large for one to read all the production code behind
it. Coherence beats parallelism here, because a weak pattern recurs across a file, and criterion 4 compares tests
with each other, which one reviewer seeing the whole scope does best.

## Step 4: Relay

End the run with:

- **A verdict per test:** keep, fixed, relabeled or deleted, with the criterion behind every change.
- **Every finding:** the test, the criterion it failed, and what was done.
- **The forced-failure experiments and the failure text each produced.** This is the evidence the review was real
  rather than a read-through.
- **Judgment calls**, each stated so it can be vetoed; every deletion is one.
- **Real test counts** before and after, from actual runs.
- **Production defects** the reviewer found and left alone.
- **Scoped files with no reference.**
- **`git status --short`** after the run, showing which files the reviewer changed.

Do not soften findings. A review that reports nothing must say what it checked and why it is confident, since "no
findings" is otherwise indistinguishable from a shallow pass.
