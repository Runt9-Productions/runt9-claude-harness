# Settings fragments

Each `.json` file here is a `settings:<name>` component of `bootstrap.py`, merged into `~/.claude/settings.json` as
the root README's components table describes. Rules that name your own machine, repositories or accounts belong in
your own settings, not here.

| Fragment | What it adds |
|---|---|
| `guardrails-stores` | `permissions.deny` rules for `Read` of common credential stores, private keys and keystores. |
| `guardrails-automode` | Auto-mode `environment`, `allow` and `soft_deny` rules; each rule's label names what it covers. |
| `guardrails-sandbox` | A sandbox configuration, shipped with `enabled: false`. |

The three name credential stores in the form each layer reads, so their lists differ: `Read` deny rules take globs
anywhere on disk, the sandbox takes paths, and the auto-mode classifier reads prose. The
sandbox list leaves out `~/.claude/.credentials.json`, which a nested `claude` reads to log in.

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
`allowedDomains` is refused in every permission mode (`strictAllowlist`). If your sandbox is already on, the merge
adds those three settings to it.

The sandbox wraps shell commands only: Read, Edit, Write and the web tools follow permission rules instead. With it
on, a shell command can write only in the working directories, the temporary directory and any `allowWrite` path,
never under most of `~/.claude`. What that changes:

- `allowedDomains` covers GitHub, npm and PyPI. Add the hosts your own toolchains use, such as a Maven or Gradle
  repository. An allowed host is a way out as well as in: a command can send data to any account there.
- The credential denies hide files that tools read for themselves. With `~/.ssh` denied, git over SSH and SSH commit
  signing fail; with `~/.gnupg` denied, GPG signing fails; npm, Gradle, Docker and kubectl lose their own config.
- Common token variables are unset in sandboxed commands. A variable set inline in the command itself is kept.
- `gh` exits when it cannot read `~/.config/gh/hosts.yml`. Run a call that authenticates with `GH_TOKEN` with
  `GH_CONFIG_DIR` set to an empty directory under `$TMPDIR`, and set `XDG_CACHE_HOME` there too for commands that
  cache, such as `gh run view --log-failed`.
- Worktrees beside the checkout are outside the working directory; add their parent to
  `sandbox.filesystem.allowWrite`. The sandbox keeps a repository's `.git/config` and `.git/hooks` read-only, so
  create a branch without upstream tracking.
- The pre-push gate reviews every push in full, as `harness/githooks/README.md` describes.
