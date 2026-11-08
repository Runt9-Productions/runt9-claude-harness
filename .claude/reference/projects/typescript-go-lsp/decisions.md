---
title: TypeScript Go LSP Decisions
type: note
permalink: projects/typescript-go-lsp/decisions
tags:
- plugins
- lsp
---

# TypeScript Go LSP Decisions

Rulings for the `typescript-go-lsp` plugin and the root `tsconfig.json`. Read before changing what
[[TypeScript Go LSP Spec]] says either one does.

## Decisions

- [decision] The plugin is named `typescript-go-lsp` (owner, 2026-11-07), after the server's own name. Its name can't
  be confused with the official `typescript-lsp`, and a `--plugin-dir` copy of either can't replace the other.
- [decision] The plugin runs the global `tsc` found on `PATH`, never the project's copy and never `npx` (owner,
  2026-11-07). That is the measured setup, and its requirement goes in the README.
- [decision] The interface-references trap goes in the plugin README and in a knowledge base note, not in a
  tool-routing guide (owner, 2026-11-07), since no tool-routing guide ships.
- [decision] The plugin was checked through Claude Code's real `LSP` tool before the issue was written (owner,
  2026-11-07), so the issue rests on measured behaviour.
- [decision] A tracked root `tsconfig.json` covers every mod (owner, 2026-11-07). Without a project config the server
  silently returns partial references and callers, and the per-plugin configs are generated and gitignored.
- [decision] The spec and its edit scope are approved as written (owner, 2026-11-07).
- [decision] The build runs in the session that wrote the spec, not a fresh one in the worktree (owner, 2026-11-07).
  That session had no TypeScript language server running, so there was no server to be rooted in the wrong checkout.

- [fact] One root project is enough. `claude-code` never resolves in it, so the five augmentations never merge, and
  navigation over them was unaffected (measured through the `LSP` tool, 2026-11-07).
- [decision] The root `tsconfig.json` maps `"*"` to `./plugins/*/types/index.d.ts` under `paths` (owner,
  2026-11-07). A plugin imported by its bare name (watcher's `from 'board'`) then resolves to that plugin's types, so
  references reach across plugins. A specifier with no matching plugin falls back to normal resolution.
- [decision] Ship with the cross-plugin gap documented (owner, 2026-11-07). Once Claude Code writes a plugin's own
  `tsconfig.json`, that plugin's files leave the root project, and references from other plugins stop showing up.
  That file is generated and gitignored, so this repository can't change it.

## Relations

- part_of [[TypeScript Go LSP Plugin]]
