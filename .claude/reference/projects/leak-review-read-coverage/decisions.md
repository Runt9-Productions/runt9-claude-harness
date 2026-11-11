---
title: Leak Review Read Coverage Decisions
type: note
permalink: projects/leak-review-read-coverage/decisions
tags: ["leak-scan", "pre-push"]
---

# Leak Review Read Coverage Decisions

Rulings on how `harness/leak-scan/review.sh` decides that the review read every input (issue #144). Durable facts
about the Read tool's results live in [[Leak Review]].

## Decisions

- [decision] Measure what the review read from the Read tool's own results in `claude -p --output-format stream-json
  --verbose` output and drop the self-reported `read` field, rather than relax the self-report for inputs that fit
  one Read call: a measured read cannot be misreported, and no size limit tied to Read's internals is needed
  (owner, 2026-11-11)
- [decision] The spec and its edit scope are approved as written: `harness/leak-scan/review.sh`,
  `harness/leak-scan/test_review_text.bats`, `harness/githooks/test_pre_push.bats`, `harness/githooks/README.md`,
  `.claude/code-review-profile.md`, `harness/harness.json` and `.claude/reference/` (owner, 2026-11-11)
- [decision] The session that wrote the spec builds it, not a fresh one in the worktree: the change uses no language
  server, which is the profile's reason for a fresh session (owner, 2026-11-11)
- [decision] Commit, push through the bot remote and the draft pull request are granted for the whole run; merging
  stays the owner's (owner, 2026-11-11)
- [proposal] The measured ranges of each input must cover line 1 through its last line with no gap, so a skipped
  middle page fails as well as a short end (approved with the spec)
- [proposal] A Read result also counts when its `filePath` is exactly the input's name, because a Read given a
  relative path reports it that way and the walk would otherwise refuse an input that was read (open, put to the
  owner with the pull request)

## Open Questions

None.
