# Settings fragments

Each file here is a `settings:<name>` component of `bootstrap.py`, merged into `~/.claude/settings.json`: a list gains
the entries it lacks, an object gains the keys it lacks, and a value already set is never replaced. Rules that name
your own machine, repositories or accounts belong in your own settings, not here.

| Fragment | What it adds |
|---|---|
| `guardrails-stores` | `permissions.deny` rules for `Read` of common credential stores, private keys and keystores. |
| `guardrails-automode` | Auto-mode rules: scratch locations, `claude/**` agent branches and credential stores described for the classifier; allow rules for proving tests by breaking code, reading the auto-mode rules, keeping an agent's own pull request up to date, agent definitions as project code and measuring Claude Code in a scratch repository; soft-deny rules against skipping git hooks and reading credential stores. |
| `guardrails-sandbox` | A sandbox configuration, shipped with `enabled: false`: network limited to GitHub, npm and PyPI, and the credential stores unreadable from the shell. Turn it on with `enabled` in your own settings, or have a tool switch it. |

## Auto mode

Every list starts with `"$defaults"`, so the built-in rules stay and these add to them. Auto mode reads rules only
from user, managed and `--settings` scope, which is why the fragment goes into `~/.claude/settings.json`. A list from
which you removed `"$defaults"` on purpose gets it back from the merge; take it out again by hand.
`claude auto-mode config` prints the rules in effect, and `claude auto-mode critique` reviews your own.

## Sandbox

The sandbox wraps shell commands only: Read, Edit, Write and the web tools follow permission rules instead. With it
on, a shell command can write only in the working directories, the temporary directory and any `allowWrite` path,
never under most of `~/.claude`, and reaches only the allowed hosts. What that changes:

- `gh` exits when it cannot read `~/.config/gh/hosts.yml`. A call that authenticates with `GH_TOKEN` runs with
  `GH_CONFIG_DIR` pointed at an empty directory under `$TMPDIR`, and `XDG_CACHE_HOME` there too for commands that
  cache, such as `gh run view --log-failed`.
- Worktrees beside the checkout are outside the working directory; add their parent to
  `sandbox.filesystem.allowWrite`. The sandbox keeps a repository's `.git/config` and `.git/hooks` read-only, so
  create a branch without upstream tracking.
- The pre-push gate cannot write its state beside the installed harness, so it reviews every push in full.
