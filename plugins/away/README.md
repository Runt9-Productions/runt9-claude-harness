# away

Tells Claude how present you are, as one of three modes, and has it work accordingly: `present` (at the computer and
reading everything), `distracted` (on another monitor, glancing now and then) or `away` (not at the computer). While
away it keeps the session working through ended turns, permission prompts and a filling context window, and turns the
Bash sandbox on with auto-allow off. There are no settings.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install away@runt9
```

Installing it installs `board` and `handoff` from the same marketplace, since it does not load without them. Install
the `guardrails-sandbox` settings fragment as well, as [The sandbox](#the-sandbox) says.

## Switching

`/mode present`, `/mode distracted` or `/mode away` switches at once, in the middle of a turn too; bare `/mode`
reports the mode. The line above the prompt shows the mode with a button for each of the other two, and the status
line shows the mode while it is not present.

The mode is kept per session id for each session left distracted or away; present is the default and is not kept. A
restart or a resume of a session left that way restores its mode, with a "Restored <mode> mode" toast.
`/clear`, a resume inside the session and moving it to the background carry the mode to the new session id.

## What each mode does

| | Present | Distracted | Away |
|---|---|---|---|
| Replies | normal | one or two lines; detail only when asked | a line at most, or none |
| Questions | a board decision, with the context a reply would give | a board decision | a board decision with a recommended option, proceeded on when it can be undone |
| Stops for | anything | anything, said in the reply's first line | a risk to the security or integrity of the machine or a repository, a change taking hours to unwind, a hard stop you named |
| A turn ending with work left | nothing | nothing | one continuation prompt |
| A permission prompt | normal | normal | refused and posted as a board decision |
| An auto mode denial | nothing | posted as a board decision | posted as a board decision |
| Context past handoff's ceiling | handoff's button | handoff's button | handed off and compacted unattended |
| Switching to present | nothing | nothing | a return report, if away since the last one |
| The Bash sandbox | as your settings set it | as your settings set it | on, with auto-allow off |

The first three rows are what Claude is told; the rest are what the plugin does. In every mode, Claude is told to put
a question to the board rather than to AskUserQuestion.

## What Claude is told

Each switch adds a hidden message to the conversation with the new mode's rules, the rows above that describe
Claude's own conduct. A session that has never switched is told nothing. After a compaction of the main conversation,
the rules are sent again at its next turn or model request, in distracted and away only. They are not a system prompt
section, so a switch does not invalidate the cached conversation.

## While away

- **A turn that ends.** When a main-conversation turn that called a tool ends, a continuation prompt asks Claude to
  carry on with the next step, or to say in one line why it stopped. There is none after an interrupt or a refusal,
  for a turn that called no tool, for the continuation's own turn, while a handoff is under way, or while a teammate
  the main conversation spawned is still running, since its report starts the next turn. A turn ended by an API error
  gets one continuation a minute later. Any switch of mode cancels a continuation not yet sent.
- **A permission prompt.** Every prompt, a teammate's or a subagent's included, is refused, never allowed. It is
  posted as a decision with **Run it** and **Do not run it**, once per agent, tool and input in a session, and the
  refused call's error names the decision, so Claude retries it once you are back and have said to run it. The
  answer to another agent's prompt goes to the main session, which relays it. A prompt for a board tool is refused
  without a post, and one for AskUserQuestion is refused with an error telling Claude to post the question to the
  board instead. Your allow rules therefore decide how much runs while you are away.
- **Context past the ceiling.** At handoff's `ceiling_percent`, Claude is asked to end the turn once its current
  step is done, and when the turn ends `/handoff` runs. Since away ran it, handoff compacts without waiting for you
  and resumes the work. Not again until the fill has dropped below the ceiling.

While distracted or away, an auto mode denial is posted as a decision with **Retry it** and **Drop it**, once per
agent, tool and denial category in a session. Answering does not let the call through: only a permission rule that
allows it does.

## Coming back

Switching to present after being away, directly or by way of distracted, sends a `[return]` prompt: Claude reads the
board and reports what waits on you, what was done, and what stalled, failed or died. A restart while distracted
forgets that a report is owed.

## The sandbox

Switching to away writes `sandbox.enabled: true` and `sandbox.autoAllowBashIfSandboxed: false` into the session
root's `.claude/settings.local.json`, keeping every other key, and Claude Code applies them to the running session.
With auto-allow off, a sandboxed command still needs an allow rule, so any Bash call no allow rule covers prompts,
and while away that prompt is refused and posted. A file that does not hold a JSON object, or whose `sandbox` is not
one, is left alone, with a toast saying the sandbox is off.

The session root's file applies in a worktree and in a session started in a subdirectory too, but three sources win
over it: the repository root's local file (the main checkout's, for a worktree), `--settings`, and managed settings.
When going away finds one of them setting `enabled` to `false` or `autoAllowBashIfSandboxed` to `true`, a toast says
so, since the sandbox would otherwise stay off, or sandboxed Bash run without a prompt, unannounced. Away changes none
of them.

Sessions in one checkout share the session root's file, so away records which of them hold the sandbox on. When the
last of them leaves away, for either mode, both keys are put back as the file had them: each value as it was, or the
key removed where there was none, with a `sandbox` object left empty. A file away created and left holding `{}` is
deleted, or kept holding `{}` where `rm` cannot run. A session that moves to another root while away, by `/cd` or a
worktree move, moves its hold there at its next model request; a command in the same response as the move runs
before that.

A session that ends while away leaves the sandbox on, and the next session started present in that checkout says so
in a toast. `/mode present` typed while already present puts back the values recorded for the session's root,
whoever holds it.

An away session does not check its hold or the file again until it restarts. Two things therefore leave it
unsandboxed for the rest of its time away:

- a `/mode present` typed while present in another session in the same checkout, as above;
- an Edit or Write to the session root's local settings file, which the sandbox does not cover (see
  [What it does not cover](#what-it-does-not-cover)).

### What it needs

Only `enabled` and `autoAllowBashIfSandboxed` are set locally; the rest of the sandbox configuration comes from your
user settings, since a local key overrides only that key. With no configuration there, `enabled: true` turns on Claude
Code's default sandbox: commands can read credential files, one that fails in the sandbox can be retried outside it,
and a host outside the allowlist, which starts empty, is left to the permission mode. The `guardrails-sandbox`
fragment closes these with credential denies, `allowUnsandboxedCommands: false` and a strict allowlist. Install it
from a clone of this repository with `python3 bootstrap.py harness settings:guardrails-sandbox`, as the root README
describes; it ships with `enabled: false`, so the sandbox stays off until away turns it on. Since auto-allow is off
while away, a Bash command runs unattended only where an allow rule covers it, sandboxed or not. Away does not check
that the sandbox can run on the machine; check that once with `/sandbox` while present, since it writes its choice
into the same local file.

### What it does not cover

The sandbox wraps shell commands only. A sandboxed command cannot write under `~/.claude`, but the Edit and Write
tools are not sandboxed. Under `~/.claude` they are Claude Code
[protected paths](https://code.claude.com/docs/en/permission-modes#protected-paths), whose handling depends on the
permission mode:

| Permission mode | Edit or Write under `~/.claude` while away |
|---|---|
| `default`, `acceptEdits` | prompted, so refused and posted as a decision |
| `auto` | judged by the auto mode classifier, which may allow it |
| `dontAsk` | denied |
| `bypassPermissions` | allowed |
| `plan` | allowed in a terminal session where bypass permissions is available; otherwise judged by the classifier where auto mode is available, and prompted where it is not |

A few paths under `~/.claude` are not protected, such as auto memory's Markdown files and the session's own plan
files, and follow the ordinary permission rules. Away adds no guard of its own for any of these.

## What it relies on

On `board`: the tool names `mcp__board__ask_decision`, `set_task` and `read_board`; a new decision's result starting
with `Posted D<n>`; a decision away posts having no asking agent, so its answer goes to the main session; a new
decision flashing on the pane, the only alert while distracted; `read_board` listing the decisions and the tasks
waiting on you, for the return report; and the `$.agent.list()` statuses of an agent that has ended, of which away
keeps a copy.

On `handoff`: a `/handoff` that away runs being unattended; the state keys `phase` and `ceilingPercent`; and how it
measures the context fill, of which away keeps a copy.
