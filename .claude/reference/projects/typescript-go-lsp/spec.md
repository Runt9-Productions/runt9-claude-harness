---
title: TypeScript Go LSP Spec
type: note
permalink: projects/typescript-go-lsp/spec
tags:
- plugins
- lsp
- typescript
---

# TypeScript Go LSP Spec

The per-file map for issue #131, with the rulings in [[TypeScript Go LSP Decisions]]. Line numbers are at 0aeac3f.

## The plugin

- `plugins/typescript-go-lsp/.claude-plugin/plugin.json`: `name`, `description`, `version` `0.1.0`, and one
  `lspServers` entry, `typescript`, running `tsc` with `["--lsp", "--stdio"]`. `extensionToLanguage` maps `.ts`,
  `.mts` and `.cts` to `typescript`, `.tsx` to `typescriptreact`, `.js`, `.mjs` and `.cjs` to `javascript`, and `.jsx`
  to `javascriptreact`. No `startupTimeout`: the first answer came back in under 0.1 s.
- `plugins/typescript-go-lsp/README.md`: what it does, and the requirement (TypeScript 7 installed globally under the
  Node that launches Claude Code, since `tsc` is found on `PATH`). Four traps:
  - answers are complete only inside a project with a `tsconfig.json`;
  - references are searched only in the project that owns the file, so references across plugins are complete only
    while the target plugin has no generated `plugins/<name>/tsconfig.json` (delete it, or use `git grep`);
  - for a method that implements an interface member, `findReferences` and `incomingCalls` both return the whole
    family, so filter the call sites by file and line;
  - edits made outside Claude Code's file-editing tools aren't seen during the session.
- `.claude-plugin/marketplace.json`: an entry with name, description and `./plugins/typescript-go-lsp`, shaped like
  the `chrome-devtools` entry.

## The root project

- `tsconfig.json` at the root: the compiler options of the config Claude Code generates for a mod
  (`plugins/<name>/.claude-plugin/types/tsconfig.json`), with no `typeRoots` or `types`, and `include` set to
  `plugins/*/hooks`, `plugins/*/types` and `plugins/*/tests`. One addition, `paths` `"*"` to
  `./plugins/*/types/index.d.ts`, resolves an import of another plugin by name (watcher's `from 'board'`) to that
  plugin's types; a name with no such plugin resolves as it would without it. A generated
  `plugins/<name>/tsconfig.json` is closer to its plugin's files, so it wins once it exists, and references to that
  plugin's symbols from other plugins are then missing.
- CI is unchanged. `.github/workflows/ci.yml:235` to `:249` ("Every mod type-checks, lints and passes its tests") type-checks each mod with `tsc -p` on its generated config,
  and refuses to lint a mod without one.
- `CLAUDE.md`, "Layout": one line saying the root `tsconfig.json` exists so the language server knows every mod
  without one being loaded, and that CI type-checks each mod with its own generated config.

## The knowledge base

- A new note, `.claude/reference/domains/lsp/typescript.md` ("TypeScript Language Server"), with `measured_on`
  Claude Code 2.1.319 and TypeScript 7.0.2. It holds the four traps above, each marked as measured, plus:
  - the server builds an inferred project from the opened files when no config covers a file;
  - the `claude-code` module types exist only after a mod is loaded, so hover on engine types needs that;
  - an out-of-range request comes back as "No ... found", not as an error.
- `.claude/reference/README.md`: an entry-point row for that note, and a row for this project.
- `.claude/reference/domains/plugins/mod-ci.md:39` says type-aware oxlint passes silently without types. Re-check it
  with the root config present, since oxlint may now find the root project.

## Draft ticket description

Issue #131 as posted.

## Relations

- part_of [[TypeScript Go LSP Plugin]]
