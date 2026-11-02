---
title: Plugin Templates Checklist
type: note
permalink: projects/plugin-templates/checklist
tags:
- bootstrap
---

# Plugin Templates Checklist

## Status

- **Live item:** owner review of PR #106 (develop step 12)
- **How far along:** built, verified, reviewed and fixed; the reviewer guide is posted and the draft waits on the owner
- **Blocked on:** nothing
- **Last moved:** 2026-11-01

## Build Order

01, 01b

01 is the code, its tests and the two docs that describe the component change together. 01b is the READMEs of the
plugins that ship a `local.example/`.

## Checklist

- [x] 01 Copy each plugin's `local.example/` files as `.example` templates after the plugin installs, list them at the
  end of the run, with tests, and the root README's `plugin:` row and `CLAUDE.md`'s "Machine-local layers" updated
- [x] 01b Say in the `develop` and `delegation` READMEs that `bootstrap.py` writes their `.example` templates

## Relations

- part_of [[Plugin Templates]]
