---
title: Bootstrap Menu Estimate
type: note
permalink: projects/bootstrap-menu/research/estimate
tags:
- bootstrap
- estimate
---

# Bootstrap Menu Estimate

**Moderate.** Production 230 to 330 lines: the curses menu in a new `bootstrap/menu.py` of 130 to 180, the
description readers in a new `bootstrap/docs.py` and their wiring of 50 to 80 across `core.py`, `registry.py`,
`fragments.py`, `settings.py` and `plugins.py`, the survey wrapper of 25 to 40 in `update.py`, and `all` of 10 to 15
in `bootstrap.py`, which loses `ask`. Tests 170 to 250 lines in `test_bootstrap.py`, about eight tests plus a
pseudo-terminal helper of about 40. Docs 20 to 35 lines in `README.md`, `CLAUDE.md`, the docstring and the bootstrap
note. About 11 files, two new. The cost is in the curses screen (scrolling, the description view, the keys) and in
driving it from tests.

## Comparison

084d20d (`--update`, #111) added a new front end over the same components: +1534/−85 across 23 files, of which
`bootstrap/update.py` 364 and tests 493. This change is about a quarter of that: it adds a picker and readers, not a
new install path, and reuses `--update`'s survey for the marks.

## Risks

- `survey_skills` and `survey_plugins` call checks that raise (`check_skills`, `check_plugin_setup`, `check_plugin`),
  so the menu must catch per step or a broken setup stops the menu instead of the install.
- Reading README tables ties the menu to the table shape; the test over this repository's components catches a row
  renamed or dropped, not a reworded one.
- Pseudo-terminal tests depend on the runner's terminfo for `TERM=xterm`; the CI runner is `ubuntu-24.04`, where
  ncurses ships it, but this was not run there.
- A survey warning printed to stderr before curses starts is hidden while the menu shows.

## Not verified

- Whether `claude plugin install` exits 0 for a plugin already installed. If not, `all` on a machine with plugins
  installed stops at the first one, and needs a skip of about 15 lines and a test.
- Whether curses' alternate screen restores the terminal so the per-write diff prompts after the menu read normally
  on macOS's Terminal; on Linux xterm-compatible terminals it does.

## Actual

Built in #121, measured against `main`: production 9 files, +360/−18 (`bootstrap/menu.py` 208, `bootstrap/docs.py`
57); tests 1 file, +349/−18; docs outside this project 5 files, +74/−37, the knowledge base's bootstrap and
guardrails notes included. Production ran about 10% over the top of the range and tests about 40% over: the
estimate missed the menu's Markdown joining before wrapping, a test without curses, and the test review's added
cases, some of them for `--update` rules this change did not touch. `claude plugin install` exits 0 for a plugin
already installed at that scope, so `all` needed no skip. The macOS Terminal point stays unverified.

## Relations

- part_of [[Bootstrap Menu]]
