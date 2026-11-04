---
title: Bootstrap Update Spec
type: note
permalink: projects/bootstrap-update/spec
tags:
- bootstrap
- update
---

# Bootstrap Update Spec

The per-file map for issue #41, with the rulings in [[Bootstrap Update Decisions]]. Line numbers are at a958758.

## Detection

Each read happens before anything is written, so the plan can be shown whole.

| Component | Installed when | Behind when | Update does |
|---|---|---|---|
| `harness` | `CURRENT` (`bootstrap/harness.py`) is a link to a version directory | that directory's name differs from `harness_version(HEAD)` | `install_harness`; the version is new, so it asks nothing of its own |
| `skills` | any link in `SKILLS_DIR` points into `CURRENT / "skills"` (`is_link_to`, `bootstrap/skills.py:17`) | the harness is behind, or HEAD's skill names differ from the linked ones | `install_skills` after the harness |
| `hooks-path` | never detected | never: it points at `current` | nothing |
| `fragment:<name>` | `~/.claude/CLAUDE.md` imports `current/fragments/<name>.md` | never: the import follows `current` | nothing; an import whose file HEAD no longer ships is reported as vanished |
| `settings:<name>` | `settings.json` holds at least one leaf of the installed `current/settings/<name>.json` (D15) | the update function (task 01) returns a different object | one combined write of `settings.json` |
| `plugin:<name>` | `claude plugin list --json` has an entry whose `id` is `<name>@<marketplace>` | its `version` differs from `plugins/<name>/.claude-plugin/plugin.json`'s at HEAD | `claude plugin marketplace update <marketplace>` once, `claude plugin update <name>@<marketplace>`, then the template copy |

- `claude plugin list --json` prints a list of objects with `id`, `version`, `scope`, `enabled` and `installPath`
  (measured on Claude Code 2.1.317). A plugin whose `id` names this marketplace but no entry in `marketplace.json` is
  reported as vanished.
- A component HEAD has that is not installed is listed as available, never installed.
- `check_checkout` and `check_plugin_setup` run first, as for an install: update installs HEAD.

## Settings arithmetic (task 01)

`updated_settings(settings, old, new)` returns a new object and leaves its arguments alone. Walking `old` and `new`
together, key by key:

- An object both have: recurse.
- A list in `old`: remove each entry of `old`'s list that `new`'s lacks, when `settings` holds it; then add the
  entries `new`'s list has, `old`'s lacks and `settings` lacks, as `merge_settings` (`bootstrap/settings.py:23`) does.
- A plain value: when `settings` holds exactly `old`'s value, set `new`'s, or delete the key when `new` lacks it; a
  different value is the user's and stays (D16).
- A key only `new` has: added when `settings` lacks it, as `merge_settings` does.
- A key or list entry `old` has and `settings` lacks was removed by the user and stays absent, whatever `new` holds
  there, so an update never offers it back and never asks about it again.
- An object or list in `new` where `settings` has something else stops with `merge_settings`'s message.
- An object or list left empty by removals is removed too, unless `settings` had it empty before, so a fragment that
  drops a whole list leaves no empty list behind.

`write_after_asking` (`bootstrap/files.py:28`) splits into a diff printer, the confirmation, and the staged write,
so update shows every diff, asks once, then writes each file. Install keeps calling the combined function.

## Command (task 02)

- `bootstrap.py update` takes no component names and no `--repo`; either with it stops with a one-line message.
  Inside a Claude Code session it refuses as an install does.
- Output, in install order: one line per installed component saying `current`, or what would change, with the
  harness version move; then `available:` and `vanished:` lines when there are any. Nothing behind prints
  `Everything installed is current.` and exits 0 without asking.
- Confirmations (D15): one for the harness, skills and plugins together, `Update these? [y/N] `; then, for each
  settings fragment that would change `settings.json`, its own diff and `Apply settings:<name>? [y/N] `. Each
  fragment's diff is computed against `settings.json` as the fragments confirmed before it left it, and all accepted
  fragments are written in one staged write. A no to the first confirmation skips what it covers and still offers the
  settings fragments; a no to a fragment skips only that fragment. Every no is listed in the closing summary. A run
  without stdin stops as install does.
- Every question is asked before anything is written, so a run stopped at a prompt changes nothing.
- Apply order: harness, skills, settings, then plugins with their templates. A failure stops with the component and
  what updated before it, as install does.
- Templates on update: rewrite each `.example` whose content differs from HEAD's, add missing ones, never touch a
  real file (D17); the closing template list includes rewritten ones.

## Tests

Through `sandbox.run("update", ...)`, synthetic fixtures only:

- Nothing behind: prints current for each installed component and asks nothing.
- A harness version rise: the new version installs, `current` moves, and a skill the new version adds is linked.
- A settings fragment that rewords a list entry and changes a plain value: the old entry and value are gone, the new
  ones are there, and a key and an entry the user added are kept.
- A plugin whose HEAD version is newer: the stub `claude` sees the marketplace update, then the plugin update, and a
  changed template's `.example` is rewritten while the real file is unchanged. The stub needs a canned
  `plugin list --json` reply.
- With two changed settings fragments, yes to one and no to the other writes only the first one's change; a no to
  the first confirmation leaves the harness and plugins alone; a vanished plugin is reported and the run goes on.

Task 01's function also gets direct tests in the same file, since its cases are many and cheap: the reworded entry,
a user-owned value, a dropped key, and the emptied object.

## Docs (task 03)

- `README.md`: the "Updating" text (`README.md:70-73`) names `bootstrap.py update`, and the plugin sentence that
  says bootstrap never updates a plugin goes; the line that updates are manual (`README.md:10`) names it too.
- `bootstrap.py`'s docstring: the `update` form.
- `CLAUDE.md`, the bootstrap bullet: the command finds installed components from live state.

## Ticket

#41 already describes this design. No change planned beyond filling the open points with the D15 to D17 answers once
they are in.

## Relations

- part_of [[Bootstrap Update]]
- see_also [[Bootstrap Update Estimate]]
