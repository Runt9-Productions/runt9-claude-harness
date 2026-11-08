---
title: TypeScript Go LSP Estimate
type: note
permalink: projects/typescript-go-lsp/research/estimate
tags:
- plugins
- estimate
---

# TypeScript Go LSP Estimate

**Small.** Production 130 to 190 lines over 7 files, two of them new to the plugin:

| Piece | Lines |
|---|---|
| `plugin.json` | 20 |
| README | 35 to 55 |
| marketplace entry | 5 |
| root `tsconfig.json` | 20 to 30 |
| `CLAUDE.md` | 2 to 4 |
| new knowledge base note | 40 to 70 |
| entry-point rows | 2 |

No tests: the plugin has no code, and the check is a `claude -p --plugin-dir` run. Most of the cost is verification,
not code: running the `LSP` tool against known answers on a fresh checkout.

## Comparison

`fc89a17` (#124) added the `chrome-devtools` plugin, which only declares a server: `plugin.json` 8 lines, `.mcp.json`
23 and README 51, plus a marketplace entry. This change has the same shape, with `lspServers` instead of `.mcp.json`,
and adds the root `tsconfig.json` and a knowledge base note.

## Risks

- One root project merges five plugins' `claude-code` augmentations. A clash would show up as wrong hovers or type
  errors in the root project. It shouldn't affect navigation, but that is not measured.
- Type-aware oxlint may pick up the root project for a mod whose generated config is missing. That changes the silent
  pass that `mod-ci.md` describes, though CI checks that the config exists before it lints.

## Not verified

- That the language server picks the root `tsconfig.json` for a file in an unloaded mod. If it doesn't, the fix is a
  per-plugin config, which adds about 7 small files.
- `tsc --lsp` doesn't appear in `tsc --help` for 7.0.2. The TypeScript 7.0 announcement (Microsoft devblogs, 2026)
  says the native port serves LSP, and editor configs run `tsc --lsp --stdio`.

## Actual

139 production lines added over 9 files, against an estimate of 130 to 190 over 7. No tests. The two extra files are
the one-line back-links in the plugins and worktrees notes. The estimate missed the wildcard `paths` mapping that
references across plugins needed, and the review fix round.

## Relations

- part_of [[TypeScript Go LSP Plugin]]
