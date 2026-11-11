---
title: Teammate Delivery Tool Result Spec
type: note
permalink: projects/teammate-delivery-tool-result/spec
tags:
- plugins
- agent-teams
- teammate-delivery
---

# Teammate Delivery Tool Result Spec

The per-file map for issue #143, with the rulings in [[Teammate Delivery Tool Result Decisions]]. Line numbers are at
6fb3bf1.

## What was measured

- [fact] A row a plugin adds with `$.session.append` for an in-process teammate while its tool call is open is stored
  with the `tool_use` row as its parent, and the tool result that follows has the same parent, so the row is off the
  chain the conversation is rebuilt from #measured (Claude Code 2.1.322, interactive, teammate-delivery 0.1.2)
- [fact] The request in flight still carries that row, merged into the tool-result message; a request after the
  teammate was woken from an ended turn carried the tool-result message without it #measured (2.1.322, interactive,
  from the teammate's `api-request` records)
- [fact] A `session.append` hook on the `tool-result` door fires for a teammate's rows, and text it adds as a
  top-level block is stored on the chain, sent on the next request and kept when the teammate is woken #measured
  (2.1.322, interactive, teammate-delivery 0.2.0)
- [fact] In `claude -p` a named spawn is a background subagent with no `teammateId`, which the plugin never diverts
  for; the engine itself delivers its mail at the next tool round. With the plugin off, an interactive teammate gets
  mail only after its turn ends #measured (2.1.322)
- [trap] Text added inside a ToolSearch result's `tool_result` content, beside a `tool_reference` block, made every
  later request fail with `400 Tool definitions/code execution functions cannot be mixed with other content`; text as
  a top-level block in the same message as such a result was accepted in every run #measured (2.1.322; the cause is
  inferred from which requests failed)
- [trap] `claude plugin validate --strict` warned "gating hook without .catch" on a probe's `session.append` hook that
  only returned `next(e)` #measured (2.1.322)

## `plugins/teammate-delivery/hooks/register.ts`

- `Turn` (line 13): `rows` becomes the composed texts held for the turn; `ending` goes, since no send can store a row
  after the turn closed.
- `storeRow` (line 144): composes the row as now and returns the target and turn, without calling
  `$.session.append`. The `deny` case goes. Built as `divertedMessage`, with `composeRow` renamed `composeMessage`.
- `session.send` (line 224): a diverted send pushes the composed text onto the open turn and answers
  `{ isDelivered: true }`. The branch for a turn that ended during the append (lines 233-240) goes. A turn that closed
  while `$.agent.list()` was in flight leaves the send to the mailbox.
- New `session.append` hook on `{ door: 'tool-result' }`: for a row whose `e.agentId` names an open turn holding
  texts, and whose every `tool_result` block's content is a string or text and image blocks only, add each held text
  as a top-level text block after the row's blocks, clear the turn's texts, and pass the rewritten row to `next`. Any
  other row passes unchanged.
- `turn.step` (line 186): keeps only reopening the turn (`openTurn`), so a reload still learns of open turns at the
  next request. The carried check and its removal loop go.
- `turn.complete` (line 212): sends each held text by mailbox with `mail`, whatever `e.reason`, after `next(e)`.
- Removed: `WAKE_UP`, `BLOCK_SEPARATOR`, `bounded`, `heldRows`, `conversation`, `settle`, and `textBlocks` unless the
  new hook uses it.

## `plugins/teammate-delivery/hooks/register.test.ts`

- The `world` helper drives a teammate's tool result with the engine's `$.session.append` call, passing a full
  tool-result input (door `tool-result`, an `agentId`, a `tool_result` block), and reads the stored rows back.
- Diverting: a send to a running teammate stores nothing at once, and its next tool-result row carries the composed
  text as a top-level block; the header, quoting and escaping tests assert on that block.
- Skipping: a tool-result row holding a `tool_reference` block passes unchanged and the next ordinary one carries the
  text.
- Turn end: held texts go by mailbox, one send each, for every ending; a mailbox refusal is toasted.
- Tests of the removed matching (prefix rows, requests that drew no response, rows stored while a request streams) go.

## `plugins/teammate-delivery/README.md`

- "When it applies": the message is held until the teammate's next tool result and added to that row; a result that
  holds anything but text or images is skipped.
- "When the turn ends": held messages go by mailbox whatever the ending; the wake-up message goes.
- The reload paragraph says that a reload loses the messages held for a teammate, from the send until its next tool
  result, with no toast.
- "What the teammate sees": the message arrives as a text block after the next tool result, not as a row of its own.
- "Other plugins": `session.append` hooks see the message inside a `tool-result` row, not as a `note` row.

## `plugins/teammate-delivery/.claude-plugin/plugin.json`

- `version` 0.1.2 to 0.2.0.

## The knowledge base

- `domains/agent-teams/mailbox.md`: the filing fact and the rebuild fact above, with `measured_on` and the Scope line
  updated, and a `sources` check against the new `register.ts`.
- `projects/watcher-plugin/decisions.md`: its open question on whether `session.append` fires for an in-process
  teammate's rows gets a `[fact]` line answering it from this measurement.
- `domains/agent-teams/lifecycle.md`: `claude -p` hosts a named spawn as a background subagent, not an in-process
  teammate, and `--resume` rebuilds its conversation from its transcript #measured (2.1.322).
- `domains/agent-teams/mailbox.md` (item 03): the engine's own delivery to a teammate and to a `-p` subagent, and
  0.1.2's rows filed off the chain or stored after the final request, from the interactive runs.
- `domains/plugins/overview.md`: a transcript's `api-request` rows are delta-encoded, as a `base` request id, a
  `keep` count and `tail` hashes; most `tail` hashes are the sha256 of a transcript row's `{role, content}` as compact
  JSON with sorted keys, and `api-request-blob` rows map the rest to a message. These rows are how to check what a
  request carried #measured (2.1.322).

## Draft ticket description

Issue #143 as rewritten on 2026-11-11, with the "Open" bullet replaced by the probe's result and the proposed change
updated for the turn-end ruling. Shown in full to the owner before it is posted.

## Relations

- part_of [[Teammate Delivery Tool Result]]
