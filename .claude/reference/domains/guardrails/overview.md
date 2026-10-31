---
title: Guardrails
type: note
permalink: guardrails/overview
tags: [guardrails, auto-mode, sandbox, hooks, credentials, installs]
verified: 2026-10-30
coverage: partial
measured_on: "Claude Code 2.1.314, claude-haiku-5-5, claude-sonnet-5-5, Linux bubblewrap 0.9.0"
sources:
  - "plugins/guardrails/hooks/judge.ts"
  - "plugins/guardrails/hooks/register.ts"
---

# Guardrails

> **Scope.** The `guardrails` judge mod as read in `judge.ts` and `register.ts`, and the platform behaviour of the
> three layers it sits beside: permission deny rules, the auto-mode classifier and the Bash sandbox. The `#measured`
> lines come from headless `claude -p` trials on 2.1.314 run while building the mod (2026-10-29 and 2026-10-30), with
> synthetic files and scratch repositories, and were not re-run when this note was written. Not covered: macOS and
> Windows sandboxing, the classifier's behaviour on a custom `soft_deny` (only its effective config was measured),
> pushes over HTTPS from inside the sandbox, and Gradle or any JVM build run end to end in the sandbox.

Read this before changing the judge's prefilter or rules, writing an auto-mode rule or a sandbox setting, or relying on
any of the four layers to stop a call.

## Observations

### The judge mod

- [fact] Only calls that `isCandidate` (`judge.ts:84`) matches reach the model; every other call runs untouched. It
  reads the fields in `SCANNED_FIELDS` (`judge.ts:54`) for `Bash`, `Monitor`, `Read`, `Grep` and `Glob`, and no other
  tool.
- [fact] The prefilter reads each field twice, as written and with quotes and backslashes removed (`SHELL_QUOTING`,
  `judge.ts:70`), so `.pg''pass` matches.
- [fact] The install patterns (`MANAGER_VERB`, `INSTALL_HINTS`) apply to the shell tools only; `Read`, `Grep` and
  `Glob` are checked for credential hints alone (`isCandidate`, `judge.ts:88`).
- [trap] A name built at run time with no literal fragment (decoded, read from a file, assembled from variables) never
  matches the prefilter, so the judge never sees the call. The permission deny rules and the sandbox are what cover it.
  #silent-failure
- [fact] Approval comes only from prompts whose origin is `composer`, `bridge` or `sdk` and that are not `isMeta`
  (`OWNER_ORIGINS`, `register.ts:12`). Teammate messages, plugin text and notifications never count, and a delegated
  agent's call is judged against the user's prompts.
- [fact] The last `OWNER_MESSAGES_KEPT` (8) prompts are kept, each clipped to 4000 characters from both ends, with the
  last 1500 characters of the agent message it answered as `replyingTo` (`judge.ts:15`, `clipped`, `lastPart`).
- [invariant] The call and the prompts go to the model as one JSON value with every `<` escaped (`payload`,
  `judge.ts:129`). Text in a command or a prompt that could pass for the instructions would otherwise be read as them.
- [invariant] Any `Verdict: DENY` line anywhere in the reply denies (`verdictOf`, `judge.ts:156`), so a reply that
  corrects itself cannot end in an allow.
- [fact] The judge fails closed: an API error, the 20 s timeout (`judgeRequest`, `judge.ts:144`), a reply with no
  verdict line and a throwing hook (`.catch`, `register.ts:65`) all deny.
- [fact] Calls another plugin makes through its own `$.tool.call` are not judged (`next.origin.plugin`,
  `register.ts:45`).
- [trap] The stored prompts outlive a reload, so the atom's `shape` tag (`register.ts:9`) must change whenever an
  entry's shape does. An old entry is then declined instead of read in the wrong shape. #silent-failure
- [risk] Approval given in a question dialog or a permission prompt never reaches the judge, and approval is reported
  lost after `/clear`, a resume or a new `claude -p` process. Both fail safe (the install is refused). Reported by the
  trial, not re-measured.
- [fact] Haiku judged 183 of 183 calls correctly (61 scenarios, 3 runs each) and Sonnet 61 of 61 (1 run), with the
  reply asked for as a `Reason:` line and then a `Verdict:` line. The same scenarios built each request with the mod's
  own `judgedCall` and `judgeRequest`; nothing ran. #measured
- [trap] Asking for the verdict before the reason scored 179 of 183: the model wrote the label first and then argued
  against it. Reason first, verdict last, fixed every case. #measured
- [fact] A judged call took p50 1.65 s, p90 2.45 s and at most 4.0 s on Haiku, and 2.0 to 2.7 s as a live hook. A
  call the prefilter passes adds 18 to 38 ms. #measured
- [fact] At list price a judged call costs about $0.0001 on Haiku and $0.0014 on Sonnet: about 150 uncached input
  tokens, 1,550 cache-read tokens (the rules, cached after the first call) and 80 to 135 output tokens. #measured
