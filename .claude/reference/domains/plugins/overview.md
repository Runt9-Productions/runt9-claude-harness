---
title: Plugin Platform
type: note
permalink: plugins/overview
tags: [plugins, claude-code, platform]
verified: 2026-10-31
coverage: partial
measured_on: "Claude Code 2.1.310 and 2.1.316"
---

# Plugin Platform

> **Scope.** How Claude Code loads, updates and names a plugin, and what a plugin cannot carry. The `#measured` lines are carried from measurements taken on 2.1.310 and were not re-measured when this note was written, except the four on two copies of one plugin and the two on a plugin's own `$.tool.call`, measured on 2.1.316 in `claude -p` runs; the `[vendor]` lines come from the plugin docs (loading, manifest, marketplace and hosting pages) and were never measured. Not covered: plugin LSP and MCP servers, output styles beyond whether a plugin may ship them, and how a session's `--tools` caps a plugin agent's grant.

Read this before writing a plugin, naming one of its skills or agents in a prompt or a `subagent_type`, or reasoning
about when a change reaches the people who installed it. The traps here produce a plugin that looks loaded and is
running something else, or a name that resolves to a different skill.

## Observations

- [fact] A plugin in a marketplace added from a local directory runs from its source folder; edits take effect at the next session start or `/reload-plugins` #measured (`plugin list --json` shows `readFromFolder`)
- [trap] That install still writes a versioned copy under `plugins/cache/<marketplace>/<plugin>/<version>/`, refreshed only when the version rises, and the copy is not what runs #measured
- [vendor] A marketplace hosted on git copies each plugin into that cache at install, so its users run the copy.
- [vendor] `--plugin-dir` and `CLAUDE_CODE_PLUGIN_DIRS` load a plugin in place as `<name>@inline`, replacing an installed plugin of the same name for that session only.
- [vendor] Auto-update is off by default for every marketplace except the official one; a marketplace's `autoUpdate` turns it on.
- [vendor] With `version` set in `plugin.json`, new commits reach no user until the version changes; without it the commit SHA is the version and every commit updates.
- [vendor] Pinning is `ref` (a branch or tag) or `sha` on a plugin source, or `owner/repo#ref` when adding a marketplace; two release channels are two marketplaces on different refs.
- [vendor] A plugin's `settings.json` honours only `agent` and `subagentStatusLine`, so `statusLine`, `env`, `permissions`, `cleanupPeriodDays` and the worktree options cannot come from a plugin.
- [vendor] A plugin may ship output styles (`outputStyles`); a `CLAUDE.md` at the plugin root is not loaded.
- [vendor] `${CLAUDE_PLUGIN_ROOT}` is substituted in skill, command and agent Markdown, hook commands, and MCP and LSP config, and is not exported to the Bash tool's environment.
- [vendor] `${CLAUDE_PLUGIN_DATA}` is a per-plugin directory kept across updates and deleted on uninstall unless `--keep-data` is passed.
- [fact] With a plugin of one name in both the settings' `CLAUDE_CODE_PLUGIN_DIRS` and `--plugin-dir`, the `--plugin-dir` copy's hooks module loads and the other's is refused #measured (7 runs. The debug log's `hooks module <name>@inline loaded ... events:` line lists the hooks in the order the module registers them, which matched the `--plugin-dir` copy's order and not the other's. A copy whose `tool.call` hook logs `$.process.run (<name>)` on a Bash call logged it when loaded alone and not when both were named.)
- [trap] The refused copy's line, "hooks module not loaded: another plugin of that name loads first", names only `<name>@inline`, so it reads as the `--plugin-dir` copy being shadowed when it is the other one #measured
- [fact] A variable in a settings file's `env` block reaches the session whatever the shell holds: under `env -u CLAUDE_CODE_PLUGIN_DIRS` both copies are still named, and `--settings '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":""}}'` leaves only the `--plugin-dir` one #measured
- [trap] Two inline copies of one plugin share one `$.store` file, `plugins/store/<name>_inline-<hash>.json`, whatever their paths, so a copy tried with `--plugin-dir` reads and writes the data of the copy it replaces; a marketplace install keeps its own (`<name>_<marketplace>-<hash>.json`) #measured (a probe plugin copied to two paths and run once from each left one file holding the second run's write; a plugin loaded inline beside its marketplace install had one file of each shape, such as `probe_inline-<hash>.json` and `probe_example-<hash>.json`)
- [fact] A plugin's own `$.tool.call` to a tool that another plugin's `tool.call` hook answers with its own `{ result }`, without calling `next`, resolves with `text` set: a string result came back as `{ result, text }`, the two equal #measured (2.1.316: a probe plugin called a second probe plugin's registered tool from `turn.start` in a `claude -p` run and wrote what it got to a file. Only a string result was tried.)
- [trap] The kit's type docs for `ToolCallResult.text` say it is absent on a hook's own `{ result }`, which the line above contradicts, and the kit's test engine follows the docs (a kit test whose hook returned only `{ result }` gave the caller no `text`); a mod that reads `text` on its own call works live and gets nothing in a kit test unless the test's hook returns `text` itself. Re-measure on a newer version rather than trusting either alone #measured
- [trap] A plugin agent spawns only by its namespaced name, `<plugin>:<agent>`; the bare name fails with "not found" even when nothing else uses it #measured
- [fact] A project agent with the same name as a plugin agent owns the bare name, and the plugin agent stays reachable by its namespaced name #measured
- [fact] A plugin skill whose name nothing else uses answers to its bare name as well as to `/<plugin>:<skill>` #measured
- [trap] A plugin skill named like a built-in never answers to the bare name: a typed `/code-review` reaches the built-in, not the plugin's skill #measured
- [fact] A bare skill name resolves user skill first, then project skill, then built-in; a plugin skill is not in that chain when its name collides #measured
- [decision] Plugins install from this repository's marketplace, and a change is tried in a separate session with `--plugin-dir` (owner, 2026-10-24): it replaces the installed copy for that session only.
- [decision] A plugin reads machine-local data from `~/.claude/local/<plugin>/` and treats a missing file as empty, with synthetic examples in `plugins/<name>/local.example/` (owner, 2026-10-24): machine-specific data stays out of a public repository.
- [decision] Settings a plugin cannot carry live in `harness/`, installed by `bootstrap.py` (owner, 2026-10-24): the platform gives a plugin no way to set them.

## Relations

- see_also [[Mod CI Checks]]
- see_also [[Hooks Module Loader]]
- see_also [[Development Process]]
- see_also [[Skill Loading]]
- see_also [[Teammate Mailbox]]
- see_also [[Built-in Worktrees]]
- see_also [[Guardrails]]
