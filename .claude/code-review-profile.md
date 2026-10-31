# Code review profile

Facts about this repository that `/lens-review` and its panel need. The skill reads every section; each reviewer
reads the sections its own file names.

## What ships, and why a defect is expensive

This is a public, MIT-licensed Claude Code plugin marketplace (`runt9`), plus harness parts that users copy into
their own `~/.claude`. Those parts exist to hold back an agent that is running with its user's credentials, so a guard
that quietly lets something through fails the one job it has. Everything merged here is public, and git history keeps
whatever was pushed even after a later commit removes it. A plugin change reaches a user only once its `version` has
risen and they run an update, so a fix that skips the version rise never arrives.

## Fetching the diff

| Target | Command |
|---|---|
| Working tree | `git diff HEAD` (staged and unstaged changes, and new files once staged) |
| Commit | `git show <sha>` |
| Range | `git diff <a>..<b>` |
| Pull request | `gh pr diff <n>`, then `gh pr view <n> --json commits,body` for the commit messages and the description |

- `gh` authenticates with `GH_TOKEN`.
- Default branch: `main`.
- No path is excluded from review. `package-lock.json` is relevant only to `guard-security` and `public-leak`;
  other reviewers may skip it.

## Output

- Root: `$CODE_REVIEW_OUTPUT` when it is set, otherwise `.claude/output/code-review/`.
- Inline threshold: a diff under 300 lines goes into the reviewer prompts; at 300 or more, reviewers read it from disk.

## Panel

Always-on: `principal-review`, `code-health`, `simplification`, `staleness-and-debris`, `public-leak`. This is the
`default` panel and the starting point of `auto`. `public-leak` is among them because every merged line becomes
public, and `simplification` because every review otherwise only adds code.

Routing, added when the diff matches:

| Reviewer | Matches |
|---|---|
| `guard-security` | anything under `.github/`; any `hooks/` directory; `bootstrap.py`; anything under `harness/`; `package.json`; `package-lock.json`; `requirements-dev.txt`; `ruff.toml`; code anywhere that refuses, rewrites or parses tool calls, shell commands, paths or pull request content |
| `mod-contract` | `plugins/*/hooks/*.ts`; any `*.tsx`; anything under `plugins/*/types/`; a change to `dependencies` or `types` in a `plugin.json` |
| `claude-code-expert` | anything under `plugins/` or `harness/` other than tests; `.claude/agents/`; `CLAUDE.md`; `bootstrap.py`; any settings, hook, skill, agent or rule file, or prose an agent reads as instructions |

Deep pass: `principal-review`. An open question the panel could not settle goes to it, scoped to that question.

## Severity calibration

The scale is Critical (Must Fix), High (Should Fix), Normal (Could Fix). Reference points for this repo:

- **Critical**: a guard that an honest change or a common mistake gets past; private information anywhere in the
  diff, its messages or its file names; a CI check that runs and checks nothing.
- **High**: a contract changed on one side only; a plugin README that misdescribes what the plugin does; a contract
  partner left without its version rise.
- **Normal**: leftover debug output; history or incident narrative in a comment; a README missing a line for a new
  setting or need.

Adding code is not free: Normal after Normal that guards against ever less likely cases makes code unreadable,
unmaintainable and cumbersome. So a Normal is optional: the author may decline one with a one-line reason. A finding
whose only fix is a guard for a case no honest change or common mistake reaches is not reported, except where the case
is `guard-security`'s: hostile pull request content, crafted input, or a model working around a guard. A finding that
removes code is worth as much as one that adds it.

## Fragile spots CI does not catch

- `gate` in `ci.yml` is the only required check. A path filter or a trigger change that stops the workflow starting
  means `gate` never reports, and the PR waits forever.
- `gate` runs under `if: always()` and goes red when a job it needs failed or was cancelled. A new job that is not in
  its `needs` list can fail without blocking a merge.
- bats passes when given no files, so the CI step counts them first. The leak scan's `self_check` plants a hit in each
  channel it reads; a channel added without a planted hit is unverified.
- Type-aware oxlint passes without types. A CI step checks that Claude Code wrote `tsconfig.json` and
  `.claude-plugin/types/`; weakening that step makes lint vacuous.
