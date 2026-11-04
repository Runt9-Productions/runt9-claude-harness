---
title: Bootstrap
type: note
permalink: bootstrap/overview
tags: [bootstrap, plugins, local-files, python, update]
verified: 2026-11-04
coverage: partial
measured_on: "Python 3.12.3"
sources:
  - bootstrap.py
  - bootstrap/core.py
  - bootstrap/files.py
  - bootstrap/fragments.py
  - bootstrap/git.py
  - bootstrap/harness.py
  - bootstrap/hooks_path.py
  - bootstrap/plugins.py
  - bootstrap/registry.py
  - bootstrap/settings.py
  - bootstrap/skills.py
  - bootstrap/update.py
  - test_bootstrap.py
---

# Bootstrap

> **Scope.** How `bootstrap.py` and its `bootstrap/` package are laid out and imported, and how a plugin's `local.example/` templates are copied into `~/.claude/local/` on install and on `--update`, all read at 42350fe, and the script again with its docstring and help text changed: the script whole; every package module's imports and its `functools.cache` uses; `check_plugin`, `is_stale_template`, `copy_templates`, `print_templates`, `install_plugin` and `update_plugin` in `plugins.py`; `check_checkout`, `tree_files` and `export_tree` in `harness.py`; `write_staged` in `files.py`; `Run` and `CLONE` in `core.py`; the component list in `registry.py`; in `update.py`, `update`, `survey_plugins` and `plugins_left_behind`; the `sandbox` fixture's copy, the `-P` test and the update test that rewrites a template in `test_bootstrap.py`. At 095a549, after `update` changed how it prints its `Updated` line, `update`, `survey_plugins` and `plugins_left_behind` were read again with every `update.py` citation, and the test of that line in `test_bootstrap.py`; the `test_bootstrap.py` citations were checked against the lines added; every claim resting on the other files was carried forward without a re-check. The import precedence line was re-measured on Python 3.12.3 with synthetic files. Not covered: what each component installs or updates beyond the templates, how `--update` surveys the harness, skills, fragments and settings, and the rest of the tests. The `[decision]` lines are the owner's rulings, carried forward as recorded. At ded1a3d, after new tests were added to `test_bootstrap.py`, the two `--update` tests cited here were read again: each still asserts what its line says, at its new line.

Read this before adding a module to `bootstrap/`, moving code between its modules, or changing what `bootstrap.py`
writes into `~/.claude/local/`. The traps here break the script before it can print why, make a template come from
a different commit than its plugin, overwrite a template the user edited, or stop a whole run.

## Observations

### Layout and imports

- [trap] The Python version check (`bootstrap.py:21`) sits above the `sys.path` line and every import from the package, because on an older interpreter the package's annotations raise at import, before `main` could say why #order-dependent
- [fact] `bootstrap.py:27` puts its own directory at the front of `sys.path` before importing the package, since `-P`, `-I` and `PYTHONSAFEPATH` leave it off; `test_runs_with_the_script_directory_off_sys_path` runs `--list` under `-P` (`test_bootstrap.py:298`)
- [trap] `bootstrap.py` and the `bootstrap/` package share a name in one directory, and `import bootstrap` finds the package only because it is a regular package: with `x.py` beside an `x/` holding no `__init__.py`, `import x` loaded `x.py`, and with `x/__init__.py` added it loaded the package. Without `bootstrap/__init__.py`, `import bootstrap` would load the script, which is no package #measured
- [fact] The package imports in layers with no cycle, all at module top: `core` imports nothing from the package; `files` and `git` import only `core`; `harness` imports `core`, `files` and `git`; `fragments`, `hooks_path`, `settings` and `skills` import `harness` and modules below it; `plugins` imports `harness`, `settings` and modules below them; `registry` imports every component module; `update` imports `registry` and every component module except `hooks_path`; the script imports `core`, `plugins`, `registry` and `update` (`bootstrap.py:29`)
- [fact] `CLONE` (`bootstrap/core.py:6`) is the parent of the package directory, the clone's root
- [fact] `git_environment` (`bootstrap/git.py:9`), `check_plugin_setup`, `add_marketplace` and `refresh_marketplace` (`bootstrap/plugins.py:24`, `:46`, `:52`) are `functools.cache`d so each runs once per run; `refresh_marketplace` once per marketplace name
- [fact] The `sandbox` fixture copies the whole `bootstrap/` package into its synthetic clone, leaving out `__pycache__` (`test_bootstrap.py:159`), so a new module reaches the tests with no fixture change
- [decision] `bootstrap.py` puts its own directory on `sys.path` before importing the package (owner, 2026-10-31): safe-path modes leave it off, and the script worked in them as a single file.
- [decision] The package is named `bootstrap/` (owner, 2026-11-02): it sits beside the script it serves, and the script runs as `__main__`, so the shared name causes no import clash.

