---
title: Test Review Breaks Checklist
type: note
permalink: projects/test-review-batch/checklist
tags: [test-review, cost]
---

# Test Review Breaks Checklist

## Status

- **Live item:** none; built in #90
- **How far along:** 01 to 07 built and reviewed; test-review 0.2.0, lens-review 0.2.0, delegation 0.1.2, develop
  0.1.4, harness 0.1.18
- **Blocked on:** nothing
- **Last moved:** 2026-11-01

## Build Order

01, 02, 03, 05, 06, 07, 04

The variants are measured before one ships, and the reviews read what ships.

## Checklist

- [x] 01 Project notes
- [x] 02 Reviewer variants measured on mutant-graded suites
- [x] 03 Final reviewer in the plugin, the in-copy break script removed, engineer testing lines in both engineer files
- [x] 04 Test review, lens review and reviewer guide on the pull request: the test review applied, with the reviewer
  now running its breaks in the foreground; the lens review at 0 Critical, both Highs and three Normals fixed and one
  Normal declined
- [x] 05 lens-review plugin: one reviewer agent, its agent and lens templates, no panel or deep pass
- [x] 06 This repository's lens agent and nine lenses, the review and development profiles, the leak gate on the new
  path, develop's step 7, harness 0.1.18 and develop 0.1.4
- [x] 07 One `/lens-review` run of the built plugin on a review benchmark: 19 of 24 planted defects, no noise
