---
title: TypeScript Go LSP Plugin
type: note
permalink: projects/typescript-go-lsp/overview
tags:
- plugins
- lsp
- typescript
status: complete
opened: '2026-11-07'
---

# TypeScript Go LSP Plugin

Adds a `typescript-go-lsp` plugin so Claude Code's `LSP` tool can answer for TypeScript and JavaScript, plus a tracked
root `tsconfig.json` so its answers on this repository's mods are complete without loading a mod (issue #131). It ends
when that pull request merges.

## Where it stands

- [status] Complete: item 01 built in #132; the durable facts are in [[TypeScript Language Server]].

## Goal

- With the plugin loaded, `documentSymbol`, `goToDefinition`, `findReferences`, `goToImplementation`, call hierarchy,
  `hover` and `workspaceSymbol` give correct answers on TypeScript.
- In a fresh checkout with no mod loaded, a first `findReferences` or `incomingCalls` on a mod symbol returns every
  reference or caller.
- The traps an agent meets with this server are written down where an agent reads them before relying on an answer.

## Designs ruled out

- The official `typescript-lsp` plugin: it runs `typescript-language-server`, which drives `tsserver`, and TypeScript 7
  ships no `tsserver`. It would mean installing TypeScript 6 beside 7.
- Resolving `tsc` from the project's `node_modules/.bin`: nobody has measured whether a plugin's LSP command can be
  relative to the project root, and a repo without TypeScript 7 installed locally would get no server.
- `npx tsc`: it can download a package.
- Only documenting "load the mod first" without a root config: an agent that skips that step gets partial answers
  with no warning.
- A tool-routing guide for the interface-references trap: the owner decided on 2026-10-24 that none ships.

## Relations

- see_also [[TypeScript Go LSP Decisions]]
- see_also [[TypeScript Go LSP Checklist]]
- see_also [[TypeScript Go LSP Spec]]
- see_also [[TypeScript Go LSP Estimate]]
