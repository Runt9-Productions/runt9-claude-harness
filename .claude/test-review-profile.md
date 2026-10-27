# Test review profile

Facts about this repository's tests that `/test-review` and the `test-reviewer` agent need.

## Default branch

`main`. With no paths given, the skill reviews test files changed against the merge base with it.

## Test kinds

| Kind | Files | Helpers | Run | Reading the result |
|---|---|---|---|---|
| bats | `**/*.bats` | `.github/scripts/tests/helpers.bash` | `bats <file>`, or one test with `bats -f '<regex>' <file>` | TAP: `1..N`, then one `ok` or `not ok` line per test |
| mod kit | `plugins/**/*.test.ts`, `plugins/**/*.test.tsx` | none | `claude plugin test plugins/<name>` | one `(pass)` or `(fail)` line per test, then `N pass` and `N fail` |

Production code is every file that is neither a test nor a helper listed above.

## Checks on every scoped file

- **It has tests.** bats passes a file with no tests in it, so count the per-test lines rather than trusting the exit
  status.
- **CI runs it.** `.github/workflows/ci.yml` must pick the file up. A test CI never runs protects nothing.
- **Lint.** shellcheck runs over bats files and their helpers, so a fix must pass it.
- **Requirements.** A test file's header comment names every tool it needs beyond bash and git.

## Reference files

| Kind | Reference |
|---|---|
| bats | `.claude/agents/references/test-review-shell.md` |
| mod kit | `.claude/agents/references/test-review-mod-kit.md` |

## Suite policy

From the "Writing here" rule in `CLAUDE.md` that tests are few, at the boundaries, with obviously synthetic fixtures.
Criterion 4 judges each test against it:

- **Boundaries.** Drive a shipped entry point the way its real caller does (a hook through its stdin and arguments, a
  mod through engine events) and assert on what comes back out.
- **One test per decision.** Each distinct decision the code makes gets one test. A second test of the same decision
  is redundant.
- **Fail-closed paths.** A test that proves a guard refuses when something goes wrong is always wanted and never
  deleted as redundant.
- **Fake fixtures.** Test data ships publicly, so it is plainly synthetic: `example.com`, `PROJ-123`, made-up names.
