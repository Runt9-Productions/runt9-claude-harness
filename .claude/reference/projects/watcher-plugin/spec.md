---
title: Watcher Plugin Spec
type: note
permalink: projects/watcher-plugin/spec
tags:
- watcher
- mods
- board
- model-judge
---

# Watcher Plugin Spec

The per-file map for issue #35, the check format, and the issue text reconciled with [[Watcher Plugin Decisions]].

## How it works

- **Capture.** `tool.call` (after `next`) records each call's input, its result or error text and, from the
  `tool.check` verdict seen for the same call, the refusal's kind (a rule, a settings hook, or an ask the mode or the
  classifier refused). `session.append` records the person's prompts and the agent's replies, keyed by `agentId`
  (absent for the main session). `turn.complete`, `classic.TeammateIdle`, `classic.PermissionDenied`, compaction rows
  and Bash calls running `git commit` or `git push` raise triggers. Each agent has a bounded buffer, and each trigger
  keeps its own place in it, so a judgment sees what came after that trigger's last one.
- **Judge.** At a trigger, the checks subscribed to it and to that kind of agent are sent in one `$.model.complete`
  call on the checks' model (Haiku unless a check says otherwise; checks with different models split into one call
  per model). The prompt is the shipped `judge.md`, then each check's name and body, then one digest holding only what
  the union of those checks `reads`, each item cut to a fixed size. The answer is JSON: one entry per check with
  `raised`, `confidence`, a one-line `summary` and `evidence` quoting the digest. An unparseable answer is logged and
  dropped, never retried in a loop.
- **Quiet.** An entry is a finding only when `raised` is true and `confidence` meets the bar. A finding is dropped
  when the judge, shown the summaries already raised for that check and agent, marks it a repeat of one, when its
  normalised summary matches one of them, or when the agent's hourly cap for that
  audience is spent.
- **Deliver.** A nudge is a hidden user row (`$.session.append`, with the judged agent's `agentId`, or the lead's for
  a finding judged when a teammate went idle) that names the check and gives the observation and its evidence. A flag is a board
  decision posted through `$.tool.call` with the kept-answer field, options "Send to the session", "Useful" and
  "Noise". The watcher hooks `state.set` on board's `decisions` and acts on answers to its own decisions: "Send to the
  session" submits the finding as a prompt when the main session is idle and appends it as a hidden row otherwise, and
  counts as Useful; "Useful" and "Noise" add to the check's counts. A check whose noise count passes its useful count by a margin is reported once as a toast.
- **Shared state.** Each session keeps one `$.store` key, `session:<id>`, holding its repository, branch, a one-line
  goal (from the first judgment's summary of the person's request), the files it changed and its findings. The overlap
  check reads the other sessions' keys, skipping those not updated within a day.

## Check format

```markdown
---
triggers: [turn-end, commit]
audience: both          # nudge | flag | both
agents: all             # main | teammates | all
reads: [prompts, calls, replies, results]
model: haiku
---
One or two sentences saying what to look for and what counts as raising it.
```

- `reads` values: `prompts` (the person's messages), `replies`, `calls` (tool name and input), `results` (result or
  error text, cut short), `exits` (exit codes and error flags only), `status` (the agent roster), `shared` (other
  sessions' entries), `notes` (knowledge base notes whose `sources` list a file the turn edited), `plan` (plan files the
  session read).
- Triggers: `turn-end`, `refusal`, `teammate-idle`, `compaction`, `commit`, `secret-match`.
- The file name without `.md` is the check's name. A file in `~/.claude/local/watcher/checks/` replaces a repository
  or shipped check of the same name, and one in the repository's `.claude/watcher/checks/` replaces a shipped one. A
  file whose body is empty disables the check of that name.

## Per-file map

