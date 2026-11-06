---
title: Bootstrap Menu Decisions
type: note
permalink: projects/bootstrap-menu/decisions
tags:
- bootstrap
- menu
---

# Bootstrap Menu Decisions

Rulings for the selection menu and `all`. Read before changing what [[Bootstrap Menu Spec]] says the menu shows or
what `all` names.

## Decisions

- [decision] D1: issues #39 and #40 are built in one pull request that closes both (owner, 2026-11-04): both rewrite
  `pick`, the README's install section and the prompt tests.
- [decision] D2: the menu is curses only, with no line-prompt fallback and no Windows support (owner, 2026-11-04):
  the owner targets Linux and macOS, and the standard library offers nothing newer for a menu.
- [decision] D3: a component's full description is read at HEAD from the docs that already hold it: its row in
  `README.md`'s component table for `harness`, `hooks-path` and `skills`; the fragment file for `fragment:<name>`;
  its row in `harness/settings/README.md` for `settings:<name>`; the first paragraph after the H1 of
  `plugins/<name>/README.md` for `plugin:<name>` (owner, 2026-11-04): the text is written once.
- [decision] D4: each row is marked installed or behind from `--update`'s survey, and nothing starts ticked (owner,
  2026-11-04).
- [decision] D5: the menu's confirmation replaces only the per-component yes/no; each fragment, settings and harness
  diff prompt stays (owner, 2026-11-04): changing what a component installs is out of scope.
- [decision] D6: `all` names every component in install order, leaving `hooks-path` out with a printed line unless
  `--repo` is given, takes no exclusions, and otherwise checks and asks as naming each one does (owner, 2026-11-04).
- [decision] D12: Python shipped here stays standard library only, so the menu is curses and not questionary loaded
  for the menu alone (owner, 2026-11-04): a third-party menu needs uv or a virtual environment installed before the
  first run, and curses needs nothing on Linux or macOS.
- [decision] D7: the build may write `bootstrap.py`, `bootstrap/` (new `docs.py` and `menu.py`), `test_bootstrap.py`,
  `README.md`, `CLAUDE.md` (one bullet naming the new modules), `.claude/reference/domains/bootstrap/overview.md`,
  this project and its line in `.claude/reference/README.md` (owner, 2026-11-04).
- [decision] D18: the edit scope also takes `.claude/reference/domains/guardrails/overview.md`, re-verified here
  because its sources include `bootstrap/settings.py` and `bootstrap/update.py` (owner, 2026-11-05): CI's
  `--stale-in` check fails the branch otherwise.
- [decision] D19: `CLAUDE.md` gets no clause saying a new component needs a doc row for its description (owner,
  2026-11-05): `test_every_component_of_this_repository_has_a_description` fails, naming the component, when one is
  missing.
- [decision] D20: every component's summary and description say what it is, fixed in #121 (owner, 2026-11-06,
  after trying the menu): the old summaries said what bootstrap writes, and the harness and skills descriptions never
  named their contents.
- [decision] D21: harness, hooks-path and skills summaries are written in `bootstrap/registry.py`; a fragment's comes
  from its row in `harness/fragments/README.md`, a settings fragment's from its settings README row; the harness
  description is a "Part | What it is" table in `README.md`, hooks-path's the githooks README's first paragraph,
  skills' the skills README's first paragraph and table, each followed by its Installs row (owner, 2026-11-06).
- [decision] D8: Enter closes the menu with the ticked components, and a `y/N` question naming them follows before
  anything installs; `q` or Escape leaves with `Nothing picked.` (owner, 2026-11-04).
- [proposal] D8a: a no to that question ends the run with `Nothing picked.` and exit 0, rather than reopening the
  menu (lead, 2026-11-04; acted on, no objection): the same as today's run where every answer is no.
- [decision] D9: `all` beside any other component name stops as a usage error, and `--update all` is not added
  (owner, 2026-11-04): `all` names everything, and `--update` with no names already covers everything installed.
- [decision] D10, D11: issues #39 and #40 are rewritten to the text in [[Bootstrap Menu Spec]] (owner, 2026-11-04).
- [proposal] D15: a survey step that raises leaves its components unmarked rather than stopping the menu, and
  `plugin:` rows are unmarked when `claude` is not on `PATH` (lead, 2026-11-04; acted on, no objection): the marks
  inform; the install's own checks still refuse.
- [proposal] D16: a run whose stdin or stdout is not a terminal stops with today's message before curses starts, and
  a terminal curses cannot set up stops with one line naming `TERM` (lead, 2026-11-04; acted on, no objection).
- [proposal] D17: both the list and the description view scroll (lead, 2026-11-04; acted on, no objection): the
  repository has more components than a 24-line terminal shows, and a fragment runs past one screen.

## Open Questions

None.

## Relations

- part_of [[Bootstrap Menu]]
