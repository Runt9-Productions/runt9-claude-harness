---
title: Bootstrap
type: note
permalink: bootstrap/overview
tags: [bootstrap, plugins, local-files, python, update, menu]
verified: 2026-11-06
coverage: partial
measured_on: "Python 3.12.3"
sources:
  - bootstrap.py
  - bootstrap/core.py
  - bootstrap/docs.py
  - bootstrap/files.py
  - bootstrap/fragments.py
  - bootstrap/git.py
  - bootstrap/harness.py
  - bootstrap/hooks_path.py
  - bootstrap/menu.py
  - bootstrap/plugins.py
  - bootstrap/registry.py
  - bootstrap/settings.py
  - bootstrap/skills.py
  - bootstrap/update.py
  - test_bootstrap.py
---

# Bootstrap

> **Scope.** How `bootstrap.py` and its `bootstrap/` package are laid out and imported, where a component's description comes from and how the menu marks components, and how a plugin's `local.example/` templates are copied into `~/.claude/local/` on install and on `--update`. Read in #121 (the selection menu and `all`): the script whole; every package module's imports and its `functools.cache` uses; `docs.py` and `menu.py` whole; `Run`, `Component`, `lacks_repos` and `CLONE` in `core.py`; the component list in `registry.py`; the `description` of each component in `fragments.py`, `settings.py` and `plugins.py`; `check_plugin` through `update_plugin` in `plugins.py`; `check_checkout` and `tree_files` in `harness.py` (by line only, unchanged on that branch); in `update.py`, `update`, `component_states`, `survey_plugins` and `plugins_left_behind`; the `sandbox` fixture's copy, the `-P` test, the two description tests, the menu test whose survey stops, the two template tests and the `Updated` line test in `test_bootstrap.py`. The import precedence line was re-measured on Python 3.12.3 with synthetic files. Carried forward without a re-check: what `export_tree`'s `ships` filter keeps and `write_staged`'s behaviour, both in files unchanged on that branch. Not covered: what each component installs or updates beyond the templates, how `--update` surveys the harness, skills, fragments and settings, how the menu draws and scrolls, and the rest of the tests. The `[decision]` lines are the owner's rulings, carried forward as recorded.

Read this before adding a module or a component to `bootstrap/`, moving code between its modules, or changing what
`bootstrap.py` writes into `~/.claude/local/`. The traps here break the script before it can print why, break every
run on a Python without curses, leave a component with an empty description or the menu with no marks and no
message, make a template come from a different commit than its plugin, overwrite a template the user edited, or stop
a whole run.

## Observations

### Layout and imports

- [trap] The Python version check (`bootstrap.py:28`) sits above the `sys.path` line and every import from the package, because on an older interpreter the package's annotations raise at import, before `main` could say why #order-dependent
- [fact] `bootstrap.py:34` puts its own directory at the front of `sys.path` before importing the package, since `-P`, `-I` and `PYTHONSAFEPATH` leave it off; `test_runs_with_the_script_directory_off_sys_path` runs `--list` under `-P` (`test_bootstrap.py:386`)
- [trap] `bootstrap.py` and the `bootstrap/` package share a name in one directory, and `import bootstrap` finds the package only because it is a regular package: with `x.py` beside an `x/` holding no `__init__.py`, `import x` loaded `x.py`, and with `x/__init__.py` added it loaded the package. Without `bootstrap/__init__.py`, `import bootstrap` would load the script, which is no package #measured
- [fact] The package imports in layers with no cycle: `core` imports nothing from the package; `files` and `git` import only `core`; `docs` imports `core` and `git`; `harness` imports `core`, `files` and `git`; `hooks_path` and `skills` import `harness` and modules below it; `fragments` and `settings` import `docs`, `harness` and modules below them; `plugins` imports `docs`, `harness`, `settings` and modules below them; `registry` imports `core`, `docs` and every component module, and holds `unknown_components`, which the script and `update` both raise; `update` imports `registry` and every component module except `hooks_path`; `menu` imports `core` and `update`. Every import is at module top except one: the script imports `core`, `plugins`, `registry` and `update` at top (`bootstrap.py:36`) and `menu` only inside `pick` (`bootstrap.py:75`), when no component is named
- [trap] `menu.py` imports `curses` at its top and reads `curses.KEY_ENTER` at import (`ENTER`, `bootstrap/menu.py:19`), and `pick` turns a `ModuleNotFoundError` naming `curses` or `_curses` into a one-line stop while re-raising one for any other module. Importing `bootstrap.menu` from the script's top or from any module the script imports would make every run fail on a Python built without curses, named components and `--update` included; no test runs without curses #silent-failure
- [fact] `CLONE` (`bootstrap/core.py:6`) is the parent of the package directory, the clone's root
- [fact] `git_environment` (`bootstrap/git.py:9`), `check_plugin_setup`, `add_marketplace` and `refresh_marketplace` (`bootstrap/plugins.py:24`, `:46`, `:52`) are `functools.cache`d so each runs once per run; `refresh_marketplace` once per marketplace name. The one exception: `component_states` clears `check_plugin_setup`'s cache after the menu's survey (`bootstrap/update.py:162`), so the install's checks print its `CLAUDE_CODE_PLUGIN_DIRS` warning again after curses has drawn over the first. Nothing in `docs.py` is cached, so each description shown runs `git ls-tree` and `git show` again
- [fact] The `sandbox` fixture copies the whole `bootstrap/` package into its synthetic clone, leaving out `__pycache__` (`test_bootstrap.py:248`), so a new module reaches the tests with no fixture change
- [decision] `bootstrap.py` puts its own directory on `sys.path` before importing the package (owner, 2026-10-31): safe-path modes leave it off, and the script worked in them as a single file.
- [decision] The package is named `bootstrap/` (owner, 2026-11-02): it sits beside the script it serves, and the script runs as `__main__`, so the shared name causes no import clash.

