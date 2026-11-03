---
title: Bootstrap Update Estimate
type: note
permalink: projects/bootstrap-update/research/estimate
tags:
- bootstrap
- estimate
---

# Bootstrap Update Estimate

**Moderate to Large.** Production 250 to 400 lines: a new `bootstrap/update.py` (detection, plan, apply) of 150 to
230, the settings arithmetic of 50 to 80 in `bootstrap/settings.py`, 20 to 40 across `bootstrap/plugins.py`,
`bootstrap/files.py`, `bootstrap/skills.py` and `bootstrap.py`. Tests 220 to 350 lines, eight to twelve tests, plus a
stub `claude` that answers `plugin list --json`. Docs 10 to 20 lines in `README.md`, `CLAUDE.md` and the docstring.
About 9 files, one new. The cost is in the settings arithmetic's cases and in keeping the single confirmation: today
each writer asks for itself.

## Comparison

4d913e3 added the settings component (the merge, the diff and the ask); the arithmetic here is that merge with
removal and replacement, and the command around it is new.

## Risks

- The stub `claude` in `test_bootstrap.py` only logs and exits; answering `plugin list --json` needs a canned reply,
  which every plugin test then shares.
- `claude plugin update` may refuse when stdin is not a terminal for a marketplace-declared command; this
  marketplace declares none, so it is not handled.
- The version `claude plugin update` installs is GitHub's `main`, not HEAD, so a checkout ahead of or behind GitHub
  reports a plugin behind that the update then leaves where it is. Update reports the installed version after the
  run, so the mismatch shows.

## Not verified

- Whether `claude plugin update` refreshes the catalog itself; running `marketplace update` first makes it moot.

## Relations

- part_of [[Bootstrap Update]]
- see_also [[Bootstrap Update Spec]]
