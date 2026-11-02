# Lens: mod-contract

Checks a diff to a TypeScript mod (a plugin whose hooks/hooks.json lists modules) against what the real Claude Code engine does and what sibling plugins expect of it, which CI's stubbed kit tests cannot show.

## The question

Does this mod still hold against the engine it actually runs in and against every plugin that depends on it?

CI runs the mod kit's tests, but those answer engine calls with stubs the test author wrote. A stub can agree with a
wrong assumption, so passing tests do not settle this.

## Before the diff

Read "Plugin contracts" and "Test-quality traps" in `.claude/code-review-profile.md`. Then read the types Claude Code
wrote into the plugin's `.claude-plugin/types/`; they are the closest thing to the engine's own statement of its API.
If they are missing, load the mod once as `CLAUDE.md` describes so they are written.

## In scope

- **Engine assumptions.** Hook ordering, what calling or not calling `next` does, behaviour across a hot reload, a
  compaction or a session id change, and the lifetime of `$.store`, `$.state` and `$.tool.call` results. Check each
  against the types.
- **Cross-plugin contracts.** Strings, state and `dependencies` shared with another plugin. Check both sides, and
  check that both plugins' versions rose.
- **Drifting stand-ins.** A test that copies another plugin's behaviour instead of loading it.
- **Per-session cost.** Work a hook does on every event, every turn or every message: what it reads, stores or sends,
  and whether it grows over a long session.

## Out of scope

Style and structure belong to `code-health`, and guards against hostile input to `guard-security`.

## How far to read

The changed module, every hook it registers, the types it uses, its tests, and the other side of each contract it
touches.

## Severity

Engine behaviour the types do not settle is an open question that names the measurement that would settle it.

Critical when the mod breaks a session or another plugin under normal use. Normal for avoidable per-session cost.
For everything else, use the profile's "Severity calibration".
