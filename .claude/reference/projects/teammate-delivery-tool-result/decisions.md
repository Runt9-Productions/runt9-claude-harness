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
  scope widens to `domains/agent-teams/lifecycle.md` (`claude -p` hosts a named spawn, which verification later
  showed is a background subagent rather than a teammate, and `--resume` rebuilds its conversation) and `domains/plugins/overview.md` (a transcript's `api-request` rows are delta-encoded
  and are how to check what a request carried) (owner, 2026-11-11). It settles the question of whether the probe
  facts join this pull request.
- [decision] The plugin's description in `plugin.json` and in its `.claude-plugin/marketplace.json` entry reads
  "Lets a teammate that is mid-turn read a message with its next tool result, not after the turn is over", and the
  edit scope widens to that marketplace line (owner, 2026-11-11).

- [proposal] The facts on where a mid-tool-call append is filed and what a rebuild drops wait for a re-measurement
  of the previous plugin version in verification, with record lines, before they enter the knowledge base, since no
  record lines from the investigation were kept (lead, 2026-11-11).

- [decision] The `tool_reference` trap (text inside a ToolSearch result's `tool_result` content made every later
  request fail with a 400) goes in `domains/plugins/session-history-rewrite.md`, and the edit scope widens to that
  note (owner, 2026-11-11). It settles the question of whether and where the trap enters the knowledge base.

- [decision] The plugin is verified by a verifier driving an interactive lead session in tmux, since `claude -p` on
  2.1.322 hosts only background subagents with no `teammateId`, which the plugin never diverts for; it first checks
  whether the engine delivers a real teammate's mail mid-turn without the plugin (owner, 2026-11-11). It settles the
  question of how the plugin is verified.

- [decision] The header on a delivered message is "Message from <sender>, sent during your turn:", true both for a
  message added to a tool result and for one mailed at the turn's end (owner, 2026-11-11). It settles the question of
  the header's wording.
- [decision] The plugin keeps skipping a tool result that holds anything but text or images, although top-level text
  beside a `tool_reference` result was accepted in every verification run, since that evidence covers no other
  result kind and the delay costs at most one tool call (owner, 2026-11-11). It settles the question of dropping the
  skip rule.

- [decision] A message added to a tool result that no model response read, because the turn then ended by an abort
  or an error, is mailed at the turn's end, though the teammate may then read it twice (owner, 2026-11-11). It
  settles the question of what happens to a message added but never read.
- [decision] The watcher plugin's `tell`, which appends rows to a running teammate's conversation the way 0.1.2 did,
  gets its own issue rather than a change in this pull request (owner, 2026-11-11).

## Open questions

- None.

## Relations

- part_of [[Teammate Delivery Tool Result]]
