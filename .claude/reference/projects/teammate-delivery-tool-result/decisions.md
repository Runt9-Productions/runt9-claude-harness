---
title: Teammate Delivery Tool Result Decisions
type: note
permalink: projects/teammate-delivery-tool-result/decisions
tags:
- plugins
- agent-teams
- teammate-delivery
---

# Teammate Delivery Tool Result Decisions

Rulings for the teammate-delivery fix in issue #143. Read before changing what [[Teammate Delivery Tool Result Spec]]
says the plugin does.

## Decisions

- [decision] The fix holds a diverted message and adds it to the teammate's next tool-result row through a
  `session.append` hook, rather than only reporting the filing to Claude Code (owner, 2026-11-11).
- [decision] Issue #143's Technical details are rewritten with the measured cause (owner, 2026-11-11).
- [decision] The knowledge base fact on where a mid-tool-call append is filed goes in the fix's pull request
  (owner, 2026-11-11).
- [decision] A turn that ends by interruption, refusal or an error with messages still held sends them by mailbox, as
  happens without the plugin, rather than only toasting (owner, 2026-11-11).
- [proposal] The message goes in as a top-level text block of the tool-result row, never inside the `tool_result`
  block, and a row whose `tool_result` content holds anything but text or images is skipped, leaving the messages for
  the next row (approved with the spec, 2026-11-11): text beside a `tool_reference` broke every later request in the probe.
- [decision] A reload of the plugin mid-turn loses the messages it holds, which were never stored; this is accepted
  and the README says so, rather than keeping held messages somewhere a reload does not clear (owner, 2026-11-11).
  It settles the question of what a reload may lose.
- [decision] The spec and the rewritten issue text are approved (owner, 2026-11-11).
- [decision] This pull request also adds two facts from the investigation probes to the knowledge base, and the edit
  scope widens to `domains/agent-teams/lifecycle.md` (`claude -p` hosts an in-process teammate, and `--resume`
  rebuilds its conversation) and `domains/plugins/overview.md` (a transcript's `api-request` rows are delta-encoded
  and are how to check what a request carried) (owner, 2026-11-11). It settles the question of whether the probe
  facts join this pull request.
- [decision] The plugin's description in `plugin.json` and in its `.claude-plugin/marketplace.json` entry reads
  "Lets a teammate that is mid-turn read a message with its next tool result, not after the turn is over", and the
  edit scope widens to that marketplace line (owner, 2026-11-11).

- [proposal] The facts on where a mid-tool-call append is filed and what a rebuild drops wait for a re-measurement
  of the previous plugin version in verification, with record lines, before they enter the knowledge base, since no
  record lines from the investigation were kept (lead, 2026-11-11).

## Open questions

- [question] Does the `tool_reference` trap (text inside a ToolSearch result's `tool_result` content made every later
  request fail with a 400) go in the knowledge base, in `domains/plugins/session-history-rewrite.md`, outside the
  approved scope?

## Relations

- part_of [[Teammate Delivery Tool Result]]
