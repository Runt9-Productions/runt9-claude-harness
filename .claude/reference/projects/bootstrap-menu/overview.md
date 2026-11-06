---
title: Bootstrap Menu
type: note
permalink: projects/bootstrap-menu/overview
tags:
- bootstrap
- menu
- curses
status: complete
opened: '2026-11-04'
---

# Bootstrap Menu

Replaces `bootstrap.py`'s one-question-per-component prompt with a curses selection menu (issue #39), and adds an
`all` argument that names every component (issue #40). One pull request closes both. It ends when that merges with
tests at the command's boundary.

## Where it stands

- [status] Complete: tasks 01 to 04 built in #121; the durable facts are in [[Bootstrap]].

## Goal

- With no component named, one menu lists every component, marks the ones installed or behind, lets the user toggle
  any set, expands any one to its full description, and installs the set on one confirmation.
- `bootstrap.py all` installs every component `--list` shows, in install order, as naming each one would.
- Named components, `--list`, `--update` and a run without a terminal behave as before.

## Designs ruled out

- A numbered line prompt, or curses with a line fallback: Windows is not supported, and curses is the standard
  library's only menu toolkit (owner, 2026-11-04).
- questionary, imported only when the menu opens and declared inline for `uv run`: it would add type-to-filter, a
  description of the highlighted row and inline drawing, but needs uv installed before the first menu run, and Python
  shipped here stays standard library only (owner, 2026-11-04).
- Description text written in code: the README tables, fragment files and plugin READMEs already hold it, and a
  second copy drifts (owner, 2026-11-04).
- Descriptions from the installed harness: a first install has none.
- Preselecting components: the user picks from nothing ticked (owner, 2026-11-04).
- One prompt for every diff: the per-write diff prompts are part of what a component installs, which is out of scope
  (owner, 2026-11-04).
- Exclusions for `all`: name the components instead (owner, 2026-11-04).

## Documents

- [[Bootstrap Menu Checklist]]: the units of work and which is live
- [[Bootstrap Menu Decisions]]: rulings taken and questions still open
- [[Bootstrap Menu Spec]]: the per-file map and the ticket text
- [[Bootstrap Menu Estimate]]: the size estimate

## Relations

- see_also [[Bootstrap]]
- see_also [[Bootstrap Menu Checklist]]
- see_also [[Bootstrap Menu Decisions]]
- see_also [[Bootstrap Menu Spec]]
- see_also [[Bootstrap Menu Estimate]]
