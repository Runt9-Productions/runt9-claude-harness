# Code review profile: runt9-claude-harness

Read by the `/code-review` skill and by every reviewer on its panel.

**What ships from here.** A public, MIT-licensed Claude Code plugin marketplace plus harness pieces that users copy
into `~/.claude`. Users install them to shape and constrain an agent running with their own credentials, so a wrong
guard, a broken mod or a leaked private detail reaches everyone who installed or cloned it, and the repository's git
history keeps whatever was pushed. A plugin change reaches users only when its version rises and they update.

## 1. Diff fetch

- Working tree: `git diff HEAD > <review-dir>/diff.patch` (against `HEAD`: work is staged as it is written)
- Staged only: `git diff --staged > <review-dir>/diff.patch`
- Single commit: `git show <sha> > <review-dir>/diff.patch`
- Range: `git diff <a>..<b> > <review-dir>/diff.patch`
- Pull request: `gh pr diff <n> > <review-dir>/diff.patch`; commit messages with `gh pr view <n> --json commits`,
  the description with `gh pr view <n> --json body`. `gh` needs a token: see section 11.
- Default branch: `main`
- Paths excluded from review: none. `package-lock.json` stays in the diff for `guard-security` and `public-leak`;
  other reviewers skip it.
- Review output root: `$CODE_REVIEW_OUTPUT` when that variable is set, otherwise `.claude/output/code-review/`.
  Under `--permission-mode dontAsk`, as in CI, writes inside `.claude/` are refused whatever the allow rules say.
- Inline the diff in prompts when under: 300 lines

## 2. Reviewer routing table

| Reviewer id | Include when the diff... |
|---|---|
| `guard-security` | touches `.github/**`, any `hooks/` directory, `bootstrap.py`, `harness/**`, `package.json`, `package-lock.json`, or any code that refuses, rewrites or parses a tool call, a command, a path or PR content |
| `mod-contract` | touches `plugins/*/hooks/*.ts`, `*.tsx`, `plugins/*/types/**`, or a `plugin.json` `dependencies` or `types` field |

- **Always-on reviewers:** `principal-review`, `code-health`, `staleness-and-debris`, `public-leak`. Also what
  `/code-review <target> default` runs.
- **Auto floor:** `public-leak`, on every `/code-review <target> auto` panel, because whatever a diff carries goes
  public when it merges.
- **Deep-pass reviewer:** `principal-review`, scoped to the open question.

## 3. Known-fragile patterns

- **A required check that never reports.** `gate` is the required check. A `paths`/`paths-ignore` filter or a
  trigger change that stops the workflow starting on some PR leaves `gate` unreported, and the PR waits forever.
  Silent because nothing fails. Check when the diff touches `.github/workflows/`.
- **A needed job that is skipped passes.** `gate` runs with `if: always()` and fails on `failure` or `cancelled`; a
  new job must be in its `needs`. Silent because a job outside `needs` can fail and `gate` still passes.
- **Type-aware oxlint without types exits 0.** The mod check fails only because a step tests that Claude Code wrote
  `tsconfig.json` and `.claude-plugin/types/`. Removing or reordering that step makes lint pass on nothing.
- **anti-trojan-source reads an option-like file name as a flag and skips the file,** and with no file arguments
  scans stdin. Every call passes `--` before the files and closes stdin.
- **A plugin changed without its version rising reaches nobody.** CI checks one plugin at a time; plugins with a
  contract between them (section 4) must rise together, which CI does not check.
- **Marketplace entries carry only `name`, `source` and `description`.** Anything else ships behaviour no plugin
  version covers. CI enforces the keys.
- **A plugin's `settings.json` can carry only `agent` and `subagentStatusLine`.** Other keys are ignored silently.
- **`CLAUDE_PLUGIN_DATA` is deleted on uninstall.** State a user would want to keep does not belong there.
- **A guard that fails open.** A hook or mod guard whose error path (missing interpreter, unparsable input, a
  thrown exception) lets the call through looks fine in every test of the happy path.
- **Comments citing a gitignored path** (`.claude/output/`, `.claude/settings.local.json`). The pointer is dead on
  every other machine and reads as authoritative until then.