- [fact] Replaying recorded transcripts through `isCandidate` sent 1,518 of 14,583 calls (10.4%) to the judge, across
  three checkouts of two projects; the per-session median was 0 to 2%. #measured

### Permission deny rules

- [trap] An absolute path in a `Read(...)` rule needs `//`: `Read(/abs/dir/**)` resolves against the settings file's
  directory and silently does not apply, while `Read(//abs/dir/**)` denies. Sandbox paths use a single `/`.
  #measured #silent-failure
- [vendor] A `Read(...)` deny rule covers the Read tool, not a shell command reading the same file; interpreters and
  recursive grep get past deny rules alone. The sandbox's `credentials` deny is what covers the shell side.

### Model-evaluated hooks

- [trap] A `type: "prompt"` hook on `PreToolUse` fails open: with an unknown model, and again with a 1 s timeout, the
  command ran. One run per case. `onFailure: "block"` exists only for command and HTTP hooks. #measured #silent-failure
- [fact] A prompt hook sees the tool input and not the conversation, so it cannot tell whether the user asked for the
  call. This is why the judge is a mod. #measured

### Auto mode

- [vendor] `hard_deny` blocks unconditionally; `soft_deny` blocks unless an `allow` entry or the user's specific
  request clears it; `allow` holds exceptions to `soft_deny`; `environment` says what counts as trusted. Entries are
  prose read by the classifier, not patterns.
- [vendor] `autoMode` is read from user settings, managed settings and `--settings`, never from a project's
  `.claude/settings.json` or `.claude/settings.local.json`.
- [trap] Scopes combine, so a list without `"$defaults"` replaces the defaults only if no other scope keeps
  `"$defaults"` in the same list. One that does brings every default back. #measured #silent-failure
- [fact] 2.1.314 ships 21 environment, 17 allow, 72 soft_deny and 1 hard_deny default rules
  (`claude auto-mode defaults`). #measured
- [fact] `claude auto-mode critique` reviews custom rules, and its printed output stops at about 4,000 characters. Run
  it on a few rules at a time. #measured
- [fact] A Bash call with an environment-variable prefix inside a pipeline (`VAR=x cmd | tail`) is held as several
  operations, so a command of that shape needs approval every time. #measured
- [vendor] A narrow `Bash(...)` allow rule is resolved before the classifier, unless `classifyAllShell` is true.

### The Bash sandbox

- [fact] A sandboxed command cannot write under `~/.claude`, and `filesystem.allowWrite` there does not open it, so
  any shell step that writes harness state fails with `Read-only file system`. The Edit and Write tools are not
  sandboxed. #measured
- [trap] The per-user temp directory (`$TMPDIR`, `/tmp/claude-<uid>`) is writable as a whole, which takes in every
  other session's scratchpad. The rest of `/tmp` is read-only. #measured
- [trap] The working directory's `.git/hooks` and `.git/config` are mounted read-only, but a directory added with
  `--add-dir`, `additionalDirectories` or `allowWrite` gets no such binds. A sandboxed command can plant a hook there
  that later runs unsandboxed. #measured
- [trap] `.git/config` is read-only in the working directory, so `git worktree add -b` creates the branch, fails
  writing its upstream and leaves no worktree. Create the branch with `--no-track`. #measured
- [fact] Network goes only through a local proxy whose `HTTPS_PROXY` carries per-command credentials. A child run
  under `env -i` loses it and hangs, and the JVM ignores it. #measured
- [fact] `excludedCommands` runs a fully matching command unsandboxed, with no proxy variables, and the
  working-directory path check then applies to it; a chain that only partly matches stays sandboxed. #measured
- [trap] With `allowUnsandboxedCommands: false`, `dangerouslyDisableSandbox` is ignored with no notice: the retry runs
  sandboxed and fails the same way. #measured #silent-failure
- [fact] A filesystem block shows only the program's own error (`Read-only file system`), and a path under a
  `credentials` deny shows `No such file or directory`. Only a network block adds a `<sandbox_violations>` line naming
  the host. #measured
- [vendor] The sandbox fails open: if it cannot start, commands run unsandboxed, unless `failIfUnavailable` is true.

### Decisions

- [decision] Credentials and installs are guarded by permission deny rules plus the judge mod, with no hook that
  parses commands. A model judges what a call does, which a pattern over its text cannot. (owner, 2026-10-30)
- [decision] The judge defaults to Haiku and the model is a plugin setting: it scored as well as Sonnet at about a
  tenth of the cost. (owner, 2026-10-30)
- [decision] The sandbox ships off: attended work cannot live with a shell that never writes under `~/.claude`.
  (owner, 2026-10-30)

## Relations

- see_also [[Plugin Platform]]
