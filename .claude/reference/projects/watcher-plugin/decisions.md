---
title: Watcher Plugin Decisions
type: note
permalink: projects/watcher-plugin/decisions
tags:
- watcher
- board
- model-judge
---

# Watcher Plugin Decisions

Rulings for building the `watcher` plugin. Platform facts measured for it that outlive the project go to
[[Plugin Platform]] when the plugin merges.

## Decisions

- [decision] A model may judge, through the user's own Claude Code credentials (Haiku by default); nothing goes to
  any other service (owner, 2026-11-05): the watched session already sends the same content there.
- [decision] The watcher is a helper with a thin safety layer: it judges whether the work is on track and what the
  owner should know, and leaves security to auto mode, permission rules and the sandbox (owner, 2026-11-05): checks
  that only repeat the classifier add cost and noise.
- [decision] It ships as a frame plus checks, and grows by adding checks (owner, 2026-11-05): new ideas then need
  prose, not code.
- [decision] It both nudges the watched agent and flags to the owner (owner, 2026-11-05).
- [decision] Findings reach the owner through the tools Claude Code already has (board, toasts), not desktop
  notifications (owner, 2026-11-05).
- [decision] Watchers share state across sessions on the machine (owner, 2026-11-05): overlap between sessions is
  the first use, and later tools can read it.
- [decision] The judge is a mod calling `$.model.complete` in a fresh context in every session; observer agents may
  join later for teammates (owner, 2026-11-06).
- [decision] The judge looks at each turn's end, for the main session and each teammate, and at named events: a
  refusal, a teammate going idle, a compaction, a commit or push (owner, 2026-11-06).
- [decision] Each check is a Markdown file: frontmatter for its triggers, audience, model and what it reads, and a
  body of one or two sentences that is its judging prompt. Precedence is machine-local, then repository, then shipped,
  by file name (owner, 2026-11-06): Haiku judges best on short criteria, and shipping many small checks at once is
  cheap.
- [decision] The repository's checks stay, and a toast once per repository in a run names the shipped checks they
  turn off or replace and the checks they add, counting only those still in force (owner, 2026-11-07): a cloned
  repository can turn off a shipped check or name a costly model, and the toast makes that visible without dropping
  per-project tuning.
- [decision] One judge call per trigger carries every check subscribed to it, with one structured answer per check
  (owner, 2026-11-06): a call per check would multiply cost by the number of checks.
- [decision] Every flag is a board decision offering "Send to the session", "Useful" and "Noise" (owner, 2026-11-06).
- [decision] A nudge is a hidden message worded as an observation with its evidence, never as an order
  (owner, 2026-11-06): the agent can weigh it and say why it disagrees.
- [decision] A finding is raised only above a confidence bar, under a cap per agent per hour, never twice for the
  same thing, and the owner's useful and noise answers are counted per check; a check that keeps scoring noise is
  reported (owner, 2026-11-06).
- [decision] Shared state holds, per session, its repository, branch and a one-line goal, the files it changed, and
  the findings raised (owner, 2026-11-06).
- [decision] The first pull request ships the frame and 15 checks: drift from the goal, a decision the owner should
  have been asked about or told of, a claim of verification without evidence, a problem masked to keep moving,
  agreeing by reflex, a teammate stalled or going in circles, a fact worth recording, a knowledge base note the change
  may have made untrue, building what may already exist, two sessions on the same work, a secret in the transcript, a
  consequential action that was allowed, a request that was dropped, the same correction needed twice, and work
  diverging from its plan (owner, 2026-11-06; merged to 15 on 2026-11-07).
- [decision] A question guessed instead of asked and a decision not told are one check, `unasked-decision`
  (owner, 2026-11-07): both catch the agent settling what the person should decide, and two checks raising the same
  observation post two flags for one event.
- [decision] Not in the first pull request: a teammate brief missing what the teammate needs, and a board answer not
  acted on (later); rules slipping late in a long context (no: sessions are compacted early enough) (owner,
  2026-11-06).
- [decision] A fact worth recording nudges the agent rather than flagging the owner (owner, 2026-11-06): the agent
  is the one that calls the knowledge base writer.
- [decision] Board gains an opt-in, in the same pull request, so a plugin keeps the answers to its own decisions:
  board records the posting plugin, skips delivery to the model, and keeps the pressed option apart from the note
  (owner, 2026-11-06).
- [decision] Board's pane names the posting plugin as the asker of its decision, so the owner sees who asks before
  answering (owner, 2026-11-06).
- [decision] The judge marks repeats: each call is shown the summaries already raised for that agent, per check, and
  says which finding repeats one, with a normalised exact match as a backstop (owner, 2026-11-06): a model rarely words the same observation identically twice.
- [decision] The checks are loaded again before each judgment (lead, 2026-11-06): no `session.start` follows `/clear`, whether
  `$.state` survives a session-id change is unconfirmed, and a new check file then takes effect without a restart.
- [decision] Each trigger keeps its own place in an agent's record (lead, 2026-11-06): with one place per agent, a
  mid-turn commit would leave the turn's end without the turn's prompt.
- [decision] The stalled-teammate check triggers on a teammate going idle only (lead, 2026-11-06): a teammate's turn
  end is its going idle, so both triggers would judge the same items twice.
