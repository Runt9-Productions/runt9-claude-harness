---
title: Bootstrap Update Checklist
type: note
permalink: projects/bootstrap-update/checklist
tags:
- bootstrap
---

# Bootstrap Update Checklist

## Status

- **Live item:** 01
- **How far along:** spec written, nothing built
- **Blocked on:** nothing
- **Last moved:** 2026-11-03

## Build Order

01, 02, 03

01 is the settings arithmetic on its own; 02 builds the command on it; 03 describes the finished command.

## Checklist

- [ ] 01 A function in `bootstrap/settings.py` that, given `settings.json`'s object, the installed fragment and
  HEAD's, returns the updated object (replacing and removing what came from the old fragment, adding what the new one
  has); and `write_after_asking` split so a write can follow one confirmation for many files
- [ ] 02 `bootstrap.py update`: detect each installed component, print the plan, ask once, apply in install order,
  report current, available and vanished components, with tests at the command's boundary
- [ ] 03 The README section on updating, the module docstring, `CLAUDE.md`'s bootstrap bullet, and the
  `domains/bootstrap/overview.md` note re-verified against the changed modules

## Relations

- part_of [[Bootstrap Update]]
