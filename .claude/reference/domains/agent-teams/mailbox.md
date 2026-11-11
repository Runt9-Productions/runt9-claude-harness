---
title: Teammate Mailbox
type: note
permalink: agent-teams/mailbox
tags: [agent-teams, teammates, escaping, teammate-delivery, session-append]
verified: 2026-11-11
coverage: partial
measured_on: "Claude Code 2.1.310 and 2.1.322"
sources:
  - plugins/teammate-delivery/hooks/register.ts
---

# Teammate Mailbox

> **Scope.** How a message between Agent Teams teammates escapes tags, by mailbox and through teammate-delivery, and how text a plugin adds to a teammate's tool result reaches its requests. The mailbox lines are carried from a measurement on 2.1.310 and were not re-measured when this note was written. The tool-result line was measured on 2.1.322 on 2026-11-11, in one probe for issue #143. `composeMessage`, `ENVELOPE_LIKE_TAG` and the character constants it is built from, `takesMessages` and the `session.append` and `turn.complete` hooks in `register.ts` were read on 2026-11-11 for #143; the decision line was carried forward without a re-check. Not covered: cross-session messages beyond their envelope tag, teammates in a terminal pane of their own, how teammate-delivery decides that a turn is open, and where a row a plugin appends with `$.session.append` during a teammate's tool call is filed and whether a rebuilt conversation keeps it (not yet measured with its records kept).

Read this before sending or relaying text that holds tags between teammates, or before changing how teammate-delivery
quotes or delivers a message. The mailbox escapes less than its envelope suggests.

## Observations

- [fact] Mailbox delivery escapes `<` as `<\` only in its own envelope tags (`teammate-message`, `cross-session-message`, `agent-message`) #measured
- [trap] A `<system-reminder>` inside a message body passes through the mailbox unescaped #measured
- [risk] So a message body can carry text shaped like a harness tag, and the receiver cannot tell it from the harness's by the tag alone.
- [fact] teammate-delivery quotes every line of a delivered message (`composeMessage`, `register.ts:45`) and inserts `\` after any `<` that opens a tag-shaped run: an optional `/`, then a name that starts with a letter and holds a dash, a connector or a colon. The look-alikes of `<`, `/` and each separator that the constants above `ENVELOPE_LIKE_TAG` list count as them and no others do, invisible characters and combining marks are skipped, a run glued to a word counts, and the closing `>` plays no part (`ENVELOPE_LIKE_TAG`, `register.ts:36`). So `List<String>`, `<div>` and one-word tags pass unchanged, and `Result<io_error>` becomes `Result<\io_error>`.
- [fact] A `session.append` hook on the `tool-result` door fires for an in-process teammate's tool-result rows, and text it adds to such a row, as a top-level text block after the `tool_result` or inside the `tool_result`'s content, is stored in the teammate's transcript row, carried by its next request, and carried again by its first request after `--resume` rebuilt its conversation from the transcript #measured (2.1.322: one `claude -p` run and one resumed run, read from the teammate's transcript rows and decoded `api-request` rows; the lead's own transcript held none of the added text; the resumed turn failed on an API error the probe itself caused, after the request had been sent)
- [fact] teammate-delivery delivers a mid-turn message that way: a diverted send holds the composed text on the teammate's open turn, and its `session.append` hook on `tool-result` adds every held text as a top-level text block after the next tool-result row of that teammate (`register.ts:145`), skipping a row whose `tool_result` content holds anything but text and images (`takesMessages`, `register.ts:60`); texts still held when the turn completes go by mailbox, one send each, whatever the ending (`turn.complete`, `register.ts:134`). It appends no row of its own.
- [question] Whether the engine merges a row added late in a turn into that request's last message. teammate-delivery no longer depends on it, since it appends no row of its own; only a live run settles it.
- [decision] teammate-delivery escapes every tag shaped like the harness's, a wider set than the mailbox's own (owner, 2026-10-25): no line it delivers can pass for a harness tag.

## Relations

- see_also [[Plugin Platform]]
- see_also [[Teammate Lifecycle]]
