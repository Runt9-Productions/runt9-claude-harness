---
title: Plugin Platform
type: note
permalink: plugins/overview
tags: [plugins, claude-code, platform, mods, state, store, refusals, observer-agents]
verified: 2026-11-06
coverage: partial
measured_on: "Claude Code 2.1.310, 2.1.316, 2.1.318 and 2.1.319"
---

# Plugin Platform

> **Scope.** How Claude Code loads, updates and names a plugin, what a plugin cannot carry, and what a mod sees at run time of session ids, headless runs, messages, other plugins' state, refusals, observer agents and the store across sessions. The `#measured` lines are carried from measurements taken on 2.1.310 and were not re-measured when this note was written, except the four on two copies of one plugin and the two on a plugin's own `$.tool.call`, measured on 2.1.316 in `claude -p` runs, the two on files in a subfolder of `.claude/agents/`, measured on 2.1.316 on 2026-11-01, and the run-time lines added on 2026-11-06, each of which names its version. Of those, the `session.send` and cross-plugin `state.set` lines were measured on 2.1.319 in kit tests when they were written; the headless shutdown and the `state.set` hook in `claude -p` are carried from the watcher project's build runs on 2.1.319, and the refusal, observer and store lines from its planning probes on 2.1.318, all without a re-run. Every run-time line was checked against the 2.1.319 kit types. The `[vendor]` lines come from the plugin docs (loading, manifest, marketplace and hosting pages) and were never measured. Not covered: plugin LSP and MCP servers, output styles beyond whether a plugin may ship them, how a session's `--tools` caps a plugin agent's grant, whether `$.state` empties on a session id change, an answer pressed in an interactive session's pane, a person's "No" at a prompt, a `{ deny }` from another plugin's `tool.call` hook, two sessions writing one store key, and observer agents in an interactive session.

