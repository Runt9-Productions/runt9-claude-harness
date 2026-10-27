---
name: test-review
description: Judges whether existing tests earn their place (each name claims only what it asserts, the scenario can really happen, a wrong implementation would fail it, no other test already catches the same defect), proves each verdict by breaking the code under test, fixes the tests and reports what changed. Use for "/test-review", "review my tests", "are these tests any good", "are these tests meaningful", "do we have too many tests", "are any of these redundant".
argument-hint: "[<test file or directory>...]"
context: fork
allowed-tools: Bash, Read, Agent
---

# /test-review

Arguments: `$ARGUMENTS`

This complements `/code-review`. That skill looks for defects in production code; this one takes production code as
given and asks whether the tests over it are worth having.

It runs in a forked context because the caller usually wrote the tests, and a verdict reached in the author's session
inherits the author's view of them. Only your final message leaves the fork, so put the whole result in it.

## 1. Read the profile

Read `.claude/test-review-profile.md`. If it does not exist, stop and say so.

## 2. Find the scope

- **Paths given**: each file as given, and for each directory the test files under it, matched against the profile's
  test kinds.
- **No paths**: every test file changed against the merge base with the profile's default branch, plus every
  uncommitted one, untracked files included one by one.

For no paths, fill in the profile's default branch and every pattern in its test kinds' Files column, then run:

```bash
set -euo pipefail
branch='<default branch>'
patterns=(':(glob)<pattern>')   # one entry per pattern, each prefixed with :(glob)
base=$(git merge-base HEAD "$branch")
{
    # Committed, staged and unstaged changes against the merge base; deleted files have nothing to review.
    git diff -z --name-only --diff-filter=d "$base" -- "${patterns[@]}"
    # Untracked files one by one, including each file inside an untracked directory.
    git ls-files -z --others --exclude-standard -- "${patterns[@]}"
} | sort -zu | tr '\0' '\n'
```

An empty scope ends the run with that message.

## 3. Match references

Map each scoped file to a reference file through the profile's reference table, and confirm each reference exists
with `test -f`. Do not read them; that is the reviewer's job, and reading them here would put their contents in your
judgment instead of its.

A scoped file that matches no reference is still reviewed, and the report lists it as a gap. If no file matches any
reference, the patterns are more likely wrong than the files; check them against the profile before going on.

## 4. Check the tree

List production files with uncommitted changes:

```bash
git status --porcelain -uall
```

Any entry that is neither a test file nor one of the profile's helpers is production. The reviewer breaks production code on purpose
and has to restore it. For a clean file `git checkout` restores it; for a dirty one that would destroy uncommitted
work, so the reviewer must copy it aside first and restore from the copy.

## 5. Spawn the reviewer

Spawn one `test-reviewer` with `run_in_background: false`, and without `model`. Split the scope across more than one
only when the production code behind it is too much for one reviewer to read whole.

The prompt holds only:

- the scoped files;
- the reference files they map to, and the profile's path;
- for each test kind in scope, the run command and how to read its result, from the profile;
- the dirty production files from step 4, with the instruction to back each up before changing it and restore it from
  the backup;
- the rule: fix the tests, report production defects without fixing them, and leave production code exactly as it was
  found.

Add nothing about what you expect it to find.

## 6. Report

Relay the reviewer's result, keeping:

- each test's verdict, with the criteria it met or failed;
- the findings;
- the forced-failure output each verdict rests on;
- every judgment call, including each deletion and why;
- the real test counts before and after, from actual runs;
- production defects found and left alone;
- scoped files that matched no reference;
- the output of `git status --short` at the end.

A result with no findings still shows what was checked: which tests, which breaks, which runs.
