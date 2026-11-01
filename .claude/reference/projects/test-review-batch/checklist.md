---
title: Test Review Breaks Checklist
type: note
permalink: projects/test-review-batch/checklist
tags: [test-review, cost]
---

# Test Review Breaks Checklist

## Status

- **Live item:** 06 this repository's lens layout and the leak gate on it
- **How far along:** the final reviewer and the engineer's testing lines are in; test-review 0.2.0, delegation 0.1.2;
  the lens-review plugin is in at 0.2.0
- **Blocked on:** nothing
- **Last moved:** 2026-11-01

## Build Order

01, 02, 03, 05, 06, 07, 04

The variants are measured before one ships, and the reviews read what ships.

## Checklist

- [x] 01 Project notes
- [x] 02 Reviewer variants measured on mutant-graded suites
- [x] 03 Final reviewer in the plugin, the in-copy break script removed, engineer testing lines in both engineer files
- [ ] 04 Test review, lens review and reviewer guide on the pull request
- [x] 05 lens-review plugin: one reviewer agent, its agent and lens templates, no panel or deep pass
- [ ] 06 This repository's lens agent and nine lenses, the review and development profiles, the leak gate on the new
  path, develop's step 7, harness 0.1.18 and develop 0.1.4
- [ ] 07 One `/lens-review` run of the built plugin on a review benchmark
