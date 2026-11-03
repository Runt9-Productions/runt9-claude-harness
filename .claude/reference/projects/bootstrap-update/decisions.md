---
title: Bootstrap Update Decisions
type: note
permalink: projects/bootstrap-update/decisions
tags:
- bootstrap
- update
---

# Bootstrap Update Decisions

Rulings for the update mode. Read before changing what [[Bootstrap Update Spec]] says update detects or writes.

## Decisions

- [decision] What is installed is read from where it already lives, with no manifest (owner, 2026-10-31): each
  component already has a record, and a second one drifts.
- [decision] Settings entries to replace or remove come from comparing the installed fragment with HEAD's, before
  the harness switches versions (owner, 2026-10-31): the old fragment is still on disk then. An identical entry the
  user had before bootstrap goes with it, which is accepted.
- [proposal] A settings fragment counts as installed when `settings.json` holds at least one entry of the installed
  fragment (D15). Status: open, acted on as recommended.
- [proposal] A value or list entry equal to the old fragment's moves to the new fragment's, or goes when the new one
  drops it; any other value is the user's and is never touched (D16). Status: open, acted on as recommended.
- [proposal] Update rewrites a `.example` template whose content differs from HEAD's and adds missing ones; real
  local files are never touched (D17). Status: open, acted on as recommended.
- [proposal] `update` is a word on the command line in place of component names, as the issue writes it; it takes
  no component names and no `--repo`. Status: open.

## Open questions

- Whether `claude plugin update <name>@<marketplace>` refreshes the marketplace catalog before computing the version.
  The docs' loading page (fetched 2026-11-03) says an install of `name@marketplace` refreshes first and says nothing
  for update, so update runs `claude plugin marketplace update <marketplace>` once before the first plugin.

## Relations

- part_of [[Bootstrap Update]]
