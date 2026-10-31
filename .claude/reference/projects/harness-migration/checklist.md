---
title: Harness Migration Checklist
type: note
permalink: projects/harness-migration/checklist
tags: [migration, harness]
---

# Harness Migration Checklist

## Status

- **Live item:** 09: board (#54) and handoff (#53) are merged, and away is in progress as #67; context-budget is
  dropped (#73, closed as not planned)
- **How far along:** 01 to 08 merged; 07 without its judge mod, which is tabled; 10's pieces in this repository are
  filed as #74 and #75
- **Blocked on:** nothing outside the project
- **Last moved:** 2026-10-31

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
- [ ] 09 board, handoff and away (context-budget dropped)
- [ ] 10 no-progress-reminder and the GitHub App identity component; the remaining machine-local hooks are dropped or stay local, outside this repository
- [ ] 11 Cleanup: remove the source copies of what moved
