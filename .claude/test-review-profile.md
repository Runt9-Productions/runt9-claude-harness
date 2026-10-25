# Test review profile: runt9-claude-harness

Read by the `/test-review` skill and by the `test-reviewer` agent it spawns.

## 1. Test kinds

| Kind | Files | Run | Real results |
|---|---|---|---|
| bats | `**/*.bats`, with shared helpers in `.github/scripts/tests/helpers.bash` | `bats <file>`, or `bats -f '<name regex>' <file>` for one test | TAP: `1..N`, then an `ok` or `not ok` line per test |
| mod kit | `plugins/**/*.test.ts`, `plugins/**/*.test.tsx` | `claude plugin test plugins/<name>` | a `(pass)` or `(fail)` line per test, then `N pass` and `N fail` |

- A bats file with no tests passes. Count the per-test lines against the tests in the file.
- A test CI does not run protects nothing between manual runs. Check in `.github/workflows/ci.yml` that each scoped
  file is one a CI step picks up, and report it if not. CI also runs shellcheck over tracked shell files, tests
  included, so a fix to a shell test must stay shellcheck-clean.
- Each test file's header comment names the tools it needs beyond bash and git.
- Production code is everything that is not a test file or `helpers.bash`.

## 2. References

| Files | Reference |
|---|---|
| `**/*.bats` | `.claude/agents/references/test-review-shell.md` |
| `plugins/**/*.test.ts`, `plugins/**/*.test.tsx` | `.claude/agents/references/test-review-mod-kit.md` |

## 3. Suite policy

`CLAUDE.md`: "Tests are few, at the boundaries, with obviously synthetic fixtures." Applied as criterion 4's scope
rule:

- **At the boundaries.** A test drives a shipped entry point the way its real caller does: a CI script as the
  workflow runs it, a git hook as git runs it, a scan as the hook calls it, a mod through the engine events it
  registers on. It asserts what crosses back out: the exit status and its reason, what a stubbed tool received, output
  a consumer reads. A test of a function inside a script, or of an intermediate file nobody else reads, is outside
  the policy.
- **Few.** One test per distinct decision the entry point can make: each reason it refuses, the path where it allows,
  and each error path that must fail closed. A second test of the same decision is redundant under criterion 4 even
  when its input differs.
- **Fail-closed paths are not optional.** Most of what ships here refuses something. A guard with no test showing it
  refuses when its input is unreadable, or a tool it needs is missing, is a coverage gap to report, and the policy
  never argues for deleting one.
- **Obviously synthetic fixtures.** `example.com`, `test` identities, temporary directories; never a real home path,
  host, person or organization. The repository is public, so fixtures ship too.
