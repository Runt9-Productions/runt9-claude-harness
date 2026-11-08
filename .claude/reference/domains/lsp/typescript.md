---
title: TypeScript Language Server
type: note
permalink: lsp/typescript
tags: [lsp, typescript, language-server, plugins]
verified: 2026-11-07
coverage: partial
measured_on: "Claude Code 2.1.319, TypeScript 7.0.2"
sources:
  - tsconfig.json
  - plugins/typescript-go-lsp/.claude-plugin/plugin.json
---

# TypeScript Language Server

> **Scope.** What TypeScript 7's built-in server (`tsc --lsp --stdio`, run by the `typescript-go-lsp` plugin) answers through Claude Code's `LSP` tool, on this repository's mods and on a synthetic two-file fixture with its own `tsconfig.json`. Every `#measured` line comes from `claude -p --plugin-dir plugins/typescript-go-lsp` runs on 2026-11-07, each prompt naming the exact calls, with the expected answer counted beforehand with `git grep -ow` (repository) or by hand (fixture); the root `tsconfig.json` and the plugin's `plugin.json` were read. The module resolution lines were measured with `tsc --traceResolution` on the root project. Not covered: a configured project much larger than this repository's 50 mod files, whether automatic type acquisition ever downloads a package, how a JSON-RPC error response is shown, a JavaScript-only project, and findReferences from watcher's side while board has a generated config.

Read this before trusting a `findReferences`, `incomingCalls` or `hover` answer on TypeScript, and before changing the
root `tsconfig.json`. Most of what goes wrong comes back as a short or empty answer with no error.

## Observations

- [trap] With no `tsconfig.json` covering a file, a first `findReferences` or `incomingCalls` returns only what the files opened so far reach: `progressText` (`plugins/board/hooks/checklist.ts:7`) gave 1 of 7 references, `BoardDecision` 2 of 38, and `readBoardAnswers` (`plugins/watcher/hooks/deliver.ts:210`) "No incoming calls found (nothing calls this function)" against one caller #silent-failure #measured (root `tsconfig.json` moved aside)
- [risk] The mechanism behind that is the server's inferred project, whose root files are those the tool has opened plus their imports; this comes from the server log of an earlier recorded run and was not re-recorded here.
- [fact] With the root `tsconfig.json`, the same first calls are complete: 7 of 7 for `progressText`, 38 of 38 for `BoardDecision` across board's and watcher's files, all 3 callers of `nextId` (`plugins/board/hooks/persistence.ts:169`) and the one caller of `readBoardAnswers` (`register`, call at `register.tsx:72:37`) #measured
- [fact] The root project's `paths` entry `"*": ["./plugins/*/types/index.d.ts"]` is what resolves watcher's `import type { BoardDecision } from 'board'` (`plugins/watcher/hooks/deliver.ts:3`) to `plugins/board/types/index.d.ts`; without it the import is unresolved and those 9 references are missing #measured
- [fact] The mapping leaves other bare imports alone: `'typescript'` resolves to the same `node_modules` file with and without it, and `'claude-code'` stays unresolved in both #measured (`tsc --traceResolution`)
- [trap] A file belongs to the project of its nearest `tsconfig.json`, and references are searched only in that project: once `plugins/board/tsconfig.json` was generated, `findReferences` on `BoardDecision` in board's types gave 29, board's own, and missed watcher's 9 #silent-failure #measured
- [fact] So references across plugins are complete only while the target plugin has no generated `plugins/<name>/tsconfig.json`; deleting that file, or `git grep`, gives the full set.
- [fact] A generated `plugins/<name>/tsconfig.json` otherwise wins cleanly: with board's present, `progressText` still gave 7 references with no duplicates, and watcher's files still answered from the root project #measured
- [trap] The `claude-code` module resolves only in a mod's generated config, so in the root project `hover` on an engine type such as `EngineInterface` (`persistence.ts:169:33`) returns "No hover information available"; with the mod's generated config present it returns the interface with its docs #measured
- [fact] The five `declare module 'claude-code'` blocks in `plugins/*/types/index.d.ts` do not merge in the root project, since the module they augment never resolves there: `findReferences` on `PluginState` in board's types returns only its own declaration, and navigation in away, board and watcher was unaffected #measured
- [trap] For a method that implements an interface member, `findReferences` and `incomingCalls` return the whole family: on the fixture's `Circle.area`, references included `Shape.area` and `Square.area` (5 in all), and callers included `total`, which calls only `Shape.area`. Filter by file and line #measured
- [trap] A change made outside Claude Code's file tools is not seen during the session: after a shell script appended a call to the fixture, `findReferences` still gave 6 where the file on disk had 7, while the same kind of change made with the Edit tool gave 7 #silent-failure #measured
- [fact] A cold start is fast: from Claude Code starting the server to its answer to the first request took 42 to 44 ms on the root project and 58 ms on an inferred one, `initialize` alone 22 to 25 ms, so the plugin sets no `startupTimeout` #measured (Claude Code's debug log, four sessions)
- [trap] An out-of-range position is not an error: `hover` at line 999 returns "No hover information available. This may occur if ..." and `findReferences` at character 200 returns "No references found. This may occur if ...", both with `is_error` false #measured
- [fact] The server published diagnostics for no source file, only an empty set for `tsconfig.json`, even with a type error in a file it had opened and after an Edit to one, so Claude Code shows no TypeScript errors from this server #measured (Claude Code's debug log)

## Relations

- see_also [[Built-in Worktrees]]
- see_also [[Mod CI Checks]]
