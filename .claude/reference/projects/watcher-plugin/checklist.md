---
title: Watcher Plugin Checklist
type: note
permalink: projects/watcher-plugin/checklist
tags:
- watcher
- mods
---

# Watcher Plugin Checklist

## Status

- **Live item:** none
- **How far along:** 01 to 06 built; verification next
- **Blocked on:** nothing
- **Last moved:** 2026-11-06

## Build Order

01, 02, 03, 04, 05, 06

01 is independent of 02 and 03 and may run first. Each of 02 to 05 builds on the module the one before left; 04 needs
01; 06 describes the finished behaviour.

## Checklist

- [x] 01 Board: a plugin's own decision may keep its answer (posting plugin recorded from the call's origin, no
  delivery to the model, pressed option kept apart from the note), README section for other plugins, contract row,
  version rise, with kit tests
- [x] 02 Scaffold the watcher plugin and the check loader (three locations, precedence by file name, frontmatter
  checked, a bad file reported and skipped), the judge prompt and the 16 shipped checks, with kit tests
- [x] 03 Capture and judge: per-agent activity buffers, digests cut to each check's `reads`, the triggers, one
  batched Haiku call per trigger with a structured answer per check, with kit tests over a stubbed model
- [x] 04 Delivery and quiet: nudges as observations, teammate nudges to the lead, flags as board decisions whose
  answers the watcher keeps, Send to the session, the confidence bar, caps, dedupe and the useful and noise counts,
  with kit tests
- [x] 05 Shared state and the inputs that need more than the digest: per-session summary, files and findings in the
  store, other sessions' entries for the overlap check, knowledge base notes for edited sources, plan files, and the
  secret pattern match, with kit tests
- [x] 06 README, the watcher's contract row, `local.example/` with a sample check, and the platform facts the project
  measured moved into [[Plugin Platform]]

## Relations

- part_of [[Watcher Plugin]]