- The `python` job's flags are what keep a PR from changing its own checks: `-P`, `-c /dev/null`, `--noconftest` and
  the `norecursedirs` override for pytest, `--config ruff.toml` and `--no-respect-gitignore` for ruff. Dropping one
  lets an added file switch a check off while CI stays green. With no config file only default discovery applies, so
  a test file not named `test_*.py` never runs. A run that collects no tests exits 5 and fails the job.
- The version check runs per plugin. Nothing checks that both partners of a contract rose together.
- A marketplace entry holds only `name`, `source` and `description`; CI enforces that.
- In a plugin's `settings.json`, every key other than `agent` and `subagentStatusLine` is dropped without a warning.
- `CLAUDE_PLUGIN_DATA` is deleted when the plugin is uninstalled, so nothing that must outlive the plugin belongs there.
- A guard whose error path allows the call it was meant to judge.
- A comment that points readers at a gitignored path (`.claude/output/`, `.claude/settings.local.json`), which no
  other clone has.

## Plugin contracts

Behaviour other plugins or the engine rely on. A change to either side of a row is reviewed against the other side.

| Plugin | Contract | Other side |
|---|---|---|
| `teammate-delivery` | Diverts only sends whose origin is the model; sends a plugin makes are left alone. | any plugin that sends to a teammate |
| `teammate-delivery` | An idle receiver sees the lead under the name `team-lead`, which must equal `LEAD_NAME` in the module. | any tool text that tells a teammate who a message is from |
| `teammate-delivery` | A diverted send returns `{ isDelivered: true }` and never calls `next`. Lower `session.send` hooks and every `session.receive` hook therefore never see it, and the receiver knows the sender only by the name in the row's header, never by a verified `origin.teammate`. | any plugin with a `session.send` or `session.receive` hook, and any tool text that names a message's sender |
| `handoff` | A `/handoff` run whose origin is the plugin named `away` is unattended; a run from anywhere else is the owner's. | `away` |
| `handoff` | The state keys `phase`, `isUnattended` and `ceilingPercent` keep the names and meanings in `types/index.d.ts`, and `phase` and `ceilingPercent` are written on every `session.start` and `turn.start`. | `away`, which reads them |

A new plugin with a contract adds its rows here.

## Living docs

| Doc | Must change when |
|---|---|
| `CLAUDE.md` | layout, releasing, machine-local layers or the "Writing here" rules change |
| `README.md` | adding, installing or updating a plugin works differently |
| `plugins/<name>/README.md` | that plugin's behaviour, settings or requirements change |
| this profile | a contract appears, a CI check is found to fail silently, or something is ruled not to be a finding |

## Mirrors

| Copy | Source | Kept in step by |
|---|---|---|
| a marketplace entry's `description` | the plugin's `plugin.json` `description` | hand |
| a `# vX` comment beside a pinned action | the SHA it annotates | Dependabot |
| the "tuned on" version in `harness/leak-scan/README.md` | `version` in `install-betterleaks.sh` | hand |
| each request under "Other callers" | the `request` text in `harness/githooks/pre-push`, `harness/leak-scan/review-text.sh` and `harness/leak-scan/review.sh` | hand |

## Companions

- A new plugin brings a marketplace entry, a README, `author`, `version` and tests at its boundaries.
- A change to what a plugin ships brings a `version` rise, and so does every contract partner it touches.
- A change to what `harness/` ships brings a rise in `harness/harness.json`. A new part there that must be wired into
  `~/.claude` or a repository also brings a component in `HARNESS_COMPONENTS` in `bootstrap.py`, or it arrives unused.
- A new contract brings a row under "Plugin contracts" and, where one plugin cannot work without the other loaded, a
  `dependencies` entry.

## Test-quality traps

- A test that copies a stand-in for another plugin instead of loading it. The copy keeps passing after the real
  plugin changes.
- A mod kit stub whose default answer would also satisfy the test if the change under test were removed.

## Debris

- `console.log` or `$.ui.toast` left in for debugging.
- A focused or skipped test.
- A real home directory, session id or machine name in a fixture.
- Commented-out code.
- A TODO or FIXME added in passing, unrelated to the change.

