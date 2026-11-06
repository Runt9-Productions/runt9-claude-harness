---
title: Bootstrap Menu Checklist
type: note
permalink: projects/bootstrap-menu/checklist
tags:
- bootstrap
- menu
---

# Bootstrap Menu Checklist

## Status

- **Live item:** none; built in #121
- **How far along:** 01 to 05 built, verified and reviewed
- **Blocked on:** nothing
- **Last moved:** 2026-11-06

## Build Order

01, 02, 03, 04, 05

01 and 02 are independent; 03 needs 01's descriptions; 04 describes the finished command.

## Checklist

- [x] 01 `Component.description` and its readers: every component's full description read at HEAD from the docs
  that hold it, with a test that every component of this repository has one
- [x] 02 `bootstrap.py all`: every component in install order, `hooks-path` only with `--repo`, refused beside other
  names, and documented in `--list`
- [x] 03 The curses menu in `bootstrap/menu.py` replacing `ask`: installed and behind marks from the update survey,
  toggling, toggle all, expanding a description, scrolling, the terminal checks, and tests driven through a
  pseudo-terminal
- [x] 04 `README.md`'s install section, the script's docstring and help, `CLAUDE.md`'s bootstrap bullet, and the
  `domains/bootstrap/overview.md` note re-verified against the changed modules
- [x] 05 What-it-is summaries and descriptions: harness, hooks-path and skills summaries, fragment and settings
  summaries from their READMEs, and harness, hooks-path and skills descriptions that name their contents

## Relations

- part_of [[Bootstrap Menu]]
