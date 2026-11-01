---
name: test-review
description: Judges whether existing tests earn their place (each name claims only what it asserts, the scenario can really happen, a wrong implementation would fail it, no other test already catches the same defect), proves each verdict by breaking the code under test, fixes the tests and reports what changed. Use for "/test-review", "review my tests", "are these tests any good", "are these tests meaningful", "do we have too many tests", "are any of these redundant".
argument-hint: "[<test file or directory>...]"
context: fork
agent: test-review:test-reviewer
background: false
allowed-tools: Bash, Read, Edit, Write
---

# /test-review

Arguments: `$ARGUMENTS`

You are reviewing the tests in scope below. Nobody who wrote them is in this conversation. Take production code as
given and judge whether the tests over it are worth having. This runs in the foreground because you break production
code on purpose, and nothing else may read or build the tree until you have put it back.

## 1. Read the profile

Read `.claude/test-review-profile.md`. If it does not exist, stop and say so, pointing at the template,
`${CLAUDE_PLUGIN_ROOT}/skills/test-review/references/profile-template.md`.

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

## 3. Read the references

Map each scoped file to a reference file through the profile's reference table and read each one that exists. A
scoped file that matches no reference is still reviewed, and the report lists it as a gap. If no file matches any
reference, the patterns are more likely wrong than the files; check them against the profile before going on.

## 4. Check the tree

List production files with uncommitted changes:

```bash
git status --porcelain -uall
```

Any entry that is neither a test file nor one of the profile's helpers is production and dirty. Copy each one aside
before your first break: restoring a dirty file from git would destroy uncommitted work.

## 5. Review

Review the scoped tests as your instructions describe, using each test kind's run command and result format from the
profile.

## 6. Report

End with the report your instructions describe, then the scoped files that matched no reference, then the output of
`git status --short`.
