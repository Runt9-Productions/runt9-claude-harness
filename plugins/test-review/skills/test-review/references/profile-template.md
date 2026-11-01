# Test review profile

<!-- Template for `.claude/test-review-profile.md`. Replace each placeholder and delete these comments. The skill reads
"Default branch", "Test kinds" and "Reference files"; the reviewer reads "Suite policy" and the reference files. -->

Facts about this repository's tests that `/test-review` and its reviewer need.

## Default branch

`<main>`. With no paths given, the skill reviews test files changed against the merge base with it.

## Test kinds

<!-- One row per kind of test. Files and Helpers are git pathspec globs. Run must be able to run one file and one
test, because the reviewer proves each verdict with a run. Reading the result says what a pass and a failure look
like in the output, since some runners exit 0 with nothing run. The row below is an example. -->

| Kind | Files | Helpers | Run | Reading the result |
|---|---|---|---|---|
| pytest | `**/test_*.py` | none | `python -m pytest -v <file>`, or one test with `-k '<name>'` | one `PASSED` or `FAILED` line per test, then `N passed` and `N failed` |

Production code is every file that is neither a test nor a helper listed above.

## Checks on every scoped file

<!-- Optional. Checks beyond the four criteria that every test file here must pass: that CI runs it, the lint a fix
must pass, a header naming the tools it needs. -->

## Reference files

<!-- Per kind, a file of failure modes particular to that kind of test in this repository. A file under
`.claude/agents/` with frontmatter loads as an agent, so give a reference there no frontmatter. A kind with no
reference is still reviewed, and the report lists it as a gap. -->

| Kind | Reference |
|---|---|
| pytest | `.claude/agents/references/test-review-pytest.md` |

## Suite policy

<!-- What the suite should hold, which the fourth criterion (no other test reports the same defect) judges each test
against: where tests sit (at the boundaries, through real entry points), how many per decision, which tests are
never deleted as redundant, and what fixtures may contain. -->
