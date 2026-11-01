---
title: Test Review Breaks Spec
type: note
permalink: projects/test-review-batch/spec
tags: [test-review, cost]
---

# Test Review Breaks Spec

The settled design for #55. The rulings behind it are in [[Test Review Breaks Decisions]].

## What ships

- **One agent, no coordinator.** The skill's frontmatter has `context: fork` and `agent: test-review:test-reviewer`,
  so its body is the reviewer's prompt: read the profile, find the scope, read the references, copy dirty production
  files aside, review, report.
- **Breaks from the rules.** The reviewer lists each rule the spec or documented contract of the production code
  states and makes one break per rule, the smallest change a plausible wrong reading of it would make. It applies
  each break, runs the tests with the profile's run command, and restores before the next: from git for a clean file,
  from its copy for a dirty one, checked with `git status` and `git diff`. A break no test catches marks a rule the
  tests miss, and the reviewer fixes or adds a test until one does. It runs the breaks again after its changes.
- **Effort.** The agent sets `model: opus` and `effort: medium`.
- **Profile.** No section beyond the default branch, test kinds, checks, reference files and suite policy.
- **Engineer.** Three lines in the engineer's "While working" section: tests check the spec, the fewest tests that
  show the code does what the spec asks, and a test exists for confidence, not for a count.

## Per-file map

- `plugins/test-review/skills/test-review/SKILL.md`: forks into the agent and carries the steps.
- `plugins/test-review/agents/test-reviewer.md`: the four criteria, breaks from the rules, in-place restore, the
  report; medium effort.
- `plugins/test-review/skills/test-review/scripts/`: removed.
- `plugins/test-review/skills/test-review/references/profile-template.md` and `.claude/test-review-profile.md`: no
  section for the script.
- `plugins/test-review/README.md`, `.claude-plugin/plugin.json`: what ships; version 0.2.0.
- `.claude/agents/engineer.md` and `plugins/delegation/templates/engineer.md`: the testing lines; delegation 0.1.2.

## Relations

- part_of [[Test Review Breaks]]
