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

> **Scope.** How a message between Agent Teams teammates escapes tags, by mailbox and through teammate-delivery, when the engine's own delivery reaches a running agent, and how text or a row a plugin adds for a teammate reaches its requests. The escaping lines are carried from a measurement on 2.1.310 and were not re-measured when this note was written. The delivery and `session.append` lines were measured on 2.1.322 on 2026-11-11 for issue #143, from transcript rows, decoded `api-request` rows and a diagnostic plugin's log: one `claude -p` probe, six `claude -p` sessions with teammate-delivery 0.1.2 or 0.2.0 loaded (neither diverted a send there), and three interactive lead sessions with `--teammate-mode in-process`, with teammate-delivery off, at 0.1.2 and at 0.2.0. One trap's inference rests on `settle` in teammate-delivery 0.1.2's `register.ts`, read at that version for #143. `composeMessage`, `takesMessages`, `addressedTeammate` and the `session.append` and `turn.complete` hooks in the current `register.ts` were re-read on 2026-11-11 after #143 changed the message header; `ENVELOPE_LIKE_TAG` and the character constants it is built from, unchanged since they were read earlier that day for #143, and the decision line were carried forward without a re-check. Not covered: cross-session messages beyond their envelope tag, teammates in a terminal pane of their own, how teammate-delivery decides that a turn is open, `--resume` of an interactive session's teammate, and a row appended off the chain in `claude -p`.

Read this before sending or relaying text that holds tags between teammates, before changing how teammate-delivery
quotes or delivers a message, or before testing delivery in `claude -p`, where the engine delivers by another path.
The mailbox escapes less than its envelope suggests, and a row a plugin appends at the wrong moment is never sent.

## Observations

- [fact] Mailbox delivery escapes `<` as `<\` only in its own envelope tags (`teammate-message`, `cross-session-message`, `agent-message`) #measured
- [trap] A `<system-reminder>` inside a message body passes through the mailbox unescaped #measured
- [risk] So a message body can carry text shaped like a harness tag, and the receiver cannot tell it from the harness's by the tag alone.
- [fact] teammate-delivery quotes every line of a delivered message (`composeMessage`, `register.ts:45`) and inserts `\` after any `<` that opens a tag-shaped run: an optional `/`, then a name that starts with a letter and holds a dash, a connector or a colon. The look-alikes of `<`, `/` and each separator that the constants above `ENVELOPE_LIKE_TAG` list count as them and no others do, invisible characters and combining marks are skipped, a run glued to a word counts, and the closing `>` plays no part (`ENVELOPE_LIKE_TAG`, `register.ts:36`). So `List<String>`, `<div>` and one-word tags pass unchanged, and `Result<io_error>` becomes `Result<\io_error>`.
- [fact] Without a plugin diverting it, `SendMessage` to a running in-process teammate returns "Message sent to <name>'s inbox", and the text reaches no request of the running turn: it arrives only when the turn ends, as the next turn's prompt row (a `<teammate-message>` string), on the chain #measured (2.1.322, interactive, teammate-delivery off, one session: a send 14 s into a 40 s tool call arrived 33 s later, and a send during the last model response 8 ms after `turn.complete`)
- [fact] To a running background subagent in `claude -p`, `SendMessage` returns "Message queued for delivery to <name> at its next tool round", and the engine files a `queued_command` attachment row after the next tool result, on the chain. The next request sends it in that tool-result message, after the `tool_result`, as a system reminder ("The coordinator sent a message while you were working: ..."), unquoted and with no sender header, and a `--resume` rebuild carries it byte-identical #measured (2.1.322, `-p`: six sessions; the rebuild in two)
- [trap] A message sent to a `claude -p` background subagent during its last model response was never delivered, though `SendMessage` said the agent would be resumed with it if it finished first #silent-failure #measured (2.1.322, `-p`, one run: no row of the agent's transcript holds it, before or after a later `--resume` wake)
- [fact] In an interactive lead, a `session.append` hook fires for an in-process teammate's rows on the `prompt`, `response`, `tool-result`, `note` and `attachment` doors #measured (2.1.322: a diagnostic plugin's hook with no door filter logged each of them in three sessions)
- [fact] Text a `tool-result` hook adds to such a row, as a top-level text block after the `tool_result`, is stored in the teammate's row, on the chain, and the next request sends the row exactly as stored #measured (2.1.322, interactive, teammate-delivery 0.2.0: the request's `tail` hash for that message is the row's own hash)
- [fact] teammate-delivery delivers a mid-turn message that way: a diverted send holds the composed text on the teammate's open turn, and its `session.append` hook on `tool-result` adds every held text as a top-level text block after the next tool-result row of that teammate (`register.ts:145`), skipping a row whose `tool_result` content holds anything but text and images (`takesMessages`, `register.ts:60`); texts still held when the turn completes go by mailbox, one send each, whatever the ending (`turn.complete`, `register.ts:134`). It appends no row of its own.
- [fact] In `claude -p` the same holds for a background subagent's tool-result rows, with the text top-level or inside the `tool_result`'s content, and its first request after a `--resume` rebuild (`base: null`) carries the text again #measured (2.1.322, one probe; the woken turn failed on an API error the probe itself caused, after the request was sent)
- [trap] A row a plugin appends with `$.session.append` while a teammate's tool call is open is filed with the `tool_use` row as its parent, a sibling of the tool-result row stored after it, so it is off the chain from the newest row #measured (2.1.322, interactive, teammate-delivery 0.1.2, one run)
- [fact] The live requests of that turn carry the row anyway, merged into the tool-result message as `[tool_result, text]` #measured (same run)
- [trap] When a message woke the teammate after that turn, its first request kept only the messages before the tool-result message and re-sent the rest with the tool result bare, so the appended text was in no later request #silent-failure #measured (same run; the request was not a new chain, and that the re-sent part follows the chain is inferred from its matching the chain, which skips the row)
- [trap] A row appended during a teammate's last model response is stored on the chain (its parent is the turn's last tool result, and the response hangs off it), but after the final request was built, so no request carries it: the request after the next wake keeps the final request's messages unchanged #silent-failure #measured (2.1.322, interactive, teammate-delivery 0.1.2, one run)
- [trap] `$.session.messages({ agentId, as: 'api' })` read at `turn.complete` held that row although no request had carried it, so a plugin that checks delivery by reading it is told the text was delivered #silent-failure (inferred, one run: 0.1.2's `settle` mails only its wake-up text when that read holds every held row, and it mailed only the wake-up text)
- [trap] teammate-delivery diverts a send only to a running agent that has a `teammateId` (`addressedTeammate`, `register.ts:77`), so in `claude -p` on 2.1.322, where a named spawn is a background subagent ([[Teammate Lifecycle]]), it passes every send to the engine and a `-p` run cannot test it #measured (2.1.322, `-p`: no row in six sessions holds its header)
- [decision] teammate-delivery escapes every tag shaped like the harness's, a wider set than the mailbox's own (owner, 2026-10-25): no line it delivers can pass for a harness tag.

## Relations

- see_also [[Plugin Platform]]
- see_also [[Teammate Lifecycle]]
