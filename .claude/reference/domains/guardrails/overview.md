---
title: Guardrails
type: note
permalink: guardrails/overview
tags: [guardrails, auto-mode, sandbox, permissions, hooks, credentials, installs]
verified: 2026-10-31
coverage: partial
measured_on: "Claude Code 2.1.314 and 2.1.316, Linux bubblewrap 0.9.0"
sources:
  - "harness/settings/guardrails-automode.json"
  - "harness/settings/guardrails-sandbox.json"
  - "harness/settings/guardrails-stores.json"
  - "bootstrap.py"
---

# Guardrails

> **Scope.** How the layers that hold an agent back behave: permission deny rules, the auto-mode classifier, the Bash
> sandbox and model-evaluated hooks, as far as the harness's settings fragments rely on them. The `#measured` lines
> come from headless `claude -p` runs on 2.1.314 in scratch repositories with synthetic files, with the sandbox on and
> its network closed so nothing could install, one to three runs per case (2026-10-29 to 2026-10-31); the earlier
> ones were not re-run when this note was written. The line on `sandbox.enabled` in the local settings was measured on
> 2.1.316, with the file changed from outside the session between commands, and how soon a change applies below 5 s
> was not measured. The three lines after it, on which local file applies outside a repository-root start and on
> `autoAllowBashIfSandboxed`, were measured on 2.1.316 in `claude -p` sessions in scratch repositories, worktrees and
> subdirectories, one or two sessions per case, with no sandbox key in user or project settings. On 2026-10-31 the note
> was re-checked against the auto-mode fragment's added `allow` entry (marking a pull request the session opened ready
> for review): no claim rests on which entries that list holds, and every other claim was carried forward without a
> re-check. Not covered: macOS
> and Windows sandboxing, the Read tool's path through auto mode (only the documentation's account), pushes over HTTPS
> from inside the sandbox, and any JVM build run end to end in the sandbox.

Read this before writing an auto-mode rule, a permission deny rule or a sandbox setting, or relying on one of them to
stop a call.

## Observations

### Auto mode

- [vendor] `hard_deny` blocks unconditionally; `soft_deny` blocks unless an `allow` entry or the user's specific
  request clears it; `allow` holds exceptions to `soft_deny`; `environment` says what counts as trusted. Entries are
  prose read by the classifier, not patterns.
- [vendor] `autoMode` is read from user settings, managed settings and `--settings`, never from a project's
  `.claude/settings.json` or `.claude/settings.local.json`.
- [trap] Scopes combine, so a list without `"$defaults"` replaces the defaults only if no other scope keeps
  `"$defaults"` in the same list. One that does brings every default back. #measured #silent-failure
- [fact] A soft_deny entry that says it "takes precedence over" a built-in allow wins over it: with Machine Software
  Changes saying so, an unrequested rustup install in a repository with a `Cargo.toml` was denied 3 of 3 times; with
  the sentence removed it ran 3 of 3 times, as it did with the defaults alone. The documentation's order (allow over
  soft_deny) holds only where nothing says otherwise. #measured
- [fact] A read-only shell command inside the project reaches the classifier: `cat .env` that the user had not asked
  for was denied 2 of 2 times under Credential Store Reads, and ran when the user's message asked for the key. #measured