| File | Change |
|---|---|
| `plugins/board/hooks/register.tsx` | `ask_decision` handler takes `next` and passes `next.origin.plugin` when it is not `engine` |
| `plugins/board/hooks/tools.ts` | optional kept-answer field on the decision input, not in the model-facing schema |
| `plugins/board/hooks/decisions.ts` | record the posting plugin; for a kept answer skip `deliver`, mark it seen, toast plainly; keep the pressed option apart from the note |
| `plugins/board/hooks/pane.tsx` | name the posting plugin as a decision's asker |
| `plugins/board/types/index.d.ts` | `BoardDecision.plugin` and the pressed option |
| `plugins/board/hooks/test-support.ts`, `decisions.test.ts` | a probe plugin that posts and watches `state.set`; a kept answer reaches it and not the model |
| `plugins/board/README.md`, `.claude-plugin/plugin.json` | a section for other plugins (the field, the `state.set` route, the answer's forms); version rise |
| `plugins/watcher/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | the new plugin, depending on `board` |
| `plugins/watcher/hooks/hooks.json`, `register.tsx` | hook registration only |
| `plugins/watcher/hooks/checks.ts` | load and merge the three check locations, check frontmatter |
| `plugins/watcher/hooks/capture.ts` | per-agent buffers from the hooks above |
| `plugins/watcher/hooks/digest.ts` | build one digest from a buffer for a set of `reads` |
| `plugins/watcher/hooks/judge.ts` | batch, call the model, parse the answer |
| `plugins/watcher/hooks/quiet.ts` | bar, dedupe, caps, useful and noise counts |
| `plugins/watcher/hooks/deliver.ts` | nudges, board flags, kept answers, Send to the session |
| `plugins/watcher/hooks/shared.ts` | the per-session store key and other sessions' entries |
| `plugins/watcher/hooks/inputs.ts` | the `notes` and `plan` reads and the secret pattern match |
| `plugins/watcher/hooks/*.test.ts` | kit tests per module, the model stubbed |
| `plugins/watcher/judge.md`, `plugins/watcher/checks/*.md` | the judge prompt and the 16 checks |
| `plugins/watcher/types/index.d.ts` | the watcher's state keys |
| `plugins/watcher/local.example/checks/example.md` | a synthetic sample check |
| `plugins/watcher/README.md` | what it watches, the check format, precedence, cost, what it does not do |
| `.claude/code-review-profile.md` | contract rows: the watcher on board, board's new field |
| `.claude/reference/domains/plugins/overview.md` | refusal kinds as a mod sees them, observer agents, concurrent store writes |

## Draft issue text

Title: Add a watcher that keeps an eye on each session, nudging the agent and flagging to the user

## Objective

A user running long or unattended sessions cannot read every transcript, so work that drifts from the request, a
decision the user should have been told about, a claim made without checking, or a teammate going in circles goes
unnoticed until it costs something. A watcher in each session has a model read what the session does, nudge the agent
when the work goes off track, and flag to the user what they should know. It is a frame that later checks extend, so
a new concern is a short prose file rather than new code.

## Technical details

- A mod in every session captures tool calls, results, refusals, prompts, replies and the agent roster, and at each
  turn's end and a few named events sends the checks subscribed to that moment to Haiku in one call, through the
  session's own credentials.
- Each check is a Markdown file: frontmatter for its triggers, audience (nudge, flag or both), the agents it applies
  to, what it reads and its model, and one or two sentences of criteria. Checks ship with the plugin, may be added per
  repository and added or replaced per machine.
- A nudge is a hidden message to the agent, worded as an observation with evidence. A flag is a board decision
  offering "Send to the session", "Useful" and "Noise"; the answer stays with the watcher, so board gains an opt-in
  for a plugin to keep the answers to its own decisions.
- A confidence bar, a cap per agent per hour and deduplication keep it quiet; useful and noise answers are counted
  per check.
- Sessions share state on the machine (repository, branch, goal, files changed, findings) under per-session keys.
- The first checks: drift from the goal, a decision the user should know about, a question guessed instead of asked,
  a claim of verification without evidence, a problem masked to keep moving, agreeing by reflex, a teammate stalled
  or going in circles, a fact worth recording, a knowledge base note a change may have made untrue, building what may
  already exist, two sessions on the same work, a secret in the transcript, a consequential action that was allowed,
  a request that was dropped, the same correction needed twice, and work diverging from its plan.

## Out of scope

- Blocking or rewriting calls; that stays with hooks and auto mode.
- Security checks the auto-mode classifier already makes.
- Sending anything anywhere except the model calls the session's own credentials make.
- Desktop notifications.

## Acceptance criteria

- A session that drifts from its request, or claims a result it did not check, gets a nudge the agent reads, without
  the user reading the transcript.
- A decision the user should know about reaches them as a board decision, and their "Useful" or "Noise" answer is
  recorded by the watcher without reaching the model.
- A new check added as a file, per machine or per repository, takes effect with no code change.

## Relations

- part_of [[Watcher Plugin]]
