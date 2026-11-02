# test-review

`/test-review` judges whether existing tests are worth having, against four criteria: the name claims only what the
test asserts, the scenario can really happen, a wrong implementation would fail it, and no other test already
reports the same defect. Whether a wrong implementation would fail a test rests on a run: for each rule the spec or
contract of the production code states, the reviewer makes the change a plausible wrong reading of that rule would
make, runs the tests, and restores the code. It then fixes the tests and reports production defects without fixing them.

```
/test-review                    every test file changed against the default branch, uncommitted ones included
/test-review tests/test_cli.py  the files and directories named
```

It runs in a forked context as the reviewer agent, so the session that wrote the tests does not judge them, and only
its final message comes back. It leaves its fixes in the working tree, unstaged.

## What it ships

- **The `test-review` skill**, which forks into the reviewer and gives it the steps: read the profile, find the
  scope, read the references, back up dirty production files, review and report.
- **The `test-reviewer` agent**, `test-review:test-reviewer`, which the skill runs as. It runs on Opus at medium
  effort.
- **A profile template**, `skills/test-review/references/profile-template.md`.

## What a repository supplies

- `.claude/test-review-profile.md`: the default branch, each kind of test with how to run one file and one test and
  how to read the result, a reference file per kind, and the suite policy. Without it the skill stops.
- The reference files the profile names: the failure modes particular to each kind of test in that repository.

## Needs

`git`, and the runner for each kind of test in scope. Production files with uncommitted changes are backed up before
the reviewer breaks them and restored from that copy; every other production file is restored from git.

No settings.
