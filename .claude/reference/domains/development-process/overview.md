---
title: Development Process
type: note
permalink: development-process/overview
tags: [development-process, ci, releasing]
verified: 2026-11-06
coverage: partial
sources:
  - .github/scripts/guard-versions.sh
  - .github/workflows/ci.yml
  - harness/githooks/pre-push
  - harness/leak-scan/review.sh
---

# Development Process

> **Scope.** How a change becomes a release here, and the CI, GitHub and pre-push rules a pull request runs into. Re-read on 2026-11-06 in the working tree of #126, with every claim resting on them re-checked: `guard-versions.sh`; the `on:` trigger, the `gate` job and the pytest step of `ci.yml`; the pre-push gate's fetch of the default branch and its handling of the review's exit status in `pre-push`, and the review files `review.sh` reads from it. The `plugins` job's changes since the last check (its `timeout-minutes`, the zone link steps, the process cleanup and the dependency loop's `jq` line) and the `leak-scan` job's `PR_AUTHOR` setting were read and change none of these claims. pytest's default `python_files` was read in pytest's configuration reference, and the two `[vendor]` lines on `dependencies` come from the "Plugin dependencies" page of Claude Code's docs, both fetched 2026-11-06. The GitHub push refusal itself is carried from an earlier observation; that it looks only at the commits a push adds was measured. Not covered: the leak scan, the rest of the pre-push gate, the invisible-character and marketplace guards, and the bot's commit identity.

Read this before changing what a plugin ships, before editing anything under `.github/workflows/`, before adding a
filter to CI, or before moving a file the pre-push gate reads. Each trap here produces a pull request that looks finished and either reaches nobody or never reports.

## Observations

- [fact] `guard-versions.sh` fails a pull request that changes a plugin's files without raising `version` in its `.claude-plugin/plugin.json`; it compares with `sort -V`, so the version must rise, not merely change.
- [fact] The same guard treats everything under `harness/` as one unit versioned in `harness/harness.json`, because a rise is what tells a user to run `bootstrap.py --update`.
- [trap] The guard exempts only a plugin's top-level `README.md`, a README directly under a `harness/` part, `*.test.ts`, `*.test.tsx`, `test_*.py` and `test_*.bats`. Any other doc, a skill's `references/` included, needs a version bump.
- [fact] A plugin, or a `harness.json`, that is new in the pull request passes the guard at any version.
- [fact] The version guard diffs `HEAD^1` to `HEAD` in GitHub's merge checkout, which is exactly what the merge changes even when the base has moved.
- [trap] `ci.yml` must never be filtered with `paths` or `paths-ignore`: a pull request the filter excludes never starts the workflow, so `gate` never reports and the pull request waits forever #silent-failure
- [trap] `gate` runs with `if: always()` and fails on any `failure` or `cancelled` result; with a plain `needs` it would be skipped when a job fails, and GitHub passes a skipped required check #silent-failure
- [trap] GitHub refuses a push by a GitHub App token without the `workflows` permission, such as the bot's, when the push adds a commit that changes `.github/workflows/`, including a merge of `main` that brings such a change in.
- [fact] The refusal looks only at the commits a push adds: once a workflow change is on the remote branch, the bot's later pushes that add none are accepted #measured (2026-10-31)
- [decision] Releasing is a version bump per plugin, in its `plugin.json` only, with no git tags (owner, 2026-10-24): installed users get a change only when its version rises, and then only that plugin updates.
- [decision] Plugins with a contract between them bump together in one pull request and name each other in `dependencies` (owner, 2026-10-24): both sides of a contract release together.
- [vendor] A `dependencies` entry is a plugin name, or an object whose `version` is a semantic-version range such as `>=1.4`, resolved to the highest `<plugin>--v<version>` git tag in range; for a plugin a marketplace references by a relative path and no tag in range, the marketplace's current copy installs and the range is checked at load, leaving the dependent plugin disabled while it fails. With no release tags here (the decision above), a range in this repository can only disable a plugin, never hold back its dependency (inferred from the two, not measured).
- [vendor] A range is not checked against a dependency loaded with `--plugin-dir`, so trying a change that way never shows a range failing. `claude plugin validate --strict` does not check the range either ([[Mod CI Checks]]).
- [decision] The bot keeps no `workflows` permission, so a push that adds a commit changing `.github/workflows/` is made by the owner (owner, 2026-10-25): the owner keeps control of what runs in GitHub Actions. Opening the pull request, labels and replies stay with the bot.
- [decision] Code review and test review run locally, never in a GitHub workflow (owner, 2026-10-30): CI saved little over a local run and cost much in workarounds, and a reviewer that needs web search and fetch cannot run there.
- [decision] CI runs pytest and ruff at the exact versions `requirements-dev.txt` pins, installed as wheels only (owner, 2026-10-26): installing then runs no package's build code.
- [trap] CI's pytest reads no config file (`-c /dev/null`), so only default discovery applies: a test file named neither `test_*.py` nor `*_test.py` never runs, and nothing fails while some other test still runs #silent-failure
- [trap] The pre-push gate reads its leak review's files from the remote's default branch (`refs/trusted`, `harness/githooks/pre-push:133-140`) at the paths the installed `review.sh` lists (`harness/leak-scan/review.sh:70-92`), and refuses the push when the `public-leak` lens, the `lens-review` agent or the reviewer brief is not there. The brief may sit at `plugins/lens-review/skills/lens-review/references/reviewer-brief.md` or `.claude/agents/references/reviewer-brief.md`, and this repository has only the first. A change that moves any of the three refuses every push from a harness installed from the branch until it merges, and from one installed before it once it merges, until `bootstrap.py harness` installs the version that matches the default branch #order-dependent
- [decision] Docs, skills and notes give each rule its structure and a one-line reason, never the history behind it (owner, 2026-10-26): the structure is what a reader needs.

## Relations

- see_also [[Plugin Platform]]
- see_also [[Mod CI Checks]]
- see_also [[Leak Review]]