### Plugin templates

- [fact] After `claude plugin install` succeeds, `install_plugin` (`bootstrap/plugins.py:107`) calls `copy_templates` (`:74`), which writes each file under `plugins/<name>/local.example/` in the clone's HEAD to `~/.claude/local/<name>/<path>.example`; a plugin with no `local.example/` writes nothing, since `git ls-tree` on a missing path prints nothing and exits 0
- [trap] The plugin installs from the GitHub marketplace (`MARKETPLACE_SOURCE`, `bootstrap/plugins.py:15`) while its templates come from whatever HEAD the clone has checked out, so the two can be different versions of the plugin
- [trap] Under `--update` the templates are rewritten from HEAD even when `claude plugin update` left the plugin short of HEAD's version: `update_plugin` (`bootstrap/plugins.py:113`) copies them right after the update, and `plugins_left_behind` (`bootstrap/update.py:336`) only reports the shortfall afterwards. `update` leaves such a plugin out of its `Updated` line, and prints no `Updated` line at all when plugins left behind were all it applied (`bootstrap/update.py:108`, `test_update_says_updated_nothing_only_when_it_applied_nothing`, `test_bootstrap.py:1134`)
- [trap] An install run that picks only `plugin:` components gets neither the harness's refusal of uncommitted changes nor its warning that HEAD is not on `origin/main`: `check_checkout` (`bootstrap/harness.py:28`) is the `harness` component's check alone (`bootstrap/registry.py:16`). `--update` calls it first whatever is named (`bootstrap/update.py:79`) #silent-failure
- [fact] On install each template is written with an exclusive create (`open("xb")` in `copy_templates`), so a file or a link already at the `.example` path is kept and printed as `kept`; whether the real file exists makes no difference, and a `~/.claude/local` or parent directory that is a link is written through
- [trap] On `--update`, `copy_templates` runs with `rewrite_changed` set, and `is_stale_template` (`bootstrap/plugins.py:67`) makes it rewrite an existing `.example` that is a regular file, not a link, with content other than HEAD's, through `write_staged` and printed as `rewrote`; the plan and its question name only the version change, so a user's edits made in the `.example` itself are replaced, while the file saved without `.example` is untouched (`test_update_updates_a_newer_plugin_and_rewrites_its_changed_template`, `test_bootstrap.py:1001`)
- [fact] `--update` rewrites templates only for a plugin it updates, which is one whose versions in `claude plugin list --json` differ from the `version` in HEAD's `plugins/<name>/.claude-plugin/plugin.json` (`survey_plugins`, `bootstrap/update.py:281`)
- [trap] `check_plugin` (`bootstrap/plugins.py:60`) lists the templates only so that `tree_files` raises on a link or submodule, and `bootstrap` in `bootstrap.py` runs every picked component's check before the first install, so one such entry under any picked plugin's `local.example/` stops the whole run with nothing installed; `--update` calls it in its survey for each plugin behind HEAD (`bootstrap/update.py:297`), so the same entry stops the update before its first question #order-dependent
- [trap] `tree_files` (`bootstrap/harness.py:54`) checks each entry's mode before `export_tree` applies its `ships` filter, so a link at a harness path that would not ship stops the harness install too
- [fact] Each path written or rewritten is appended to `Run.templates` (`bootstrap/core.py:19`), and `print_templates` (`bootstrap/plugins.py:100`) prints them after the `Installed ...` line in `bootstrap`, and in `update` after whichever of the `Updated ...` and `Skipped ...` lines it prints (`bootstrap/update.py:116`); a run that wrote none prints nothing more
- [decision] A template lands as `<file>.example` beside the file it stands for (owner, 2026-11-01): no skill reads that name, so a shipped example takes effect only once the user saves a filled copy under the real name.
- [decision] Every plugin with a `local.example/` gets its templates, read from HEAD through git rather than from Claude Code's installed copy (owner, 2026-10-31): only committed files install, as with the harness, and the installed copy's location is Claude Code's own layout.
- [decision] A template is written only when its `.example` path is absent, and through a `~/.claude/local` that is a link (owner, 2026-11-01): the settings and `CLAUDE.md` components write through theirs, and refreshing a stale `.example` belongs to an update mode.
- [decision] The regular-file check runs before the harness's ship filter (owner, 2026-11-01): one listing serves both callers.

## Relations
