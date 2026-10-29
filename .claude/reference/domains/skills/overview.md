---
title: Skill Loading
type: note
permalink: skills/overview
tags: [skills, claude-code, compaction]
verified: 2026-10-26
coverage: partial
measured_on: "Claude Code 2.1.310"
---

# Skill Loading

> **Scope.** When a skill loads on its own, what of it survives compaction, how a skill pulls in a local file at load, and how its arguments are substituted into its text. The `#measured` lines are carried from headless trials (Opus, Sonnet and Haiku on small fixtures) and from interactive session transcripts up to 2.1.310, and were not re-measured when this note was written, except the argument-substitution lines, measured on 2.1.312 in two headless runs of a plugin skill. Not covered: teammate compaction, whether text a skill injects at load is in the copy re-attached after compaction, and how skill names resolve, which is in the plugin note.

Read this before relying on a skill being in context at a given moment, or before adding a hook to put one back. The
headless and interactive paths behave differently after compaction, so a measurement on one does not answer for the
other.

## Observations

- [fact] A skill whose description names the moment it applies loaded before the first write in every headless run that wrote new code (4 of 4, plus a control), and did not load for a two-bug fix that wrote no comment #measured (seven Opus runs on one fixture: enough to act on, not a rate)
- [fact] A delegation skill loaded before the first `Agent` call in 6 of 6 runs whose prompt asked for an agent #measured
- [fact] Three skills loaded in turn were all quoted correctly afterwards without reloading #measured (Haiku, one run)
- [vendor] After compaction Claude Code re-attaches the most recent invocation of each skill, keeping its first 5,000 tokens, within 25,000 tokens combined, filled from the most recently invoked skill, so older skills can be dropped entirely.
- [fact] Interactive sessions re-attached each invoked skill's text after a manual `/compact` too #measured (an `invoked_skills` attachment after every compaction that followed a skill invocation)
- [trap] A resumed headless `claude -p` session given `/compact` re-attached no skill content; only the compaction summary carried it #measured (Sonnet, one run). A one-line marker survives in a summary; a long guide does not.
- [risk] A skill invoked early is the first dropped when later skills fill the 25,000-token budget. Not measured; a session that invokes skills past the budget and then compacts would show it.
- [fact] A skill that injects a file from outside the working directory at load (`` !`cat <path>` ``) needs `allowed-tools: Read(<path>/**)`; a `Bash(cat ...)` rule does not lift the outside-working-directory block #measured
- [trap] An injected command ending `|| true` that prints nothing renders as "(Bash completed with no output)", so a skill that wants a clear empty marker prints one itself (`|| echo "(none)"`) #measured
- [trap] A dollar sign followed by a digit anywhere in a skill's text, code blocks included, is replaced by that positional argument at load, so an awk field such as `$1` reaches the model as the second argument's value #measured (Claude Code 2.1.312, headless)
- [fact] A backslash before it (`\$1`) keeps the field literal: the loaded text shows `$1` without the backslash #measured (Claude Code 2.1.312, headless)
- [vendor] The same backslash does not stop substitution of a `${CLAUDE_*}` variable, and an indexed placeholder with no matching argument stays as written.
- [decision] Every living doc ships as a skill (owner, 2026-10-24): a skill loads at the moment it applies, and several coexist.
- [decision] No hook reloads skills after compaction (owner, 2026-10-26): interactive sessions already re-attach invoked skills, and the budget is probed before any hook is written.
- [decision] A skill reads its user's local additions by injecting `~/.claude/local/<skill>/additions.md` at load (owner, 2026-10-26): injected text arrives with the skill, not as a tool result an agent can skip.

## Relations

- see_also [[Plugin Platform]]
