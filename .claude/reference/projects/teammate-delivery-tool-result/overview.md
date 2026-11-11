---
title: Teammate Delivery Tool Result
type: note
permalink: projects/teammate-delivery-tool-result/overview
tags:
- plugins
- agent-teams
- teammate-delivery
status: complete
opened: '2026-11-11'
---

# Teammate Delivery Tool Result

Makes a message that teammate-delivery hands to a teammate mid-turn survive a rebuild of that teammate's conversation
from its transcript (issue #143). It ends when that pull request merges.

## Where it stands

- [status] Complete: teammate-delivery 0.2.0 holds a mid-turn message, adds it to the teammate's next tool result,
  and mails at the turn's end what is still held or unread. Its durable facts are in [[Teammate Mailbox]],
  [[Teammate Lifecycle]], [[Plugin Platform]] and [[Rewriting Session History]].

## Goal

- A message sent to a teammate while it has a tool call open is still in its conversation after the conversation is
  rebuilt from the transcript, as when a later message wakes the teammate after its turn ended.
- A message nothing carried before the turn ended reaches the teammate through the mailbox, whatever the ending.
- The plugin's own bookkeeping no longer guesses which request carried a message from the stored conversation.

## Designs ruled out

- Appending the message as its own row while a tool call is open, as the plugin did: the row is filed beside the
  tool result rather than before or after it, so a rebuilt conversation drops it (#143).
- Reporting the filing to Claude Code and waiting for an engine fix alone: messages stay lossy until then.
- Adding the message inside the `tool_result` block's content: next to a `tool_reference` block, that text made every
  later request fail with an API 400.
- A kit test as the evidence for the cause: the kit models the conversation as whatever `session.messages` returns,
  which is the assumption that failed.

## Relations

- see_also [[Teammate Delivery Tool Result Decisions]]
- see_also [[Teammate Delivery Tool Result Checklist]]
- see_also [[Teammate Delivery Tool Result Spec]]
- see_also [[Teammate Delivery Tool Result Estimate]]
