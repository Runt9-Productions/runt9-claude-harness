---
title: Rewriting Session History
type: note
permalink: plugins/session-history-rewrite
tags: [plugins, mods, session-compact, session-append, context, resume]
verified: 2026-11-04
coverage: partial
measured_on: "Claude Code 2.1.318 and 2.1.322"
---

# Rewriting Session History

> **Scope.** What a mod can change in the conversation the model reads: a `session.append` hook on the `tool-result` door, a `session.compact` hook that answers with its own messages, and `$.session.compact()`. Every `#measured` line comes from a probe plugin loaded with `--plugin-dir` into `claude -p` sessions, and one interactive session, on 2.1.318 (2026-11-04), reading synthetic 50 KB files and checking each request's context tokens in the transcript, except the `tool_reference` line, measured on 2.1.322 on 2026-11-11 on an in-process teammate in `claude -p`, in one probe for issue #143. Not covered: subagent transcripts (`agentId`) beyond that line, the `precompute` trigger, whether skills invoked before the hook's compaction are attached again (no probe invoked one), results with media blocks, and whether a `session.compact` hook in a second plugin answers a compaction that the first plugin started.

Read this before writing a mod that trims tool results, stands in for the engine's compaction summary, or starts a
compaction itself. The traps here produce a rewrite that works in the live session and is gone after `--resume`, or
a summary where the mod meant to prune.

## Observations

- [fact] A `session.append` hook on `{ door: "tool-result" }` that replaces a `tool_result` block's `content` changes what is stored and what the model is sent: a Read result cut to 1,238 characters added about 1,000 tokens to the next request, against about 24,600 for the same read uncut #measured
- [trap] Text that hook added inside a ToolSearch result's `tool_result` content, beside its `tool_reference` block, was followed by every later request of that agent failing with `400 Tool definitions/code execution functions cannot be mixed with other content`, after `--resume` as well, while the earlier requests carrying text added to plain text results succeeded #measured (2.1.322, an in-process teammate; the cause is inferred from which requests failed, since no request was sent without that text, and a top-level text block beside such a row was not tried)
- [fact] A `session.compact` hook that returns `{ messages }` without calling `next` writes no summary and makes no model call: the `compact_boundary` row recorded 4 to 9 ms, and every message the hook returned stood in the transcript word for word #measured
- [fact] Messages handed back without their `handle` are rebuilt from `role`, `text`, `toolUses` and `toolResults`, and the engine accepted them, including a rebuilt tool-result message after an assistant message kept with its handle #measured
- [fact] Under the `auto` trigger the hook runs mid-turn between tool calls, and the turn's next request carries the hook's messages: with old results stubbed, context stayed at 62K to 67K where the same reads otherwise reached 112K #measured
- [fact] After its result was replaced by a stub naming the tool and its input, the model re-ran the call (a Read with an offset) and answered from it, in the one run where the model needed a value only a stub held #measured
- [fact] The engine adds the session's context attachments (memory files, the skill listing, the environment) back after the first message, whatever the hook returns #measured
- [trap] A message handed back with its `handle` keeps its original parent link, which points into the history before the compaction. The live session uses the hook's messages, but `--resume` follows that link and loads the whole unrewritten conversation (116K on resume against 66K live). Returning every message without its handle keeps the rewrite across resume (64K) #measured #silent-failure
- [trap] Rebuilt assistant messages lose their thinking blocks, and the prompt cache then breaks just after the system prompt rather than after the first message (13K cache read against 36K) #measured
- [fact] The request after each rewrite wrote 25K to 35K tokens to the prompt cache, most of the conversation in these runs #measured
- [risk] That a rewrite always costs a cache write of everything after the first changed message is inferred from these runs' cache-read figures, not measured on a long session.
- [fact] `$.session.compact()` rejects during a turn ("a turn is running ... call it from turn.complete or later"), from `session.measure` included, and in `claude -p` ("not available in a headless (-p / SDK) session yet") #measured
- [trap] `$.session.compact()` called from a `$.clock.after` that a `turn.complete` hook scheduled, in an interactive session, skipped the calling plugin's own `session.compact` hook, and the engine wrote its summary instead (9 s) #measured #silent-failure (one run)
- [vendor] The type docs for `$.session.compact` say it "runs through every hook but the calling one, then core".
- [fact] With autocompact off nothing starts a compaction mid-turn, so a mod cannot prune while an agent works unless autocompact is on #measured
- [fact] `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` made autocompact fire at about 67K to 77K, while `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=45` with a 200,000 window had not fired by 112K #measured (autocompact on through `--settings '{"autoCompactEnabled": true}'`)
- [trap] In `claude -p --input-format stream-json`, a `/compact` sent between two prompts ran after both: the two prompts were merged into one turn #measured
- [question] Does a `session.compact` hook in one plugin answer a `$.session.compact()` started by another? The away plugin's compact hook depends on it whenever the handoff plugin compacts. Settle it with two probe plugins in an interactive session.

## Relations

- part_of [[Plugin Platform]]