- [vendor] The classifier reads the user's messages and the commands the agent runs, not their output, so a rule that
  depends on a tool result (what `git diff` showed, a hook's refusal text) cannot be applied as written.
- [vendor] The Read tool inside the working directories and narrow `Bash(...)` allow rules are approved before the
  classifier is asked, so a permission deny rule is what stops the Read tool.
- [fact] When the classifier blocks without naming a rule, the agent sees "The server-side auto mode classifier judged
  this action dangerous (it gave no explanation)". #measured
- [fact] 2.1.314 ships 21 environment, 17 allow, 72 soft_deny and 1 hard_deny default rules
  (`claude auto-mode defaults`). #measured
- [fact] `claude auto-mode critique` prints at most about 4,000 characters, and it proposes wording without checking
  it against the documented order; run it on a few rules at a time and measure what it suggests. #measured
- [trap] `bootstrap.py` merges list entries by exact text and never removes one, so a reworded rule leaves its older
  text in the user's settings, where it still applies. #silent-failure

### Permission deny rules

- [trap] An absolute path in a `Read(...)` rule needs `//`: `Read(/abs/dir/**)` resolves against the settings file's
  directory and silently does not apply, while `Read(//abs/dir/**)` denies. Sandbox paths use a single `/`.
  #measured #silent-failure
- [vendor] A `Read(...)` deny rule also blocks Edit and Write on the same path (creating a file there included), the
  file commands Claude Code recognizes in Bash (`cat`, `head`, `tail`, `sed`, `tee`) and redirection targets, but not
  a command that reads without naming the file (`grep -r`) or a script that opens it itself. Its paths are merged into
  the sandbox's `denyRead`, which covers every sandboxed process.
- [vendor] A `!` rule carves paths out only of the cwd-relative (`path`, `./path`) rules listed before it in the same
  file, so a rule anchored with `//` or `~/` cannot be narrowed.

### Model-evaluated hooks

- [trap] A `type: "prompt"` hook on `PreToolUse` fails open: with an unknown model, and again with a 1 s timeout, the
  command ran. One run per case. `onFailure: "block"` exists only for command and HTTP hooks. #measured #silent-failure
- [fact] A prompt hook sees the tool input and not the conversation, so it cannot tell whether the user asked for the
  call. #measured

### The Bash sandbox

- [fact] A sandboxed command cannot write under `~/.claude`, and `filesystem.allowWrite` there does not open it, so
  any shell step that writes harness state fails with `Read-only file system`. The Edit and Write tools are not
  sandboxed. #measured
- [fact] Turning `sandbox.enabled` off in a settings file took effect in the running session. #measured
- [fact] `sandbox.enabled` in `.claude/settings.local.json` takes effect in a running session both ways. With the
  rest of the sandbox config and `enabled: false` in the project's `.claude/settings.json`, a Bash command started 5 s
  after the local file gained `enabled: true` ran sandboxed, and one started after the key was removed or set to
  `false` ran unsandboxed, 2 of 2 runs. The local key overrode only that key: the rest of the config still applied.
  #measured
- [fact] A session started in a linked worktree or a repository subdirectory applies `sandbox.enabled` from both
  local files: the starting directory's `.claude/settings.local.json`, read at start and also when created
  mid-session, and the repository root's (the main checkout's, for a worktree). Each turned the sandbox on
  mid-session; only the main checkout's file was also measured turning it off again. #measured
- [trap] The repository root's local file wins over the starting directory's on a key both set: with the root file
  holding `enabled: false`, `enabled: true` written in a worktree's or subdirectory's file left commands
  unsandboxed. Only that direction was measured. In a worktree the root file is the main checkout's, shared with
  every session started there. #measured #silent-failure
- [trap] With the sandbox on and `autoAllowBashIfSandboxed` absent, a command that matches no allow rule runs
  sandboxed without approval; `autoAllowBashIfSandboxed: false` makes it need approval (denied under `-p`). So turning
  the sandbox on with the key unset also stops Bash from prompting. #measured
- [trap] The per-user temp directory (`$TMPDIR`, `/tmp/claude-<uid>`) is writable as a whole, which takes in every
  other session's scratchpad. The rest of `/tmp` is read-only. #measured
- [trap] The working directory's `.git/hooks` and `.git/config` are mounted read-only, but a directory added with
  `--add-dir`, `additionalDirectories` or `allowWrite` gets no such binds. A sandboxed command can plant a hook there
  that later runs unsandboxed. #measured
- [trap] `.git/config` is read-only in the working directory, so `git worktree add -b` creates the branch, fails
  writing its upstream and leaves no worktree. Create the branch with `--no-track`. #measured
- [fact] Network goes only through a local proxy whose `HTTPS_PROXY` carries per-command credentials. A child run
  under `env -i` loses it and hangs, and the JVM ignores it. #measured
- [fact] With `strictAllowlist`, a command's `allowed_domains` cannot widen the list: the call is refused with
  "allowed_domains cannot widen network access in this session", and the host is denied. #measured
- [fact] A `credentials.envVars` deny unsets the variable the command inherits, but one assigned inline in the command
  (`VAR=x cmd`) is kept. #measured
- [fact] `excludedCommands` runs a fully matching command unsandboxed, with no proxy variables, and the
  working-directory path check then applies to it; a chain that only partly matches stays sandboxed. #measured
- [trap] With `allowUnsandboxedCommands: false`, `dangerouslyDisableSandbox` is ignored with no notice: the retry runs
  sandboxed and fails the same way. #measured #silent-failure
- [fact] A filesystem block shows only the program's own error (`Read-only file system`), and a path under a
  `credentials` deny shows `No such file or directory`. Only a network block adds a `<sandbox_violations>` line naming
  the host. #measured
- [vendor] The sandbox fails open: if it cannot start, commands run unsandboxed, unless `failIfUnavailable` is true.

### Decisions

- [decision] Credentials and installs are guarded by auto-mode rules, permission deny rules and the sandbox, tuned
  from the false positives they raise; a separate model judge is not used, because it covered the same calls for
  sessions in auto mode. (owner, 2026-10-30)
- [decision] The sandbox ships off: attended work cannot live with a shell that never writes under `~/.claude`.
  (owner, 2026-10-30)

## Relations

- see_also [[Plugin Platform]]