## 4. Contracts between plugins

| Contract | Sides |
|---|---|
| teammate-delivery redirects only sends whose origin is the model; a plugin's `session.send` keeps its own framing and timing | `plugins/teammate-delivery/hooks/register.ts` and any plugin that sends to a teammate |
| An idle teammate receives a delivered message as from `team-lead`, the engine's name for the main session | `plugins/teammate-delivery/hooks/register.ts` `LEAD_NAME` and any tool text that tells a teammate who a message is from |

## 5. Living docs that go stale

| Doc | Should be updated when the diff... |
|---|---|
| `CLAUDE.md` | changes the layout, how releases work, where local layers live, or a rule under "Writing here" |
| `README.md` | changes how the marketplace is added, installed or updated |
| `plugins/<name>/README.md` | changes what that plugin does, its settings, or what it needs |
| `.claude/code-review-profile.md` | adds a plugin contract (section 4), a CI check with a silent failure (section 3), or a decided non-finding (section 10) |

## 6. Maintained mirrors

| Mirror | Mirrors what | Regenerated by |
|---|---|---|
| `.claude-plugin/marketplace.json` entry `description` | `plugins/<name>/.claude-plugin/plugin.json` `description` | hand-edited |
| Version pins in `.github/workflows/ci.yml` comments (`# v7.0.1`) | the pinned commit SHA beside them | Dependabot |

## 7. Companion-artifact rules

- A new `plugins/<name>/` requires a marketplace entry, a `README.md`, `author` and `version` in its `plugin.json`,
  and tests at its boundaries.
- A change to what a plugin ships requires its `version` to rise (CI checks), and the version of every plugin it has
  a contract with when the contract changes.
- A new contract between plugins requires a row in section 4 and a `dependencies` entry where one plugin needs the
  other loaded.

## 8. Test-quality traps

- **Stand-ins for another plugin.** A kit test that copies another plugin's result text or behaviour keeps passing
  after the real plugin changes. Flag a copied string with no test that compares it to the real source.
- **Kit stubs that answer everything.** A stubbed engine call returning a default indistinguishable from a real
  answer lets a test pass with the code under test removed. Ask whether the assertion could still pass if the change
  were reverted.

## 9. Leftover-debris patterns

- `console.log` or a `$.ui.toast` added for debugging
- `test.only`, `test.skip`, or a focused `describe`
- A literal home path, session id or machine name in a fixture
- Commented-out code; a TODO or FIXME added in passing

## 10. Severity calibration

- **Critical here looks like:** a guard a model tool call can walk around; a personal, employer or private-project
  detail in any file or commit message; a CI check that passes without checking anything.
- **High here looks like:** a contract changed on one side; a doc now wrong about what a plugin does; a version not
  raised for a contract partner.
- **Normal here looks like:** leftover debug output; a comment narrating history; a missing README line.

**Explicitly NOT a finding in this repository:**

- The names Runt9 Productions and runt9-claude-harness, the `runt9` marketplace name, the bot identity
  `runt9-claude-bot[bot]`, and GitHub noreply addresses: published on purpose.
- The owner's own address as a commit author or committer: decided 2026-10-25. Anywhere else, in a file or a
  commit message, it is still a finding.
- Runners pinned to `ubuntu-24.04`: decided 2026-10-24, until the runners move to Ubuntu 26.
- `gate`'s source is not pinned to GitHub Actions: the bot holds neither statuses nor checks write, so nothing but
  Actions and the owner can report it.
- `@anthropic-ai/claude-code@latest` installed outside the lockfile in CI: decided 2026-10-24, so mods are checked
  against the version auto-updating users run.
- The invisible-character check failing on non-breaking spaces and emoji with a variation selector: accepted.

## 11. Report delivery

Not decided yet; it depends on whether the review runs locally or in CI. Until it is, return the report to the
caller.

## 12. Standing reviewer instructions

The standards `code-health` judges against: the repository's `CLAUDE.md` ("Writing here"), and where present on the
machine running the review, `~/.claude/code-style-principles.md`, `~/.claude/comment-style-guide.md` and the
language's guide (`~/.claude/python-style-guide.md` for Python).
