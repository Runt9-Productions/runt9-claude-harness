---
title: Mod CI Checks
type: note
permalink: plugins/mod-ci
tags: [plugins, mods, ci]
verified: 2026-10-31
coverage: partial
measured_on: "Claude Code 2.1.310, npm 11.17, oxlint 1.86.0"
sources:
  - .github/workflows/ci.yml
  - .github/actions/install-claude-code/action.yml
---

# Mod CI Checks

> **Scope.** How a mod is type-checked, linted and validated without credentials, and the npm behaviour the pinned tools depend on. The `#measured` lines are carried from measurements on the versions in `measured_on` (type generation also on 2.1.307 and 2.1.309) and were not re-measured when this note was written; the `plugins` job in `.github/workflows/ci.yml` was read. Not covered: the invisible-character guard, the leak scan, and mods that declare `dependencies` beyond the one line below.

Read this before changing the `plugins` job or checking a mod by hand. Two of the checks below pass silently when
their input is missing, which is why the job checks the input exists first.

## Observations

- [fact] `claude plugin validate` and `claude plugin test` run with no credentials #measured
- [fact] `claude plugin validate --strict` fails a `plugin.json` that has no `author` #measured
- [fact] No `claude plugin` subcommand writes a mod's types; `CLAUDE_CODE_PLUGIN_DIR_WATCH=1 claude -p --plugin-dir <mod> x` with no credentials exits 1 "Not logged in" and still writes `tsconfig.json` and `.claude-plugin/types/` #measured (5 of 5 runs)
- [risk] Writing types in `-p` mode is undocumented (the variable is documented), so a release can stop it; the job's existence check is what would catch that.
- [fact] With a logged-in configuration the same types run makes a real model call and exits 0 #measured (so running it locally spends a request)
- [fact] Types written this way match a session's for core `claude-code`; tool schemas that depend on server flags differ, and `claude-code-mcp` is empty #measured
- [fact] A plugin named in a mod's `dependencies` needs its own `--plugin-dir` on the types run #measured
- [trap] The job finds a mod only at `hooks/hooks.json`, so it fails a `plugin.json` that sets `hooks`: a mod that key points elsewhere would pass unchecked #silent-failure
- [trap] Type-aware oxlint on a mod with no types exits 0 with only a warning, so the job fails when `tsconfig.json` or `.claude-plugin/types` is missing before it lints #silent-failure #measured
- [fact] `@anthropic-ai/claude-code` installed with scripts off leaves `bin/claude.exe` as a stub that exits 1, while `node cli-wrapper.cjs` runs `--version`, `-p`, `plugin validate` and `plugin test` #measured (`.github/actions/install-claude-code` wraps `cli-wrapper.cjs` in a `claude` script)
- [trap] `npm ci` never applies `min-release-age`: the cooldown applies only when npm resolves versions, and only on npm 11.10 or newer #silent-failure #measured (with a 100-year cooldown `npm ci` exits 0 and `npm install` fails ETARGET)
- [decision] CI generates mod types on every run and they are never committed (owner, 2026-10-24): committed types are about 845 KB per mod and churn with every Claude Code release.
- [decision] Every plugin passes `claude plugin validate --strict`, so every `plugin.json` carries `author` (owner, 2026-10-24; no reason recorded beyond the choice).
- [decision] CI installs `@anthropic-ai/claude-code@latest` on every run, outside the lockfile, with scripts off (owner, 2026-10-24): local Claude Code auto-updates, so CI must never check against an older version than users run.
- [decision] Every other tool is pinned in the lockfile under a seven-day release-age rule (owner, 2026-10-24; no reason recorded beyond the choice).

## Relations

- part_of [[Plugin Platform]]
- see_also [[Development Process]]
