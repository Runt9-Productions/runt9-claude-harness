---
title: Harness Migration Checklist
type: note
permalink: projects/harness-migration/checklist
tags: [migration, harness]
---

# Harness Migration Checklist

## Status

- **Live item:** 10: no-progress-reminder (#94), the status line (#93) and the preferences and remote-shell settings
  fragments (#96) are open as drafts; the mod engine notes (#97) and the GitHub App identity component (#75) are not
  started
- **How far along:** 01 to 09 merged; 07 without its judge mod, which is tabled
- **Blocked on:** the three drafts wait for the review plugins' tuning before their reviews
- **Last moved:** 2026-11-01

## Build Order

01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11

What the repository needs to develop itself comes first; pieces that already work elsewhere come later, through the
same process. 04 and 05 stack on 03: 04 adds a bootstrap component, and 05 needs 03's Python CI job.

## Checklist

- [x] 01 Scaffolding and rails: CI baseline, marketplace, version-bump check, leak scan and review agent, pre-push gate, code-review skill and CI review job
- [x] 02 teammate-delivery: the first plugin, proving install, the `--plugin-dir` loop and the TypeScript CI path
- [x] 03 bootstrap.py and the Python CI job
- [x] 04 Style-guide skills
- [x] 05 reference-kb plugin and this repository's knowledge base
- [x] 06 Delegation and the dev-process plugins, shipped as four pull requests
- [x] 07 Guardrails, plus bootstrap's settings merge (judge mod tabled)
- [x] 08 CLAUDE.md template and fragments
- [x] 09 board, handoff and away (context-budget dropped)
- [ ] 10 no-progress-reminder, the status line, settings fragments, the mod engine notes and the GitHub App identity component; the remaining machine-local hooks are dropped or stay local, outside this repository
- [ ] 11 Cleanup: remove the source copies of what moved
