---
title: Harness Migration
type: note
permalink: projects/harness-migration/overview
tags: [migration, harness]
status: implementation
opened: 2026-10-24
---

# Harness Migration

Builds this repository's plugins and `harness/` parts from an existing Claude Code harness. Each piece is audited
before it is copied, made generic, and arrives through a reviewed pull request. The project ends by removing the
source copies of what moved.

## Where it stands

- [status] Steps 01 to 08 are merged, 07 without its judge mod, which is tabled. 09 is under way: board and handoff are merged, away is in progress and context-budget is dropped. 10's pieces in this repository are filed as issues.

## Documents

- [[Harness Migration Checklist]]: the steps, in order, and which one is live
- [[Harness Migration Decisions]]: decisions taken and questions still open
- [[Harness Migration Spec]]: the settled design of steps 03 to 06

## Relations

- see_also [[Plugin Platform]]
- see_also [[Development Process]]
- see_also [[Skill Loading]]
