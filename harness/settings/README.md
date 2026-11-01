# Settings fragments

Each `.json` file here is a `settings:<name>` component of `bootstrap.py`, merged into `~/.claude/settings.json` as
the root README's components table describes. Rules that name your own machine, repositories or accounts belong in
your own settings, not here.

| Fragment | What it adds |
|---|---|
| `guardrails-stores` | `permissions.deny` rules for `Read` of common credential stores, private keys and keystores. |
| `guardrails-automode` | Auto-mode `environment`, `allow` and `soft_deny` rules; each rule's label names what it covers. |
| `guardrails-sandbox` | A sandbox configuration, shipped with `enabled: false`. |
| `guardrails-remote` | `permissions.deny` rules for `ssh`, `scp`, `sftp`, `slogin`, `autossh`, `sshpass` and `ssh-copy-id`. A deny rule outranks the auto-mode rule that allows a host the user named, so remove these by hand before a task that needs one. |
| `preferences` | Agent teams on (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, which the `delegation` and `teammate-delivery` plugins need) and fork mode off (`CLAUDE_CODE_FORK_SUBAGENT=0`, so Claude can wait for a subagent); automatic compaction off, for the `handoff` plugin to compact instead; transcripts kept 365 days; thinking summaries shown; no reply after a `!` command; Remote Control not connected at startup. |

The three name credential stores in the form each layer reads, so their lists differ: `Read` deny rules take globs
anywhere on disk, the sandbox takes paths, and the auto-mode classifier reads prose. The
sandbox list leaves out `~/.claude/.credentials.json`, which a nested `claude` reads to log in.

A `Read` deny rule refuses more than the Read tool: Edit and Write on the same path, file commands such as `cat` and
`sed`, and, since its paths are merged into the sandbox's `denyRead`, every sandboxed command (on macOS, globs
included). So the rules name stores by name, not by extension: a `.pem` glob would hide CA bundles from sandboxed
commands, and `.env.*` would block editing a `.env.example`. Of the `.env` variants only `.env` and the `*.local`
files, which frameworks keep out of git for secrets, are denied. `.npmrc` and `gradle.properties` are denied only in
the home directory, since a project keeps its own as plain configuration. Keys and certificates elsewhere are left to
the auto-mode rule, which judges a file by its purpose. A deny rule cannot be carved back out by an allow rule, and installing
`settings:guardrails-stores` again re-adds one you removed by hand.

## Auto mode

Every list starts with `"$defaults"`, so the built-in rules stay and these add to them. Auto mode reads rules only
from user, managed and `--settings` scope, which is why the fragment goes into `~/.claude/settings.json`. A list from
which you removed `"$defaults"` on purpose gets it back from the merge; take it out again by hand. The merge only
adds, so when a later version rewords a rule, the older text stays beside the new one and still applies: remove it
by hand. `claude auto-mode config` prints the rules in effect, and `claude auto-mode critique` reviews your own.

Where a rule here is stricter than a built-in allow, such as Toolchain Bootstrap, it says that it takes precedence,
and the classifier follows that. Sending code or credentials out needs no rule here: the built-in Data Exfiltration
rule blocks it unconditionally. The classifier judges shell commands, but the Read tool inside the working
directories is approved without it, so the `guardrails-stores` deny rules are what keep that tool out of a store.

## Sandbox

Turn it on with `sandbox.enabled` in your own settings, or have a tool switch that key; the file reloads live. With
`failIfUnavailable`, Claude Code then refuses to start where the sandbox cannot run (on Linux, without bubblewrap).
Sandboxed commands still go through the permission flow (`autoAllowBashIfSandboxed: false`), and a host outside
`allowedDomains` is refused in every permission mode (`strictAllowlist`). The merge adds every key and list entry here
that your own `sandbox` settings lack, whether the sandbox is on or not. That includes `allowUnsandboxedCommands:
false`, under which a command's `dangerouslyDisableSandbox` is ignored without notice, so a command the sandbox breaks
runs outside it only through `excludedCommands`.

The sandbox wraps shell commands only: Read, Edit, Write and the web tools follow permission rules instead. With it
on, a shell command can write only in the working directories, the temporary directory and any `allowWrite` path,
never under most of `~/.claude`. What that changes:

- `allowedDomains` covers GitHub, npm and PyPI. Add the hosts your own toolchains use, such as a Maven or Gradle
  repository. An allowed host is a way out as well as in: a command can send data to any account there.
- The credential denies hide files that tools read for themselves. With `~/.ssh` denied, git over SSH and SSH commit
  signing fail; with `~/.gnupg` denied, GPG signing fails; npm, Gradle, Docker and kubectl lose their own config.
- Common token variables are unset in sandboxed commands. A variable set inline in the command itself is kept.
- `gh` has no token of its own in the sandbox: `GH_TOKEN` is unset and `~/.config/gh/hosts.yml` is denied. Set the
  token inline in the command (`GH_TOKEN=... gh ...`) from a source the sandbox can read, or list `gh` in
  `sandbox.excludedCommands`. A sandboxed `gh` also exits when it cannot read `hosts.yml`, so set `GH_CONFIG_DIR` to
  an empty directory under `$TMPDIR`, and `XDG_CACHE_HOME` there too for commands that cache, such as
  `gh run view --log-failed`.
- Worktrees beside the checkout are outside the working directory; add each worktree's own path to
  `sandbox.filesystem.allowWrite`, never a parent directory. Only the working directory's `.git/config` and
  `.git/hooks` are kept read-only, so a repository under an `allowWrite` path can have a hook planted that later runs
  outside the sandbox. In the working directory, create a branch without upstream tracking.
- The pre-push gate reviews every push in full, as `harness/githooks/README.md` describes.
