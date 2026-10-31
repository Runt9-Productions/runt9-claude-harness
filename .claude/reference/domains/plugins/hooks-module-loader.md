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

> **Scope.** What the loader accepts when a mod's hooks module is split across files: passing `$` and `on` to imported functions, atoms shared between files, matcher values, and the `modules` list. Every `#measured` line was measured on Claude Code 2.1.316 with synthetic probe plugins, each run through `claude plugin validate --strict` and a `claude plugin test` kit test, with a refused variant beside each accepted one. The board plugin's `register` (`plugins/board/hooks/register.tsx:49`) and `updateCounter` (`plugins/board/hooks/persistence.ts:189`) were read as the live example, and the "Create a mod" page of Claude Code's docs was read for its rules on passing `$`. Not covered: `memberOf` and `derive`, which the refusal text names but no probe used; default exports and re-exports; a function declaration nested inside another function, which the docs say fails but no probe tried; and whether a live session dispatches a matcher the loader lists as `?` the way the kit does, since only the kit was run and its `$.ui.mount` answered "no implementation for ui.render" for every probe pane, including one with a literal id.

Read this before splitting a mod's hooks module into files, or before moving a function, an atom or a matcher
value from one file to another. Every refusal here fails `claude plugin validate`. The two types-contract refusals
(an atom key missing from `interface PluginState`, and a top-level `export {}`) still pass the kit test, and the
others also stop the kit loading the module, so run validate as well as the tests. An imported matcher passes both
validate and the kit test, but validate lists it as `?`.

## Observations

- [fact] A hooks module may pass `$` to a function imported from another file when that function is a `function` declaration #measured (the docs say otherwise, below, so this is the first line to re-measure when the version moves)
- [vendor] "Create a mod" (https://code.claude.com/docs/en/plugins/mods/create.md, Anthropic's docs, fetched 2026-10-31) says: "Passing `$` to a method, a function defined inside the hook, or a function you import from another of your files fails validation." On 2.1.316 the imported-function case passes (line above, and the board's `bind($)` in `plugins/board/hooks/register.tsx`), so a later release may tighten to match the docs.
- [trap] Passing `$` to an imported arrow function held in a `const` is refused: "past an import $ is followed only into a function declaration (function bump($) { ... })" #measured (validate exits 1 and the kit reports "hooks module did not load")
- [fact] An imported function may register hooks by calling `on`, and validate lists those hooks under the hooks module's own entry #measured (an arrow function in a `const` taking `on` was accepted too; the declaration rule is about `$`)
- [trap] An atom exported from one file and passed to `read` or `update` in another is refused: the call "takes a source the scan can read: a reference whose plugin and key are string literals, or what atom, memberOf or derive (imported from "claude-code") made of one, written there or in a const of this file" #measured (both `read` and `update` refused, and the kit reports "hooks module did not load")
- [fact] Declaring the same atom (same plugin and key) in each file that uses it is accepted, and the declarations share one value at run time #measured (an `update` through one file's atom was seen by a `read` through the other's)
- [fact] An inline `{ plugin, key } as const` reference passed to `read` is accepted and reads that same value #measured
- [trap] An atom whose key the types contract's `interface PluginState` does not name fails validate ("is not declared: the manifest's types contract must name it"), while the kit test passes #measured
- [trap] A types contract may export only types; a top-level `export {}` fails validate ("a contract exports types and nothing else"), while the kit test passes #measured
- [fact] Validate lists the state reads and writes of the hooks module and every file it imports under the module's own entry #measured (a write made only in an imported file is listed under the module)
- [trap] An atom picked at run time, such as looked up in a map, is refused with the same message, even in the file that declares it, so the board spells one `update` per atom (`updateCounter`, `plugins/board/hooks/persistence.ts:189`) #measured
- [trap] A matcher value read from an imported constant is listed as `?` (`tool=?`, `requestId=?`), and validate still passes; the same value in a `const` of the registering file is listed by value #measured
- [fact] In the kit, a `tool.call` hook whose matcher was imported answers only its own tool: a call to another tool gets the kit's "no implementation for tool.call", exactly as when the same value sits in a local `const` #measured
- [question] What settles live dispatch of a `?` matcher: a `claude --plugin-dir` session with a `tool.call` hook whose imported matcher names one tool and which logs each call it receives with `$.ui.log`, then a turn that uses a different tool. The docs say validate runs the same static analysis as loading and that a hook missing from its listing is not called, so the listing does feed the live engine. Until it is measured, spell a matcher value in the file that registers the hook, as the board does for its pane id (`PANE`, `plugins/board/hooks/register.tsx:30`).
- [fact] A second entry in `hooks.json` `modules` is refused: "hooks.json `modules` names one hooks module per plugin; a second entry is refused" #measured (the kit then reports "no hooks module to load")

## Relations

- part_of [[Plugin Platform]]
