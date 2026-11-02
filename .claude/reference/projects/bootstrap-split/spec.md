---
title: Bootstrap Split Spec
type: note
permalink: projects/bootstrap-split/spec
tags:
- bootstrap
- harness
---

# Bootstrap Split Spec

The per-file map for issue #14, with the rulings in [[Bootstrap Split Decisions]]. Line numbers are `bootstrap.py` at
f41a333.

## Constraints

- Nothing changes in behaviour: messages, prompts, refusals, exit codes, install order and `--list` output stay
  byte for byte. Functions move with their bodies unchanged; only imports and the module each name is reached
  through change.
- The Python version check (`bootstrap.py:27-30`) stays above every import from the package, so an older interpreter
  still prints its one line. `test_older_python_stops_with_one_line` runs the script through `runpy.run_path`, which
  adds no directory to `sys.path`, so that test passes only while the check comes first.
- Directly after the check, `bootstrap.py` inserts its own resolved directory at the front of `sys.path`, which is
  where a plain `python3 bootstrap.py` already puts it.
- `CLONE` stays the clone's root: computed in the package as the parent of the package directory.
- Module-level `functools.cache` (`git_environment`, `check_plugin_setup`, `add_marketplace`) keeps its once-per-run
  meaning because each module is imported once.
- No import cycles: the helper modules import nothing from the component modules, and only the registry imports
  every component module.

## Module map

| Module | Holds (from `bootstrap.py`) |
|---|---|
| `bootstrap.py` | docstring, version check, the `sys.path` line, `SESSION_VARIABLES`, `ask`, `pick`, `bootstrap`, `main` (`:590-672` less `answered_yes`) |
| `bootstrap/__init__.py` | a one-line docstring only |
| `bootstrap/core.py` | `CLONE`, `CLAUDE_DIR`, `Stop`, `Run`, `Component`, `warn`, `answered_yes` (`:32,36,69-92,590-596`) |
| `bootstrap/git.py` | `git_environment`, `run_git`, `git_failure`, `git`, `git_config` (`:95-130`) |
| `bootstrap/files.py` | `parse_json_object`, `read_json_object`, `write_after_asking` (`:133-148,348-365`) |
| `bootstrap/harness.py` | the harness constants (`:38-49`), `check_checkout`, `ships`, `export_tree`, `harness_version`, `install_harness`, `require_harness`, `require_installed`, `shipped_in_head` (`:151-235,332-345`) |
| `bootstrap/hooks_path.py` | `check_hooks_path`, `report_replaced_hooks`, `install_hooks_path` (`:238-290`) |
| `bootstrap/skills.py` | `SKILLS_DIR`, `SKILL_FILE`, `check_skills`, `is_link_to`, `install_skills` (`:51-52,293-329`) |
| `bootstrap/fragments.py` | the fragment and block constants (`:54-60`), `check_fragment`, `block_bounds`, `with_import`, `install_fragment`, `fragment_components` (`:368-437`) |
| `bootstrap/settings.py` | `SETTINGS`, `SETTINGS_FILE`, `DEFAULT_INDENT` (`:62-64`), `check_settings`, `merge_settings`, `json_indent`, `install_settings`, `settings_components` (`:440-507`) |
| `bootstrap/plugins.py` | `MARKETPLACE_FILE`, `MARKETPLACE_SOURCE`, `PLUGIN_DIRS_VARIABLE` (`:33-34,66`), `check_plugin_setup`, `claude`, `add_marketplace`, `install_plugin`, `plugin_components` (`:510-562`) |
| `bootstrap/registry.py` | `HARNESS_COMPONENTS` with its comment (`:565-587`), and one function returning the whole list in install order, as `bootstrap` builds it at `:628` |

`UPSTREAM` (`:35`) goes with `check_checkout` in `harness.py`. `INSTALL_DIR`, `VERSIONS_DIR` and `CURRENT` go in
`harness.py`, which the fragments, settings, skills and hooks-path modules import them from.

## Tests

- `test_bootstrap.py`'s `sandbox` fixture copies `bootstrap.py` alone into its synthetic clone (`:120`); it also
  copies the `bootstrap/` package, leaving `__pycache__` out, before the fixture's first commit. No test function
  changes.

## Docs

- `CLAUDE.md`, the `bootstrap.py` bullet in "Layout": the package and where `HARNESS_COMPONENTS` now lives.
- `.claude/code-review-profile.md`: the `guard-security` and `claude-code-expert` routing rows name `bootstrap/`
  beside `bootstrap.py`, and the companion line names `HARNESS_COMPONENTS` in `bootstrap/registry.py`.
- [[Guardrails]]: `sources` lists `bootstrap/settings.py` in place of `bootstrap.py`, since its merge trap rests on
  `merge_settings`; re-check that trap and move `verified`.
- No version rises: neither file ships in a plugin or under `harness/`.

## Ticket

Issue #14 was rewritten to this scope and approved for posting (owner, 2026-10-31); it needs no further change.

## Relations

- part_of [[Bootstrap Split]]
- see_also [[Bootstrap Split Estimate]]
