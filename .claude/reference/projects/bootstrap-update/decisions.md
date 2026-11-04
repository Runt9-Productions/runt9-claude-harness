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
- [decision] Each changed settings fragment is offered on its own, with its diff of `settings.json` and its own
  confirmation, and is offered when `settings.json` holds at least one entry of the installed fragment (owner,
  2026-11-03): a wrong guess costs one "no", and the user approves each settings change separately.
- [decision] A value or list entry equal to the old fragment's moves to the new fragment's, or goes when the new one
  drops it; any other value is the user's and is never touched (owner, 2026-11-03): an entry still equal to the old
  fragment's came from bootstrap.
- [decision] Update rewrites a `.example` template whose content differs from HEAD's and adds missing ones; real
  local files are never touched (owner, 2026-11-03): only bootstrap writes `.example` files.
- [decision] A key or list entry the old fragment has and `settings.json` lacks stays absent on update, and only what
  the new fragment adds beyond the old one is merged (owner, 2026-11-03): the user removed it, and offering it back
  would repeat the same prompt on every update.
- [decision] An object or list that update's removals leave empty is removed, and one the user had empty is kept
  (lead, 2026-11-03): otherwise a fragment that drops a whole list leaves an empty one behind.
- [decision] Update is the `--update` flag: with no component names it covers everything installed, and with names
  only those, each of which must be installed; `--repo` with it stops (owner, 2026-11-03): a flag leaves room to
  update one component without updating the rest.
- [decision] When the harness moves past a version that drops a settings fragment `settings.json` still holds,
  update offers to remove that fragment's entries with its own diff and question (owner, 2026-11-04): after the move
  no run can tell those entries came from bootstrap.
- [decision] After updating plugins, update lists them again and reports a plugin left short of HEAD's version
  rather than as updated (lead, 2026-11-04): `claude plugin update` installs GitHub's `main`, which can differ from
  the checkout.
- [decision] A no to a settings fragment in a run that moves the harness is final, and only the README says so
  (owner, 2026-11-04): later runs compare against the new harness's copy, and a warning at each question was not
  wanted.

## Open questions

- Whether `claude plugin update <name>@<marketplace>` refreshes the marketplace catalog before computing the version.
  The docs' loading page (fetched 2026-11-03) says an install of `name@marketplace` refreshes first and says nothing
  for update, so update runs `claude plugin marketplace update <marketplace>` once before the first plugin.

## Relations

- part_of [[Bootstrap Update]]
