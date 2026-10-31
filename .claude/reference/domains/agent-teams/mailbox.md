---
title: Teammate Mailbox
type: note
permalink: agent-teams/mailbox
tags: [agent-teams, teammates, escaping]
verified: 2026-10-31
coverage: partial
measured_on: "Claude Code 2.1.310"
sources:
  - plugins/teammate-delivery/hooks/register.ts
---

# Teammate Mailbox

> **Scope.** How a message between Agent Teams teammates escapes tags, by mailbox and through teammate-delivery. The mailbox lines are carried from a measurement on 2.1.310 and were not re-measured when this note was written; `composeRow`, `ENVELOPE_LIKE_TAG` and the character constants it is built from in `register.ts` were read on 2026-10-31, and the question and decision lines were carried forward without a re-check. Not covered: cross-session messages beyond their envelope tag, teammates in a terminal pane of their own, and how teammate-delivery decides that a turn is open.

Read this before sending or relaying text that holds tags between teammates, or before changing how teammate-delivery
quotes a message. The mailbox escapes less than its envelope suggests.

## Observations

- [fact] Mailbox delivery escapes `<` as `<\` only in its own envelope tags (`teammate-message`, `cross-session-message`, `agent-message`) #measured
- [trap] A `<system-reminder>` inside a message body passes through the mailbox unescaped #measured
- [risk] So a message body can carry text shaped like a harness tag, and the receiver cannot tell it from the harness's by the tag alone.
- [fact] teammate-delivery quotes every line of a delivered message (`composeRow`, `register.ts:64`) and inserts `\` after any `<` that opens a tag-shaped run: an optional `/`, then a name that starts with a letter and holds a dash, a connector or a colon. The look-alikes of `<`, `/` and each separator that the constants above `ENVELOPE_LIKE_TAG` list count as them and no others do, invisible characters and combining marks are skipped, a run glued to a word counts, and the closing `>` plays no part (`ENVELOPE_LIKE_TAG`, `register.ts:52`). So `List<String>`, `<div>` and one-word tags pass unchanged, and `Result<io_error>` becomes `Result<\io_error>`.
- [question] Whether the engine merges a row added late in a turn into that request's last message, in which case it counts as carried and no wake-up follows. Only a live run settles it.
- [decision] teammate-delivery escapes every tag shaped like the harness's, a wider set than the mailbox's own (owner, 2026-10-25): no line it delivers can pass for a harness tag.

## Relations

- see_also [[Plugin Platform]]
- see_also [[Teammate Lifecycle]]
