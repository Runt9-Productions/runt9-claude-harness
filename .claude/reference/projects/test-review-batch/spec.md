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
  files into a directory outside the working tree, review, report.
- **Breaks from the rules.** The reviewer lists each rule the spec or documented contract of the production code
  states and makes one break per rule, the smallest change a plausible wrong reading of it would make. It applies
  each break, runs the tests with the profile's run command, and restores before the next: from git for a clean file,
  from its copy for a dirty one, checked with `git status` and `git diff`. Breaks and tests run in the foreground,
  since the review ends with the reviewer's turn and a command still running in the background is cut off with its
  break left in the code. A break no test catches marks a rule the tests miss, and the reviewer fixes or adds a test
  until one does. It runs the breaks again after its changes.
- **Effort.** The agent sets `model: opus` and `effort: medium`.
- **Profile.** No section beyond the default branch, test kinds, checks, reference files and suite policy.
- **Engineer.** Three lines in the engineer's "While working" section: tests check the spec, the fewest tests that
  show the code does what the spec asks, and a test exists for confidence, not for a count.

## Lens review

- **One reviewer.** The `lens-review` skill forks into the repository's `lens-review` agent with `context: fork` and
  `agent: lens-review`. The agent lists the lens files with their one-line summaries, applies `auto`, `default` or
  the ids given, reads each lens it picked whole, and writes the graded report. No deep pass, no Agent tool.
- **Diff index.** The skill indexes the fetched diff from a run directory under the output root with the plugin's
  `diff_index.py`, which runs `git apply --numstat` in the run directory under a `GIT_CEILING_DIRECTORIES` ceiling,
  since inside a checkout `git apply` drops every path outside the current directory.
- **Lenses.** Each is `.claude/agents/lens-review/reference/<id>.md`: a title, a one-line summary, then the lens. This
  repository has nine: `correctness`, `test-quality`, `code-health`, `simplification`, `staleness-and-debris`,
  `public-leak`, `guard-security`, `mod-contract` and `claude-code-expert`.
- **Profile.** "Lenses" names the default lenses and the routing rows `auto` treats as binding.
- **Leak gate.** `harness/leak-scan/review.sh` runs the `public-leak` lens file whole as the agent's prompt, with its
  summary line as the description, the model `lens-review.md` names and high effort, all read from the default
  branch.

## Per-file map

- `plugins/test-review/skills/test-review/SKILL.md`: forks into the agent and carries the steps.
- `plugins/test-review/agents/test-reviewer.md`: the four criteria, breaks from the rules run in the foreground,
  in-place restore, the report; medium effort.
- `plugins/test-review/skills/test-review/scripts/`: removed.
- `plugins/test-review/skills/test-review/references/profile-template.md` and `.claude/test-review-profile.md`: no
  section for the script.
- `plugins/test-review/README.md`, `.claude-plugin/plugin.json`: what ships; version 0.2.0.
- `.claude/agents/engineer.md` and `plugins/delegation/templates/engineer.md`: the testing lines; delegation 0.1.2.
- `plugins/lens-review/`: the skill, agent template, six lens templates, profile template, reviewer brief and README;
  version 0.2.0.
- `.claude/agents/lens-review/`: the agent and nine lenses; `.claude/agents/code-review/` removed.
- `.claude/code-review-profile.md`, `.claude/development-profile.md` section 9 and `CLAUDE.md`: the lens layout.
- `harness/leak-scan/review.sh`, its bats tests, `harness/githooks/test_pre_push.bats` and
  `harness/githooks/README.md`: the gate on the new path; harness 0.1.18.
- `plugins/develop/`: step 7 runs the code review with no panel argument; version 0.1.4.

## Relations

- part_of [[Test Review Breaks]]
