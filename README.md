# runt9-claude-harness

Opt-in plugins and harness pieces for Claude Code, still being migrated in.

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install <name>@runt9
```

Updates are manual: run `claude plugin update <name>@runt9` when you want one.

## Harness parts

The parts that cannot be plugins, such as the git hooks and the style-guide skills, are installed from a clone with `bootstrap.py`, which can
install the plugins too. Run it in your own shell, not in a Claude Code session, since an agent must not be the one
writing the install. It needs Python 3.12 and git, and `claude` for plugin components; the hooks need what
[their README](harness/githooks/README.md) lists.

```
git clone https://github.com/Runt9-Productions/runt9-claude-harness.git
cd runt9-claude-harness
python3 bootstrap.py --list
python3 bootstrap.py harness hooks-path skills --repo <path>
```

With no component named it asks about each one. The components, in install order:

| Component | Installs |
|---|---|
| `harness` | `harness/` as it is in the commit checked out (never the working tree), into `~/.claude/harness/versions/<version>/` with that commit's hash in `SOURCE_COMMIT`, then points the `~/.claude/harness/current` link at it and removes every other version. The version is `harness/harness.json`'s; when it is already installed, nothing is copied. |
| `hooks-path` | `core.hooksPath` set to `~/.claude/harness/current/githooks` in each `--repo`. Git then runs only those hooks there. |
| `skills` | A link `~/.claude/skills/<name>` to `~/.claude/harness/current/skills/<name>` for each skill, and removes links to a skill the installed version no longer has. Other skills are never touched. |
| `plugin:<name>` | `claude plugin marketplace add Runt9-Productions/runt9-claude-harness`, then `claude plugin install <name>@runt9`. Plugins come from GitHub, never from this clone. |

Everything else goes through `current`, so a new version takes effect for hooks and skills at once, and the leak
gate's pass cache in `~/.claude/harness/state/` survives it. To change an installed skill, add rules in
`~/.claude/local/<name>/additions.md` ([how](harness/skills/README.md)); edits inside `~/.claude/harness/` are lost on
the next version.

What it refuses, before installing anything:

- Running inside a Claude Code session. `--list` still works.
- An unknown component, or `--repo` without `hooks-path`.
- `harness`: uncommitted changes to tracked files, and a symlink or submodule under `harness/`. It warns, and installs
  anyway, when HEAD is not on `origin/main` as of the last fetch.
- `hooks-path`: no `--repo`, or a `--repo` that is not the top level of a git repository. It prints a different
  `core.hooksPath` it replaces and the command that restores it, warns about each of the repository's own hooks that
  stops running, and fails when git reads back another value (a `config.worktree` or an include sets it).
- `skills`: `~/.claude/skills` resolving outside `~/.claude`, or a skill's name already taken there by anything but
  its link, which you move away yourself.
- `plugin:<name>`: `claude` missing from `PATH`. It warns when `CLAUDE_CODE_PLUGIN_DIRS` is set, since a plugin that
  loads replaces the installed one of the same name.

`hooks-path` and `skills` need the harness installed first, in the same run or an earlier one. A component installed
before a later one failed stays installed. Git runs without `GIT_DIR`, `GIT_WORK_TREE` and the other variables that
point it at another repository. Nothing here keeps an agent from writing to `~/.claude/harness/`; that is your
harness's job.

Updating: check out `main`, pull and run `python3 bootstrap.py harness skills` again. For a plugin, run
`claude plugin update <name>@runt9`; running `bootstrap.py` again does not update a plugin already installed.

MIT licensed.
