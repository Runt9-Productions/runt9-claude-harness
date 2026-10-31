---
title: Bootstrap Split
type: note
permalink: projects/bootstrap-split/overview
tags:
- bootstrap
- harness
- refactor
status: implementation
opened: '2026-10-31'
---

# Bootstrap Split

Splits `bootstrap.py` into a package of one module per component (issue #14), as a move with no behaviour change, so
that the plugin template seeding (#37) and the update mode (#41) can each land in their own module. It ends when the
split merges with `test_bootstrap.py` passing and no test changed.

## Where it stands

- [status] Spec written; the build waits for a session started in the worktree.

## Goal

- `bootstrap.py` keeps the version check, the command line, picking and the run loop; a `bootstrap/` package beside
  it holds the helpers, one module per component and the registry that lists them in install order.
- Every message, prompt, refusal and exit code is unchanged.

## Designs ruled out

- Removing settings entries a newer harness version dropped, in the same change: it is new behaviour, and it moved to
  the update mode, which is what needs it (owner, 2026-10-31).
- Leaving the script's directory off `sys.path`: `python3 -P`, `-I` and `PYTHONSAFEPATH` would then fail with
  `ModuleNotFoundError` where the single file works today.

## Relations

- see_also [[Bootstrap Split Decisions]]
- see_also [[Bootstrap Split Checklist]]
- see_also [[Bootstrap Split Spec]]
- see_also [[Bootstrap Split Estimate]]
