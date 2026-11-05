---
title: Bootstrap Menu Spec
type: note
permalink: projects/bootstrap-menu/spec
tags:
- bootstrap
- menu
- curses
---

# Bootstrap Menu Spec

The per-file map for issues #39 and #40, with the rulings in [[Bootstrap Menu Decisions]]. Line numbers are at
a4e6976.

## Descriptions (task 01)

- `Component` (`bootstrap/core.py:23`) gains a required `description: Callable[[], str]`, so a new component kind
  left unwired fails at once. It is called only when the menu expands a row, so a run that names components reads no
  docs. A file missing at HEAD gives `""`; any other git failure raises `Stop`, which the menu catches.
- A new `bootstrap/docs.py` (imports `core` and `git` only) holds two readers over a file's text at HEAD,
  `git(CLONE, "show", "HEAD:<path>")`:
  - `table_row(path, column, key)`: everything after the first cell of the row whose first cell is `` `key` ``, up
    to the trailing `|`, in the table whose header's second cell is `column`; `""` when no row matches or the file
    is missing at HEAD. Naming the column keeps a second table keyed by component, such as `README.md`'s update
    table, from answering.
  - `first_paragraph(path)`: the lines after the H1 up to the next blank line, joined; `""` when none.
- Wiring, one source per kind (D3):

| Component | Source at HEAD | Where |
|---|---|---|
| `harness`, `hooks-path`, `skills` | `table_row("README.md", "Installs", name)` | `HARNESS_COMPONENTS`, `bootstrap/registry.py:11` |
| `fragment:<name>` | the whole of `harness/fragments/<name>.md` | `fragment_components`, `bootstrap/fragments.py:75` |
| `settings:<name>` | `table_row("harness/settings/README.md", "What it adds", name)` | `settings_components`, `bootstrap/settings.py:157` |
| `plugin:<name>` | `first_paragraph("plugins/<name>/README.md")` | `plugin_components`, `bootstrap/plugins.py:169` |

- Tests: every component `all_components()` returns for this repository has a non-empty description (this catches a
  README row renamed or dropped); in the sandbox, a component whose doc is missing gets `""`.

## `all` (task 02)

- `pick` (`bootstrap.py:50`): `all` is recognised before the unknown-name check. With any other name beside it,
  `Stop("all names every component; name no others with it")` (D9). Otherwise it expands to `components` in order;
  without `run.repos` each `needs_repos` component is left out and the line `ask` prints today
  (`bootstrap.py:42`) is printed instead (D6). The checks and installs then run as for named components.
- `--list` (`bootstrap.py:68`) prints one more line after the components: `all` and `every component above, in this
  order; hooks-path only with --repo`, aligned with the rest.
