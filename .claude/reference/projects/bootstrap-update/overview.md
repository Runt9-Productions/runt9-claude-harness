---
title: Bootstrap Update
type: note
permalink: projects/bootstrap-update/overview
tags:
- bootstrap
- harness
- plugins
- update
status: implementation
opened: '2026-11-03'
---

# Bootstrap Update

Adds `bootstrap.py update` (issue #41): one command that brings every installed component up to the checkout,
including plugins, and replaces or removes the settings entries a newer harness version changed or dropped. It ends
when that merges with tests at the command's boundary.

## Where it stands

- [status] Spec written; the build waits for a session started in the worktree.

## Goal

- `update` finds what is installed from where it already lives, shows everything it would change, asks once, and
  then applies the changes in install order.
- A settings entry the user set is never changed; an entry bootstrap set from an older fragment follows the new one.

## Designs ruled out

- A manifest of installed components and versions: each one is already recorded by its own file, link or Claude
  Code's plugin list, and a second record drifts when the user changes something outside bootstrap (owner,
  2026-10-31).
- A per-entry record of what bootstrap added to `settings.json`: the old installed fragment says the same and needs
  no state (owner, 2026-10-31).
- Installing components the user never picked: out of scope; update reports them as available instead.

## Relations

- see_also [[Bootstrap Update Decisions]]
- see_also [[Bootstrap Update Checklist]]
- see_also [[Bootstrap Update Spec]]
- see_also [[Bootstrap Update Estimate]]
