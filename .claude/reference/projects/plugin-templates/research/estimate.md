---
title: Plugin Templates Estimate
type: note
permalink: projects/plugin-templates/research/estimate
tags:
- bootstrap
- estimate
---

# Plugin Templates Estimate

**Small.** Production 40 to 70 lines across `bootstrap/plugins.py`, `bootstrap/harness.py`, `bootstrap/core.py` and
`bootstrap.py`; tests 40 to 60 lines, two tests; docs 4 to 8 lines in `README.md` and `CLAUDE.md`. Six files edited,
none new. Rests on reusing `export_tree`'s git listing rather than a second one. No version rise: bootstrap is not
versioned.

## Comparison

ef719ba added the fragment component, which also writes into `~/.claude` from the installed harness with a
never-clobber rule; this one is smaller, with no prompt and no diff, since it never changes an existing file.

## Risks

- A test that commits files under `plugins/` in the sandbox's clone: the fixture's marketplace names `example-one`
  but commits no plugin directory, so the test adds one.

## Relations

- part_of [[Plugin Templates]]
- see_also [[Plugin Templates Spec]]