### Descriptions and menu marks

- [fact] `Component.description` (`bootstrap/core.py:28`) is a required zero-argument callable, and each one is a `functools.partial` over a reader in `docs.py` that takes the file from HEAD through git, so uncommitted doc text is never shown (`test_descriptions_come_from_the_docs_in_head_and_are_empty_where_a_doc_is_missing`, `test_bootstrap.py:1030`). `harness`, `hooks-path` and `skills` read their row of the root `README.md` table whose second header cell is `Installs` (`table_row`, `bootstrap/registry.py:22`); `settings:` components their row of the `What it adds` table in `harness/settings/README.md` (`bootstrap/settings.py:168`); `fragment:` components the fragment file whole (`head_text`, `bootstrap/fragments.py:84`); `plugin:` components the first paragraph after the H1 of `plugins/<name>/README.md` (`first_paragraph`, `bootstrap/plugins.py:180`)
- [trap] `table_row` matches a row only when its first cell is the component name in backticks, and every reader returns `""` when HEAD lacks the file or the row, with no error; the menu then shows `no description found`, which `show_description` also shows when the reader raises `Stop` or `OSError` (`bootstrap/menu.py:180`). Only `test_every_component_of_this_repository_has_a_description` (`test_bootstrap.py:1060`) fails on it, so a new component needs its row in the doc it reads #silent-failure
- [trap] Before the menu opens, `choose` (`bootstrap/menu.py:66`) runs `component_states` (`bootstrap/update.py:143`), the `--update` survey of the harness, skills, fragments, settings and plugins with `Stop` and `OSError` caught per step: a step that raises drops every mark it had found, so a `settings.json` that is no JSON object, `claude` missing from `PATH`, or a link under any behind plugin's `local.example/` leaves those rows unmarked with no message, and the menu still opens (`test_menu_opens_whatever_the_survey_cannot_read_and_shows_full_descriptions`, `test_bootstrap.py:1112`) #silent-failure
- [fact] A component that acts on `--repo` paths is shown but cannot be ticked when none is given, marked `needs --repo` (`lacks_repos`, `bootstrap/core.py:35`; `bootstrap/menu.py:78`), while `all` leaves it out with a `Not offering` line (`offered`, `bootstrap.py:51`); `all` named beside any other name stops the run (`bootstrap.py:66`)

### Plugin templates

