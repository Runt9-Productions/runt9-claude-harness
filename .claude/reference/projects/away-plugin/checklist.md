---
title: Away Plugin Checklist
type: note
permalink: projects/away-plugin/checklist
tags:
- away
- mods
---

# Away Plugin Checklist

## Status

- **Live item:** step 5, verify
- **How far along:** tasks 01 to 04 committed
- **Blocked on:** nothing
- **Last moved:** 2026-10-31

## Build Order

01, 02, 03, 04

Each task builds on the module the one before left; 04 describes the finished behaviour.

## Checklist

- [x] 01 Scaffold the plugin and the modes core: `/mode`, band, status line, store and rebinding, the rules row and
  its re-send after compaction, the return report, with kit tests
- [x] 02 Running while away: the continuation, permission prompts refused and posted, auto mode denials posted, the
  handoff at the ceiling, with kit tests
- [x] 03 The sandbox toggle in the session root's local settings, with per-root holders, with kit tests
- [x] 04 README with the mode table and the sandbox gap, away's contract row, board README's matching line