Read this before writing a plugin, naming one of its skills or agents in a prompt or a `subagent_type`, or reasoning
about when a change reaches the people who installed it. The traps here produce a plugin that looks loaded and is
running something else, or a name that resolves to a different skill. Read the run-time lines before relying on a
mod's state across a `/clear`, a timer in a headless run, or a refusal's kind.

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
- [fact] `$.state` survives a hot reload of the plugin's code, and `$.store` survives both a hot reload and the session (the 2.1.319 types' docs for `$.state` and `$.store`)
- [trap] A `/clear` ends the conversation and the process goes on under a new session id with no `session.start` for it, so whatever a mod loads at `session.start` must be loaded again when `$.session.id()` changes (the 2.1.319 types: `session.start` fires "never /clear", and `SessionEndInput.reason` `clear`)
- [question] Does `$.state` empty when the session id changes within one process (`/clear`, a resume from inside the session)? The types do not say, and nothing has measured it. Settle it with a probe plugin that sets a value, then a `/clear` in an interactive session and a read of it. Until then a mod treats state from before an id change as belonging to the earlier conversation and rebuilds or clears it itself.
- [trap] In `claude -p` the session ends once the last `turn.complete` chain settles, so a `$.clock.after` scheduled from that hook never fires; a mod that must finish its work awaits it inside the hook there, and tells the case apart by `$.session.surfaces()`, which the types say is empty in a plain `-p` run #measured (2.1.319, one run in the watcher build: the debug log went from `turn.complete settled` to `session.end` with no call from the timer, and the awaited form ran; not re-run)
- [fact] A `session.send` hook sees `to` as a string: `$.session.send({ to: { agentId } })` arrives as the bare agent id #measured (2.1.319, a kit test; the types' `SessionSendInput.to` says a plugin's `{ sessionId }` or `{ agentId }` "arrives already spelled so". Not measured live.)
- [fact] A plugin's `state.set` hook matched on another plugin's `{ plugin, key }` fires on that plugin's own writes, and its `next(e)` resolves to `{ value: { isSet, version } }`, with `e.value` the value written; it is how a mod reads another plugin's state as it changes, since the types refuse `$.state.set` on another plugin's value #measured (2.1.319: a kit test, and a `claude -p` run of the watcher build, whose debug log showed its hook on board's `decisions` nested in board's write; the live run was not repeated)
- [question] Does that hook fire when the write comes from a person pressing an answer in an interactive session's pane? Only kit and `-p` writes were seen. Settle it with an interactive session, a probe that logs each `state.set` it sees, and one press.
- [fact] A `tool.check` hook's `next(e)` verdict tells refusals apart: `rule` is set for a settings rule's deny, `hook: "PreToolUse"` for a settings hook's block, and `decision: "ask"` with neither for the auto-mode classifier's denial, a permission ask in `claude -p` and `dontAsk` mode #measured (2.1.318, one planning probe run per case; the fields match the 2.1.319 types' `ToolCheckResult`)
- [trap] In all five of those refusals the `tool.call` hook's `next(e)` resolved to `{ isError: true, text }`, never `{ deny }`, so a refusal reads as a failed call unless the mod keeps the `tool.check` verdict of the same `tool_use_id` #measured (2.1.318)
- [fact] `classic.PermissionDenied` fired only for the auto-mode classifier's denial among those five cases #measured (2.1.318; a person's "No" was not tried)
- [question] What does a `tool.call` hook see when another plugin's `tool.call` hook beneath it refuses? The types give `{ deny: string }` as a refusal result, which the model reads as an error, but no probe has had a plugin refuse. Settle it with two probe plugins in a kit test and a `claude -p` run.
- [fact] Observer agents run under `CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS=1`, declared by `observer: <agent type>` in the observed agent's definition; the observer gets a digest after each tool round and one at the turn's end, and its report reaches the observed agent as a `session.append` row with `origin.kind` `observer`, a `delivery` row mid-turn and a `prompt` row that starts a turn when the agent is idle #measured (2.1.318 planning probes in `claude -p`, haiku; the origin kinds `observer` and `observer-activity` are in the 2.1.319 types)
- [trap] The main session is observed only when it runs as a declared agent (`--agent`, or the `agent` setting, which the binary routes the same way but no run tried), and a plugin's agent files cannot declare an observer: the 2.1.318 binary holds a warning that the field "is ignored for plugin agents", and `AgentSpec` for `$.agent.register` has no observer field in the 2.1.319 types #measured (`--agent` only; the warning was read from the binary's strings, not raised)
- [trap] An observer's first digest reached `session.append` with `origin.kind` `coordinator` and the later ones as `observer-activity`, while the stored transcript row of the first says `observer-activity`, so a mod filtering out observer traffic by origin must drop both kinds #measured (2.1.318)
- [fact] Two `claude -p` sessions of one inline plugin, each writing its own keys to `$.store` at once, lost no write, and each read the other's keys while both ran #measured (2.1.318 planning probes: 80 writes each 50 ms apart, then 400 each 5 ms apart, every key present afterwards)
- [fact] `$.store.set` takes no version check, while `$.state.set` takes `ifVersion` (the 2.1.319 types)
- [risk] So two writers doing a read-modify-write of one store key, such as a counter, can lose an update. Inferred from the types, not measured; within one process a mod can queue its own writes, which does not help across sessions.
- [trap] A plugin agent spawns only by its namespaced name, `<plugin>:<agent>`; the bare name fails with "not found" even when nothing else uses it #measured
- [fact] A project agent with the same name as a plugin agent owns the bare name, and the plugin agent stays reachable by its namespaced name #measured
- [fact] An agent file in a subfolder of `.claude/agents/`, such as `.claude/agents/<group>/<agent>.md`, loads as a project agent #measured (2.1.316, 2026-11-01: a headless probe on haiku, and a live session that gained the agent on reloading its agent list)
- [fact] A `.md` file with no frontmatter under `.claude/agents/`, in a subfolder included, is not loaded as an agent, so reference files an agent reads can sit beside it #measured (2.1.316, 2026-11-01: the same probe's frontmatter-less file, and nine in one subfolder in the live session, none of which appeared as agents)
- [fact] A plugin skill whose name nothing else uses answers to its bare name as well as to `/<plugin>:<skill>` #measured
- [trap] A plugin skill named like a built-in never answers to the bare name: a typed `/code-review` reaches the built-in, not the plugin's skill #measured
- [fact] A bare skill name resolves user skill first, then project skill, then built-in; a plugin skill is not in that chain when its name collides #measured
- [decision] Plugins install from this repository's marketplace, and a change is tried in a separate session with `--plugin-dir` (owner, 2026-10-24): it replaces the installed copy for that session only.
- [decision] A plugin reads machine-local data from `~/.claude/local/<plugin>/` and treats a missing file as empty, with synthetic examples in `plugins/<name>/local.example/` (owner, 2026-10-24): machine-specific data stays out of a public repository.
- [decision] Settings a plugin cannot carry live in `harness/`, installed by `bootstrap.py` (owner, 2026-10-24): the platform gives a plugin no way to set them.

## Relations

- see_also [[Mod CI Checks]]
- see_also [[Hooks Module Loader]]
- see_also [[Rewriting Session History]]
- see_also [[Development Process]]
- see_also [[Skill Loading]]
- see_also [[Teammate Mailbox]]
- see_also [[Built-in Worktrees]]
- see_also [[Guardrails]]