- A re-run of `all` on a machine with plugins installed is safe: `claude plugin install` for a plugin already
  installed at that scope prints that it is and exits 0 (Claude Code's plugin commands reference, read 2026-11-04).
- The `Not offering <name>` line has one home, `offered` in `bootstrap.py`. Whether a component can be offered
  without `--repo` is one predicate in `bootstrap/core.py`, which `offered` and the menu's `needs --repo` row share.
- `--update all` is untouched: `narrowed` reports `all` as an unknown component (D9).
- Tests: `all` without `--repo` installs every other component in order, says it left `hooks-path` out, and makes the
  same `claude` calls as naming each; `all` with `--repo` sets `core.hooksPath`; `all` beside a name stops before any
  install; `--list` shows the `all` line.

## The menu (task 03)

- `ask` goes. `pick` with no names imports `bootstrap.menu` there and calls `choose(components, run)`, which returns
  the picked components in install order, or `[]` (then `Nothing picked.`). Importing it only there keeps runs that
  name components free of curses; a Python without curses stops with a line saying so.
- Before curses starts (D16): when `sys.stdin.isatty()` or `sys.stdout.isatty()` is false, `Stop("no answer on
  stdin; name the components on the command line instead")`, today's message. A `curses.error` from setup becomes
  `Stop("the menu needs a terminal curses can drive; check TERM, or name the components on the command line")`.
- Marks (D4, D15): a new `component_states(run) -> dict[str, str]` in `bootstrap/update.py` builds a `Survey` and runs
  `survey_harness`, `survey_skills(survey, harness_moves=False)`, `survey_fragments`, `survey_settings` and
  `survey_plugins` (`bootstrap/update.py:191` to `:311`), each in its own `try` catching `Stop` and `OSError`, so one
  failing step leaves only its rows unmarked, including any it marked before raising. Without `claude` on `PATH`
  the plugins step raises `Stop`, so its rows stay unmarked. A `Found`
  with a change is `behind`; one without is `installed`; anything else is unmarked. `hooks-path` is never found, so
  it is unmarked, and without `--repo` its row reads `needs --repo` and cannot be ticked.
- Screen: one row per component, `[x]` or `[ ]`, the name, the mark, then the summary cut to the width. A footer
  names the keys and how many are ticked. The list scrolls when it is taller than the terminal.
- Keys: Up and Down (and `k`, `j`) move; Space toggles; `a` ticks every pickable row, or clears them all when all are
  ticked; Right or `?` opens the row's description; Enter returns the ticked rows (D8); `q` or Escape returns `[]`.
  After curses closes, `answered_yes` asks `Install <names>? [y/N] `; a no returns `[]` (D8a).
  The description view shows the name, the summary and the description, or `no description found` when it is `""`
  or reading it raised `Stop` or `OSError`. The docs are hard-wrapped Markdown, so each paragraph and list item is
  joined to one line before it is wrapped to the width. Up, Down, Page Up and Page Down scroll it; any other key
  returns to the list.
- The drawing is kept apart from a small state object (cursor, ticks, scroll offset) so the key handling reads
  plainly; tests still go through the command.
- Tests, driven through a pseudo-terminal (`pty.openpty`, `TERM=xterm` in the run's environment, keys written to the
  master, output read until an expected string). Curses repaints a changed row only in part, so a test matches only
  text painted whole: a first paint, a new view, or a line printed after curses closes.
  - picking two components with Down, Space and Enter installs exactly those, in install order, and an installed
    harness shows as `installed` on the next run;
  - opening a fragment's description shows the fragment's text;
  - a survey step that raises still opens the menu, and a plugin with no README shows `no description found`;
  - a `TERM` curses cannot drive stops with the line naming `TERM`;
  - `test_prompt_without_stdin_stops` stays as it is, and `test_prompt_installs_what_was_answered_yes` is replaced by
    the first test above.

## Docs (task 04)

- `README.md`: the line "With no component named it asks about each one" becomes the menu and its keys, plus `all`;
  the refusals list adds the terminal stop.
- `bootstrap.py`'s docstring and `--help` text: the menu and `all`.
- `CLAUDE.md`'s bootstrap bullet names `menu.py` and `docs.py` beside `update.py`.
- `domains/bootstrap/overview.md`: the import layers gain `docs` and `menu`; re-verify every claim resting on a
  changed file, as `--stale-in` requires.
- No version rise: `bootstrap.py` and `bootstrap/` are outside `harness/` and every plugin.

## Edit scope

`bootstrap.py`, `bootstrap/` (new `docs.py` and `menu.py`), `test_bootstrap.py`, `README.md`, `CLAUDE.md`,
`.claude/reference/domains/bootstrap/overview.md`, `.claude/reference/projects/bootstrap-menu/` and the project line
in `.claude/reference/README.md`.

## Ticket text

Issue #39, title unchanged ("Give bootstrap.py an interactive selection menu"):

```markdown
## Objective

Run with no component named, `bootstrap.py` asks about each component in turn with a yes/no prompt, so choosing a few out of many means answering every one, and a user cannot see what a component does beyond its one-line summary before answering. A selection menu that lists every component at once, lets the user toggle the ones wanted, and expands any one to its full description would make the first install and each update quicker and better informed.

## Technical details

- The menu replaces the per-component prompt (`ask` in `bootstrap.py`) and lives in its own module of the `bootstrap/` package. It is built on the standard library's `curses`, so it runs on Linux and macOS.
- Each component's full description is read at HEAD from the docs that already hold it: its row in `README.md`'s component table for `harness`, `hooks-path` and `skills`; the fragment file for a fragment; its row in `harness/settings/README.md` for a settings fragment; the first paragraph of the plugin's README for a plugin. No description is written twice.
- Each row is marked installed or behind HEAD from the survey `--update` already runs, and nothing starts ticked. A survey step that fails leaves its rows unmarked rather than stopping the menu.
- The menu's confirmation replaces only the per-component yes/no. The diff and question that fragment, settings and harness installs show before writing stay.
- Named components, `--list`, `--update` and the refusal inside a Claude Code session are unchanged. A run whose stdin or stdout is not a terminal fails with the current message.

## Out of scope

- Changing what any component installs, its per-write prompts included.
- Updating installed plugins.
- Windows.

## Acceptance criteria

- With no component named, a user picks any set of components from one list and installs them in one confirmation.
- Any component can be expanded in the menu to show its full description before choosing.
- The menu marks components already installed and those behind HEAD.
- Runs that name components, `--list` and a run without a terminal behave as before.
```

Issue #40, title unchanged ("Add an all option to bootstrap.py"):

```markdown
## Objective

Installing everything the repository offers means naming every component on the command line or answering every prompt. One `all` argument that picks every component makes a full install, and a test of a full cutover, a single command.

## Technical details

- `bootstrap.py`'s `pick` expands `all` to the whole component list in install order; each component then gets the checks and prompts it gets when named.
- `hooks-path` needs `--repo`, so without one `all` leaves it out and prints how to add it. `all` takes no exclusions: name the components instead. Named beside another component, it stops before anything installs.
- `--update all` is not added: `--update` with no names already covers everything installed.

## Out of scope

- Updating what is already installed.
- Excluding components from `all`.

## Acceptance criteria

- `bootstrap.py all` installs every component `--list` shows, in install order, with the same prompts and refusals as naming each one; without `--repo` it leaves out `hooks-path` and says so.
- `--list` documents `all`.
```

## Relations

- part_of [[Bootstrap Menu]]