- [fact] After `claude plugin install` succeeds, `install_plugin` (`bootstrap/plugins.py:108`) calls `copy_templates` (`:75`), which writes each file under `plugins/<name>/local.example/` in the clone's HEAD to `~/.claude/local/<name>/<path>.example`; a plugin with no `local.example/` writes nothing, since `git ls-tree` on a missing path prints nothing and exits 0
- [trap] The plugin installs from the GitHub marketplace (`MARKETPLACE_SOURCE`, `bootstrap/plugins.py:16`) while its templates come from whatever HEAD the clone has checked out, so the two can be different versions of the plugin
- [trap] Under `--update` the templates are rewritten from HEAD even when `claude plugin update` left the plugin short of HEAD's version: `update_plugin` (`bootstrap/plugins.py:114`) copies them right after the update, and `plugins_left_behind` (`bootstrap/update.py:370`) only reports the shortfall afterwards. `update` leaves such a plugin out of its `Updated` line, and prints no `Updated` line at all when plugins left behind were all it applied (`bootstrap/update.py:118`, `test_update_says_updated_nothing_only_when_it_applied_nothing`, `test_bootstrap.py:1509`)
- [trap] An install run that picks only `plugin:` components, from the command line or the menu, gets neither the harness's refusal of uncommitted changes nor its warning that HEAD is not on `origin/main`: `check_checkout` (`bootstrap/harness.py:28`) is the `harness` component's check alone (`bootstrap/registry.py:23`). `--update` calls it first whatever is named (`bootstrap/update.py:80`) #silent-failure
- [fact] On install each template is written with an exclusive create (`open("xb")` in `copy_templates`), so a file or a link already at the `.example` path is kept and printed as `kept`; whether the real file exists makes no difference, and a `~/.claude/local` or parent directory that is a link is written through
- [trap] On `--update`, `copy_templates` runs with `rewrite_changed` set, and `is_stale_template` (`bootstrap/plugins.py:68`) makes it rewrite an existing `.example` that is a regular file, not a link, with content other than HEAD's, through `write_staged` and printed as `rewrote`; the plan and its question name only the version change, so a user's edits made in the `.example` itself are replaced, while the file saved without `.example` is untouched (`test_update_updates_a_newer_plugin_and_rewrites_its_changed_template`, `test_bootstrap.py:1306`). A `.example` that is a link or already matches HEAD is kept, and one missing is written as on install (`test_update_leaves_a_linked_or_unchanged_template_alone_and_adds_a_missing_one`, `test_bootstrap.py:1337`)
- [fact] `--update` rewrites templates only for a plugin it updates, which is one whose versions in `claude plugin list --json` differ from the `version` in HEAD's `plugins/<name>/.claude-plugin/plugin.json` (`survey_plugins`, `bootstrap/update.py:315`)
- [trap] `check_plugin` (`bootstrap/plugins.py:61`) lists the templates only so that `tree_files` raises on a link or submodule, and `bootstrap` in `bootstrap.py` runs every picked component's check before the first install, so one such entry under any picked plugin's `local.example/` stops the whole run with nothing installed; `--update` calls it in its survey for each plugin behind HEAD (`bootstrap/update.py:331`), so the same entry stops the update before its first question #order-dependent
- [trap] `tree_files` (`bootstrap/harness.py:54`) checks each entry's mode before `export_tree` applies its `ships` filter, so a link at a harness path that would not ship stops the harness install too
- [fact] Each path written or rewritten is appended to `Run.templates` (`bootstrap/core.py:19`), and `print_templates` (`bootstrap/plugins.py:101`) prints them after the `Installed ...` line in `bootstrap`, and in `update` last, after whichever of the `Updated ...`, `Skipped ...` and `Waiting for the harness: ...` lines it prints (`bootstrap/update.py:126`); a run that wrote none prints nothing more
- [decision] A template lands as `<file>.example` beside the file it stands for (owner, 2026-11-01): no skill reads that name, so a shipped example takes effect only once the user saves a filled copy under the real name.
- [decision] Every plugin with a `local.example/` gets its templates, read from HEAD through git rather than from Claude Code's installed copy (owner, 2026-10-31): only committed files install, as with the harness, and the installed copy's location is Claude Code's own layout.
- [decision] A template is written only when its `.example` path is absent, and through a `~/.claude/local` that is a link (owner, 2026-11-01): the settings and `CLAUDE.md` components write through theirs, and refreshing a stale `.example` belongs to an update mode.
- [decision] The regular-file check runs before the harness's ship filter (owner, 2026-11-01): one listing serves both callers.

## Relations
