---
title: Bootstrap Split Decisions
type: note
permalink: projects/bootstrap-split/decisions
tags:
- bootstrap
- harness
---

# Bootstrap Split Decisions

Rulings for splitting `bootstrap.py`. Read before changing the module map in [[Bootstrap Split Spec]].

## Decisions

- [decision] The split is a pure move; removing settings entries a newer harness version dropped belongs to the
  update mode (owner, 2026-10-31): a move with behaviour mixed in cannot be reviewed as moved code.
- [decision] `bootstrap.py` puts its own directory on `sys.path` before importing the package (owner, 2026-10-31):
  safe-path modes leave the script's directory off the path, and the single file works in them today.
- [proposal] The package is named `bootstrap/`, as the issue first proposed: it sits beside the script it serves, and
  the script runs as `__main__`, so the shared name causes no import clash. Status: open.

## Open questions

- None.

## Relations

- part_of [[Bootstrap Split]]
