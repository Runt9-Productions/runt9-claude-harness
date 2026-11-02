---
title: Plugin Templates Decisions
type: note
permalink: projects/plugin-templates/decisions
tags:
- bootstrap
- plugins
---

# Plugin Templates Decisions

Rulings for copying plugin templates. Read before changing where a template lands in [[Plugin Templates Spec]].

## Decisions

- [decision] Every plugin with a `local.example/` gets its templates, read from HEAD through git, not one plugin by
  name and not from the installed copy (owner, 2026-10-31): only committed files install, as with the harness.
- [decision] A template lands as `<file>.example` beside the file it stands for (owner, 2026-11-01): no skill reads that
  name, so nothing changes until the user or the setup skill saves a filled copy under the real name.
- [decision] A template is written only when its `.example` path is absent, whether or not the real file exists, and
  through a `~/.claude/local` that is a link (owner, 2026-11-01): the settings and `CLAUDE.md` components write
  through theirs, and refreshing a stale `.example` is left to the update mode.
- [decision] The READMEs of the plugins that ship a `local.example/` say that `bootstrap.py` writes `.example` copies,
  in the same change and with no version rise (owner, 2026-11-01): a plugin's own README is where its user looks for
  its local files, and a top-level README ships no behaviour.
- [decision] The "is this a regular file" check runs before the harness's ship filter, so a link at a path that does
  not ship also stops the install (owner, 2026-11-01): one listing serves both callers, and no such path exists.

## Open questions

- None.

## Relations

- part_of [[Plugin Templates]]
