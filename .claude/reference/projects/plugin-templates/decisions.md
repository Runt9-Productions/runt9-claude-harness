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
- [proposal] A template is written only when its `.example` path is absent, whether or not the real file exists, and
  through a `~/.claude/local` that is a link, as the settings and `CLAUDE.md` components write through theirs.
  Refreshing a stale `.example` is left to the update mode. Status: open.

## Open questions

- None.

## Relations

- part_of [[Plugin Templates]]
