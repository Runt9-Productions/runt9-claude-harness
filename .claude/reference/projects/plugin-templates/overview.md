---
title: Plugin Templates
type: note
permalink: projects/plugin-templates/overview
tags:
- bootstrap
- plugins
- local-files
status: implementation
opened: '2026-11-01'
---

# Plugin Templates

Has bootstrap's `plugin:<name>` component copy each file in the plugin's `local.example/` into
`~/.claude/local/<name>/` as an inert `<file>.example` (issue #37), so a user learns which machine-local files a plugin
reads and has a starting copy to fill in. It ends when that merges with tests at the component's boundary.

## Where it stands

- [status] Tasks 01 and 01b committed and verified; the pull request and its reviews come next.

## Goal

- After `plugin:<name>` installs, each file under `plugins/<name>/local.example/` at HEAD exists as
  `~/.claude/local/<name>/<path>.example`, and the run's output lists every one it wrote.
- Nothing that exists is overwritten, and no file a skill reads changes.

## Designs ruled out

- Copying under the real file name: the skills read those files as rules that win over their own, so a shipped
  example would take effect at once (owner, 2026-11-01).
- Rewriting the examples as placeholders and copying under the real name: placeholder text would still reach every
  skill's prompt, and the plugin READMEs would lose worked examples.
- Reading the templates from Claude Code's installed copy of the plugin: where it keeps that copy is its own layout.

## Relations

- see_also [[Plugin Templates Decisions]]
- see_also [[Plugin Templates Checklist]]
- see_also [[Plugin Templates Spec]]
- see_also [[Plugin Templates Estimate]]
