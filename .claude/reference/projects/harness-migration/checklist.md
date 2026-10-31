---
title: Harness Migration Checklist
type: note
permalink: projects/harness-migration/checklist
tags: [migration, harness]
---

# Harness Migration Checklist

## Status

- **Live item:** 08, the CLAUDE.md template and fragments: bootstrap's fragment install (#32) is merged, and #34 is in
  review
- **How far along:** 01 to 06 merged; 07's first pull request, bootstrap's settings merge with the credential-store
  deny fragment, in review; its auto-mode and sandbox fragment and the judge plugin follow
- **Blocked on:** nothing
- **Last moved:** 2026-10-30

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
- [ ] 07 Guardrails, plus bootstrap's settings merge
- [ ] 08 CLAUDE.md template and fragments
- [ ] 09 context-budget, board, handoff and away
- [ ] 10 no-progress-reminder and whatever is left
- [ ] 11 Cleanup: remove the source copies of what moved
