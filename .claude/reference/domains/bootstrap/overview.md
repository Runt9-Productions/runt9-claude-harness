---
title: Bootstrap
type: note
permalink: bootstrap/overview
tags: [bootstrap, plugins, local-files, python]
verified: 2026-11-02
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
  - test_bootstrap.py
---

# Bootstrap

> **Scope.** How `bootstrap.py` and its `bootstrap/` package are laid out and imported, and how a plugin's `local.example/` templates are copied into `~/.claude/local/`, all read at 29124ac: the script's top through its imports and the check and install loop in `bootstrap`; every package module's imports and its `functools.cache` uses; `copy_templates`, `check_plugin` and `install_plugin` in `plugins.py`; `tree_files` and `export_tree` in `harness.py`; `Run` and `CLONE` in `core.py`; the component list in `registry.py`; the `sandbox` fixture's copy and the `-P` test in `test_bootstrap.py`. The import precedence line was measured on Python 3.12.3 with synthetic files. Not covered: what each component installs beyond the template copy, and the rest of the tests.

Read this before adding a module to `bootstrap/`, moving code between its modules, or changing what `bootstrap.py`
writes into `~/.claude/local/`. The traps here break the script before it can print why, make a template come from
a different commit than its plugin, or stop a whole run.

## Observations

### Layout and imports

- [trap] The Python version check (`bootstrap.py:17`) sits above the `sys.path` line and every import from the package, because on an older interpreter the package's annotations raise at import, before `main` could say why #order-dependent
- [fact] `bootstrap.py:23` puts its own directory at the front of `sys.path` before importing the package, since `-P`, `-I` and `PYTHONSAFEPATH` leave it off; `test_bootstrap.py` runs `--list` under `-P` (`:260`)
- [trap] `bootstrap.py` and the `bootstrap/` package share a name in one directory, and `import bootstrap` finds the package only because it is a regular package: with `x.py` beside an `x/` holding no `__init__.py`, `import x` loaded `x.py`, and with `x/__init__.py` added it loaded the package. Without `bootstrap/__init__.py`, `import bootstrap` would load the script, which is no package #measured
- [fact] The package imports in layers with no cycle: `core` imports nothing from the package; `files` and `git` import only `core`; `harness` imports `core`, `files` and `git`; `fragments`, `hooks_path`, `settings` and `skills` import `harness`; `plugins` imports `harness` and `settings`; only `registry` imports every component module
- [fact] `CLONE` (`bootstrap/core.py:6`) is the parent of the package directory, the clone's root
- [fact] `git_environment` (`bootstrap/git.py:9`), `check_plugin_setup` and `add_marketplace` (`bootstrap/plugins.py:22`, `:44`) are `functools.cache`d so each runs once per run
- [fact] The `sandbox` fixture copies the whole `bootstrap/` package into its synthetic clone, leaving out `__pycache__` (`test_bootstrap.py:123`), so a new module reaches the tests with no fixture change
- [decision] `bootstrap.py` puts its own directory on `sys.path` before importing the package (owner, 2026-10-31): safe-path modes leave it off, and the script worked in them as a single file.
- [decision] The package is named `bootstrap/` (owner, 2026-11-02): it sits beside the script it serves, and the script runs as `__main__`, so the shared name causes no import clash.

### Plugin templates

- [fact] After `claude plugin install` succeeds, `install_plugin` (`bootstrap/plugins.py:80`) calls `copy_templates` (`:60`), which writes each file under `plugins/<name>/local.example/` in the clone's HEAD to `~/.claude/local/<name>/<path>.example`; a plugin with no `local.example/` writes nothing
- [trap] The plugin installs from the GitHub marketplace (`MARKETPLACE_SOURCE`, `bootstrap/plugins.py:14`) while its templates come from whatever HEAD the clone has checked out, so the two can be different versions of the plugin
- [trap] A run that picks only `plugin:` components gets neither the harness's refusal of uncommitted changes nor its warning that HEAD is not on `origin/main`: `check_checkout` (`bootstrap/harness.py:28`) is the `harness` component's check alone (`bootstrap/registry.py:16`) #silent-failure
- [fact] Each template is written with an exclusive create (`open("xb")` in `copy_templates`), so a file or a link already at the `.example` path is kept and printed as `kept`; whether the real file exists makes no difference, and a `~/.claude/local` or parent directory that is a link is written through
- [trap] `check_plugin` (`bootstrap/plugins.py:53`) lists the templates only so that `tree_files` raises on a link or submodule, and `bootstrap` in `bootstrap.py` runs every picked component's check before the first install, so one such entry under any picked plugin's `local.example/` stops the whole run with nothing installed #order-dependent
- [trap] `tree_files` (`bootstrap/harness.py:54`) checks each entry's mode before `export_tree` applies its `ships` filter, so a link at a harness path that would not ship stops the harness install too
- [fact] Each path written is appended to `Run.templates` (`bootstrap/core.py:19`), and `bootstrap` prints them after the `Installed ...` line; a run that wrote none prints nothing more
- [decision] A template lands as `<file>.example` beside the file it stands for (owner, 2026-11-01): no skill reads that name, so a shipped example takes effect only once the user saves a filled copy under the real name.
- [decision] Every plugin with a `local.example/` gets its templates, read from HEAD through git rather than from Claude Code's installed copy (owner, 2026-10-31): only committed files install, as with the harness, and the installed copy's location is Claude Code's own layout.
- [decision] A template is written only when its `.example` path is absent, and through a `~/.claude/local` that is a link (owner, 2026-11-01): the settings and `CLAUDE.md` components write through theirs, and refreshing a stale `.example` belongs to an update mode.
- [decision] The regular-file check runs before the harness's ship filter (owner, 2026-11-01): one listing serves both callers.

## Relations
