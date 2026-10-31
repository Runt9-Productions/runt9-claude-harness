# test-review

`/test-review` judges whether existing tests are worth having, against four criteria: the name claims only what the
test asserts, the scenario can really happen, a wrong implementation would fail it, and no other test already
reports the same defect. Every verdict rests on a run: the reviewer writes a batch of breaks to the production code,
each with the tests it predicts go red, and a bundled script runs each break in its own copy of the tree and reports
only the surprises. The checkout is never broken. The reviewer then fixes the tests and reports production defects
without fixing them.

```
/test-review                    every test file changed against the default branch, uncommitted ones included
/test-review tests/test_cli.py  the files and directories named
```

It runs in a forked context, so the session that wrote the tests does not judge them, and only its final message
comes back. It leaves its fixes in the working tree, unstaged.

## What it ships

- **The `test-review` skill**, which finds the scope, matches each file to its reference, and spawns the reviewer.
- **The `test-reviewer` agent**, spawned as `test-review:test-reviewer`.
- **The batch script**, `skills/test-review/scripts/run_breaks.py`, which runs a file of breaks in parallel copies
  of the working tree, with an unbroken baseline, and writes the full result table to a file.
- **A profile template**, `skills/test-review/references/profile-template.md`.

## What a repository supplies

- `.claude/test-review-profile.md`: the default branch, each kind of test with how to run one file and one test and
  how to read the result, the batch script's run command and result patterns per kind, a reference file per kind,
  and the suite policy. Without it the skill stops.
- The reference files the profile names: the failure modes particular to each kind of test in that repository.

## Needs

`git`, Python 3.12 or later for the batch script, and the runner for each kind of test in scope. Breaks run in
temporary copies of the tracked and untracked, not ignored, files, so uncommitted work in the checkout is never at
risk.

No settings.
