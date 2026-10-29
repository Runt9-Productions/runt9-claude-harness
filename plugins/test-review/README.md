# test-review

`/test-review` judges whether existing tests are worth having, against four criteria: the name claims only what the
test asserts, the scenario can really happen, a wrong implementation would fail it, and no other test already
reports the same defect. Every verdict rests on a run: the reviewer breaks the production code, predicts which tests
go red, runs them, and restores the code. It then fixes the tests and reports production defects without fixing them.

```
/test-review                    every test file changed against the default branch, uncommitted ones included
/test-review tests/test_cli.py  the files and directories named
```

It runs in a forked context, so the session that wrote the tests does not judge them, and only its final message
comes back. It leaves its fixes in the working tree, unstaged.

## What it ships

- **The `test-review` skill**, which finds the scope, matches each file to its reference, and spawns the reviewer.
- **The `test-reviewer` agent**, spawned as `test-review:test-reviewer`.
- **A profile template**, `skills/test-review/references/profile-template.md`.

## What a repository supplies

- `.claude/test-review-profile.md`: the default branch, each kind of test with how to run one file and one test and
  how to read the result, a reference file per kind, and the suite policy. Without it the skill stops.
- The reference files the profile names: the failure modes particular to each kind of test in that repository.

## Needs

`git`, and the runner for each kind of test in scope. Production files with uncommitted changes are backed up before
the reviewer breaks them and restored from that copy; every other production file is restored from git.

No settings.
