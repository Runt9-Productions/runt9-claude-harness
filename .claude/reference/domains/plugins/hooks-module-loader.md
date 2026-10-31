---
title: Hooks Module Loader
type: note
permalink: plugins/hooks-module-loader
tags: [plugins, mods, hooks-module, atoms, loader]
verified: 2026-10-31
coverage: partial
measured_on: "Claude Code 2.1.316"
sources:
  - plugins/board/hooks/register.tsx
  - plugins/board/hooks/persistence.ts
---

# Hooks Module Loader

> **Scope.** What the loader accepts when a mod's hooks module is split across files: passing `$` and `on` to imported functions, atoms shared between files, matcher values, and the `modules` list. Every `#measured` line was measured on Claude Code 2.1.316 with synthetic probe plugins, each run through `claude plugin validate --strict` and a `claude plugin test` kit test, with a refused variant beside each accepted one. The board plugin's `register` (`plugins/board/hooks/register.tsx:47`) and `updateCounter` (`plugins/board/hooks/persistence.ts:189`) were read as the live example. Not covered: `memberOf` and `derive`, which the refusal text names but no probe used; default exports and re-exports; a function declaration nested inside another function; and whether a matcher the loader lists as `?` dispatches differently in a live session, since the kit's `$.ui.mount` answered "no implementation for ui.render" for every probe pane, including one with a literal id.

Read this before splitting a mod's hooks module into files, or before moving a function, an atom or a matcher
value from one file to another. Every refusal here fails `claude plugin validate`, and all but the types-contract
one also stop the kit loading the module, so run validate as well as the tests. The imported matcher passes both
and still changes what the loader sees.

## Observations

- [fact] A hooks module may pass `$` to a function imported from another file when that function is a `function` declaration #measured
- [trap] Passing `$` to an imported arrow function held in a `const` is refused: "past an import $ is followed only into a function declaration (function bump($) { ... })" #measured (validate exits 1 and the kit reports "hooks module did not load")
- [fact] An imported function may register hooks by calling `on`, and validate lists those hooks under the hooks module's own entry #measured (an arrow function in a `const` taking `on` was accepted too; the declaration rule is about `$`)
- [trap] An atom exported from one file and passed to `read` or `update` in another is refused: the call "takes a source the scan can read: a reference whose plugin and key are string literals, or what atom, memberOf or derive (imported from "claude-code") made of one, written there or in a const of this file" #measured (both `read` and `update` refused)
- [fact] Declaring the same atom (same plugin and key) in each file that uses it is accepted, and the declarations share one value at run time #measured (an `update` through one file's atom was seen by a `read` through the other's)
- [fact] An inline `{ plugin, key } as const` reference passed to `read` is accepted and reads that same value #measured
- [trap] An atom whose key the types contract's `interface PluginState` does not name fails validate ("is not declared: the manifest's types contract must name it"), while the kit test passes #measured
- [fact] A types contract may export only types; a top-level `export {}` is refused ("a contract exports types and nothing else") #measured
- [fact] Validate lists the state reads and writes of the hooks module and every file it imports under the module's own entry #measured (a write made only in an imported file is listed under the module)
- [trap] An atom picked at run time, such as looked up in a map, is refused with the same message, even in the file that declares it, so the board spells one `update` per atom (`updateCounter`, `plugins/board/hooks/persistence.ts:189`) #measured
- [trap] A matcher value read from an imported constant is listed as `?` (`tool=?`, `requestId=?`), and validate still passes; the same value in a `const` of the registering file is listed by value #measured (in the kit, a `tool.call` hook whose matcher was imported still fired)
- [question] Whether the engine treats a `?` matcher differently in a live session is open; until it is measured, spell a matcher value in the file that registers the hook, as the board does for its pane id (`PANE`, `plugins/board/hooks/register.tsx:30`).
- [fact] A second entry in `hooks.json` `modules` is refused: "hooks.json `modules` names one hooks module per plugin; a second entry is refused" #measured (the kit then reports "no hooks module to load")

## Relations

- part_of [[Plugin Platform]]