- [decision] One judge call's record is capped at 40,000 characters, the oldest items dropped first and the latest
  prompt kept, with the cut marked (owner, 2026-11-06): a long turn would otherwise
  put tens of thousands of tokens into one call.
- [decision] The watcher does not judge a session nothing draws (`claude -p`, the SDK) unless a machine-local setting
  turns it on (owner, 2026-11-06): nobody reads a headless run's flags, and judging
  there holds each turn's end for the model call, slowing hook scripts and gates.
- [decision] Findings judged when a teammate goes idle go to its lead, keyed on that trigger rather than on a check's
  name (lead, 2026-11-06): naming a check in code would break "a new check is a prose file".
- [decision] "Send to the session" also counts as Useful for the check (owner, 2026-11-06): sending is the strongest sign a finding helped.
- [decision] The watcher's posted flags live in the session's store entry, so an answer pressed after a restart that
  keeps the session id is still acted on (lead, 2026-11-06): `$.state` does not survive a restart, and board restores
  its decisions.
- [decision] A check that reads `notes` or `plan` is left out of a judgment when there is no such input (lead,
  2026-11-06): the plan ruling, applied to notes the same way and keyed on `reads`.
- [decision] Every captured text is redacted against the secret patterns before it reaches the judge (lead,
  2026-11-06): the judge never needs a secret's value.
- [decision] The judge's answer carries a one-line `goal` while the session's goal is unknown (lead, 2026-11-06): the
  shared entry needs it and no check's answer holds it.
- [decision] When a session's id changes within one process (`/clear`), the watcher carries its store entry over to
  the new id, dropping the goal and the waiting flags (owner, 2026-11-06): otherwise the overlap check reads the
  session's own past as another session, and board empties its decisions on an id change, so those flags cannot be
  answered.
- [decision] The watcher depends on board `>=0.2.0` in the object form, and CI's mod step reads both dependency forms
  (owner, 2026-11-06): an older board ignores the kept-answer opt-in, so the owner's answers would reach the model.
- [decision] The README's two unmeasured claims (an idle main session reads a nudge with the next prompt; a message
  typed mid-turn may be left out of the record) are measured in verification and kept, corrected or dropped by what
  is seen (owner, 2026-11-06).
- [decision] A nudge, a flag's context and what Send to the session passes on carry a short evidence quote fenced as
  record text that is data, not instructions (owner, 2026-11-06): the judge reads untrusted tool output, and a nudge
  reaches the agent as a user-role message.
- [decision] A decision posted with `isAnswerKept` can be reworded or withdrawn only by the plugin that posted it
  (lead, 2026-11-06): otherwise the watched agent could rewrite or remove a flag about its own work.
- [decision] The limits and the headless opt-in are read from `~/.claude/local/watcher/settings.json` at each
  judgment, a missing file giving the defaults (lead, 2026-11-06).
- [decision] The build writes only `plugins/watcher/**`, `plugins/board/**`, `.claude-plugin/marketplace.json`, the
  contract rows in `.claude/code-review-profile.md` and `.claude/reference/**`; nothing under `.github/`, `CLAUDE.md`
  or tool configs (owner, 2026-11-06).
- [decision] The stalled-teammate check nudges the lead, not the teammate; every other check nudges the agent it
  judged (owner, 2026-11-06): a stalled teammate often cannot act on a nudge, and the lead can re-brief or stop it.
- [decision] "Work diverging from its plan" takes as the plan the files named `checklist.md`, `spec.md` or
  `handoff.md` that the session has read, and stays silent when there are none (owner, 2026-11-06).
- [decision] Default limits are strict: a finding needs high confidence, each agent gets at most three nudges and
  three flags an hour, and a finding repeats when the same check gave the same one-line summary for the same agent;
  each limit is a constant a machine-local setting can override (owner, 2026-11-06): untuned checks should err quiet.
- [decision] The knowledge-base-note check reads only notes under `.claude/reference/` whose `sources` list a file
  the turn edited, and the secret check pattern-matches each tool result and calls the judge only on a match, with the
  match redacted (owner, 2026-11-06): each judge call stays small.

## Open questions

- [question] Does `$.state` empty when the session id changes within one process (`/clear`)? Nothing the watcher does
  depends on the answer, since it reloads its checks and moves its entry itself.
- [question] Does `session.append` fire for an in-process teammate's rows? It needs an interactive session to
  measure; without it the stalled-teammate check falls back to the roster and `TeammateIdle`.
- [fact] Yes for tool results: a `session.append` hook on the `tool-result` door fired for an in-process teammate's
  tool-result rows, and it took no interactive session, since `claude -p` hosts such a teammate #measured (Claude Code
  2.1.322, a probe for issue #143; see [[Teammate Mailbox]] and [[Teammate Lifecycle]]). The teammate's other doors
  were not tried. #superseded: the probe's `claude -p` agent was a background subagent with no `teammateId`, not a
  teammate; the next line answers the question from interactive sessions.
- [fact] Yes: in an interactive lead, a `session.append` hook fires for an in-process teammate's rows on the `prompt`,
  `response`, `tool-result`, `note` and `attachment` doors, and it does take an interactive session, since a named
  `Agent` spawn in `claude -p` is a background subagent #measured (Claude Code 2.1.322, three interactive sessions for
  issue #143, a diagnostic hook with no door filter; see [[Teammate Mailbox]] and [[Teammate Lifecycle]])

## Relations

- part_of [[Watcher Plugin]]