## Rulings that are not findings

Each was decided by the owner, on the date shown where one was recorded. Report one only when the diff brings
something the ruling did not account for.

- The GitHub org and repository names, the publisher name "Runt9 Productions" (every plugin's `author.name`), the
  `runt9` marketplace name, the `runt9-claude-bot[bot]` name, and the GitHub noreply addresses that go with them.
- The owner's own email address as a commit author or committer, in its entry in `.leak-scan.toml` and in its case in
  `harness/leak-scan/test_scan.bats`. Anywhere else it is a finding. (2026-10-25)
- Runners pinned to `ubuntu-24.04`, until Ubuntu 26 runners exist. (2026-10-24)
- The required `gate` check not being pinned to a source app: the bot has no permission to write statuses or checks.
- CI installing `claude-code@latest` outside the lockfile. (2026-10-24)
- The invisible-character check flagging emoji variation selectors.
- Deliberate attacks by an agent running as the same OS user. The guards here are judged against honest changes and
  common mistakes only. (2026-10-25)
- A pull request reviewed with its own `.claude/`, `CLAUDE.md` and `plugins/lens-review`, which follows from running
  the review in its worktree with `--plugin-dir` (2026-10-25, reworded for the local run 2026-10-31).
- `bootstrap.py harness` installing a HEAD that is not on `origin/main` with a warning rather than refusing.
  (2026-10-27)

## Other callers

Both run `public-leak` alone through `harness/leak-scan/review.sh`, with only `Read`, in a directory holding the inputs
and copies of the reviewer brief, this profile and `CLAUDE.md` from the default branch, named `reviewer-brief.md`,
`code-review-profile.md` and `CLAUDE.md`.

- **The pre-push leak gate** (`harness/githooks/pre-push`) asks for a review of what a push would publish. Its inputs
  are `commits.patch`, `identities.txt`, `file-names.txt`, `binary-files.txt`, `tags.txt` and `ref-names.txt`, and it
  asks for an open question for each binary file.
- **The text check** (`harness/leak-scan/review-text.sh`) asks for a review of an issue or pull request before it is
  posted. Its one input is `body.md`, the title on its first line and the body after it.

`review.sh` adds to either request: lines over 4000 characters are split into pieces of 4000 that overlap by 200,
where the copies are, that every input is read to its last line and the last line read of each reported, and that the
answer goes in the structured output.

## Delivery

- **The report.** Write the complete report to `<review-dir>/review.md` and nowhere else. Subagent writes to files
  named `REPORT*`, `SUMMARY*`, `FINDINGS*` or `ANALYSIS*` are refused. A run that writes no report says why in its
  final message.
- **The run never posts.** It writes the files below; the session that started it posts them afterwards
  (`.claude/development-profile.md`, section 9).
- **PR targets** also write `<review-dir>/review-payload.json`, which is posted as written with `event: "COMMENT"`
  added:
  - `commit_id`: the 40-hex head SHA the diff was fetched at. Without it GitHub reviews the newest head.
  - `body`: the review summary. It keeps all three severity headings, and a finding placed inline appears there as a
    one-line pointer to its comment.
  - `comments[]`: each with `path`, `line`, `side: "RIGHT"` and `body`, carrying one whole finding, and no other
    field. `line` is the new-side line number counted from the hunk header.
- **Body cap.** Keep `body` under 60,000 characters, below GitHub's 65,536-character limit for a review. When the full
  body would pass that, shorten every finding in it to one line with its location, and say that the full text is in
  the inline comments and in `review.md`.
- **Fallback.** GitHub rejects the whole review when one comment does not land on the diff, and `review.md` is
  then posted alone as the body, so it holds every finding in full, inline or not.

## Standing instructions

`code-health` and `simplification` judge the change against the "Writing here" rules in `CLAUDE.md` and the
style-guide skills in this checkout: `harness/skills/code-style/SKILL.md`, `harness/skills/comment-style/SKILL.md`,
and the skill for the language in the diff (`python-style`, `kotlin-style` or `typescript-style` under
`harness/skills/`).
