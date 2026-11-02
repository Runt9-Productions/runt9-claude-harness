---
title: Plugin Templates Spec
type: note
permalink: projects/plugin-templates/spec
tags:
- bootstrap
- plugins
---

# Plugin Templates Spec

The per-file map for issue #37, with the rulings in [[Plugin Templates Decisions]]. Line numbers are at 734b1d1.

## Behaviour

- In `install_plugin` (`bootstrap/plugins.py:43`), once `claude plugin install` has succeeded, list
  `plugins/<name>/local.example/` in HEAD. For each regular file at relative path `<path>`, write its blob to
  `~/.claude/local/<name>/<path>.example`, creating directories, unless that path already exists. A plugin with no
  `local.example/` writes nothing and is not an error. A non-regular entry (a link, a submodule) stops the component
  with the message `export_tree` gives for one.
- A failed `claude plugin install` writes no template, since the copy follows it.
- Each file written prints `plugin:<name>: wrote <path>`, and each skipped one `plugin:<name>: kept <path>, which
  already exists`.
- `Run` (`bootstrap/core.py:15`) gains a list of the template paths written. After the `Installed ...` line
  (`bootstrap.py`, in `bootstrap`), a run that wrote any prints `Templates to fill in, saved without .example to take
  effect:` and one path per line. A run that wrote none prints nothing more.

## Module map

| File | Change |
|---|---|
| `bootstrap/harness.py` | The listing half of `export_tree` (`:46-63`), `ls-tree` plus the mode check, becomes a function both it and the template copy call; `export_tree` keeps its `ships` filter and its refusal of an empty source. The mode check now runs before the filter, so a link that would not ship also stops the harness; HEAD has none. |
| `bootstrap/plugins.py` | `LOCAL_DIR = CLAUDE_DIR / "local"`, the template copy, and its call at the end of `install_plugin`. |
| `bootstrap/core.py` | `Run.templates`. |
| `bootstrap.py` | The closing list. |
| `test_bootstrap.py` | The tests below. |
| `README.md` | The `plugin:<name>` row: the templates come from this clone's HEAD, land as `.example`, and are never overwritten. |
| `CLAUDE.md` | "Machine-local layers": `bootstrap.py` copies a plugin's `local.example/` files as `.example` templates. |

## Tests

At the component's boundary, through `sandbox.run`, each committing its own synthetic `plugins/example-one/local.example/`:

- Installing `plugin:example-one` writes each file, a nested one included, as `.example` under
  `~/.claude/local/example-one/` with the committed bytes, and the closing list names each; `plugin:example-two`, with
  no `local.example/`, writes nothing.
- An existing `.example` and an existing real file are byte for byte unchanged, and only the absent one is written.

## Ticket

Planned change to #37: the acceptance criteria name `<file>.example` in place of the real file, and the technical
details drop the open question the decisions settled.

## Relations

- part_of [[Plugin Templates]]
- see_also [[Plugin Templates Estimate]]
