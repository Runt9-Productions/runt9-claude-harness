# runt9-claude-harness

Opt-in plugins and harness pieces for Claude Code, still being migrated in.

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install <name>@runt9
```

Updates are manual: run `claude plugin update <name>@runt9` when you want one.

## Harness parts

The parts that cannot be plugins, such as the git hooks, the style-guide skills and the `CLAUDE.md` fragments, are installed from a clone with `bootstrap.py`, which can
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
| `harness` | `harness/` as it is in the commit checked out (never the working tree), into `~/.claude/harness/versions/<version>/` with that commit's hash in `SOURCE_COMMIT`, then points the `~/.claude/harness/current` link at it and removes every other version. `<version>` is `harness/harness.json`'s; when it is already installed, it asks before replacing it. READMEs and tests are not installed. |
| `hooks-path` | `core.hooksPath` set to `~/.claude/harness/current/githooks` in each `--repo`. Git then runs only those hooks there. |
| `skills` | A link `~/.claude/skills/<name>` to `~/.claude/harness/current/skills/<name>` for each skill, and removes links to a skill the installed version no longer has. Other skills are never touched. |
| `fragment:<name>` | The line `@~/.claude/harness/current/fragments/<name>.md`, one component per file in `harness/fragments/`, added to a block in `~/.claude/CLAUDE.md` between two `runt9-claude-harness` marker lines. It shows the diff and asks before writing, adds the block at the end when there is none, and never changes a line outside it. A missing `~/.claude/CLAUDE.md` starts from the installed harness's `claude-md-template.md` where it has one. A file that already imports the fragment, anywhere, is left alone. A `CLAUDE.md` that links elsewhere keeps its link, and the file it names changes. |
| `settings:<name>` | `~/.claude/harness/current/settings/<name>.json`, one component per file in `harness/settings/`, merged into `~/.claude/settings.json`: a list gains the fragment's entries it lacks, an object gains the keys it lacks, and a value already set is never replaced. It shows the diff and asks before writing, and changes nothing the fragment does not name. The file is rewritten in its own indentation with its keys in order; other whitespace and a duplicate key are not kept. A missing `settings.json` is written from the fragment alone; a `settings.json` that links elsewhere keeps its link. |
| `plugin:<name>` | `claude plugin marketplace add Runt9-Productions/runt9-claude-harness`, then `claude plugin install <name>@runt9`. Plugins come from GitHub, never from this clone. |

Everything else goes through `current`, so a new version takes effect for hooks and skills at once, and the leak
gate's pass cache in `~/.claude/harness/state/` survives it. To change an installed skill, add rules in
`~/.claude/local/<name>/additions.md` ([how](harness/skills/README.md)); edits inside `~/.claude/harness/` are lost on
the next version.

What it refuses. The first two, and the `hooks-path` checks on `--repo`, stop the run before anything installs; the
rest stop at that component:

- Running inside a Claude Code session. `--list` still works.
- An unknown component, or `--repo` without `hooks-path`.
- `harness`: uncommitted changes to tracked files, and a symlink or submodule under `harness/`. It warns, and installs
  anyway, when HEAD is not on `origin/main` as of the last fetch.
- `hooks-path`: no `--repo`, or a `--repo` that is not the top level of a git repository. It prints a different
  `core.hooksPath` it replaces and the command that restores it, warns about each of the repository's own hooks that
  stops running, and fails when git reads back another value (a `config.worktree` or an include sets it).
- `skills`: `~/.claude/skills` resolving outside `~/.claude`, or a skill's name already taken there by anything but
  its link, which you move away yourself.
- `fragment:<name>`: before anything installs, an installed harness without the fragment (unless `harness` is in the
  same run), or a `~/.claude/CLAUDE.md` whose markers are not one start line followed by one end line, which you fix
  by hand. Answering no to the diff stops the run there.
- `settings:<name>`: before anything installs, an installed harness without the fragment (unless `harness` is in the
  same run), or a `~/.claude/settings.json` that is not a JSON object. At that component, a key the fragment holds as
  a list or an object that `settings.json` holds as something else, which you fix by hand. Answering no to the diff
  stops the run there.
- `plugin:<name>`: `claude` missing from `PATH`. It warns when `CLAUDE_CODE_PLUGIN_DIRS` is set, since a plugin that
  loads replaces the installed one of the same name.

`hooks-path`, `skills`, the fragments and the settings need the harness installed first, in the same run or an earlier
one. A component installed before a later one failed stays installed. Git runs without `GIT_DIR`, `GIT_WORK_TREE` and
the other variables that point it at another repository. Nothing here keeps an agent from writing to
`~/.claude/harness/`; that is your harness's job.

Updating: when `harness/harness.json`'s version rises, check out `main`, pull and run
`python3 bootstrap.py harness skills` again, adding `fragment:<name>` for a fragment `--list` shows that you have not
imported yet and `settings:<name>` for a settings fragment that is new or has changed. For a plugin, run
`claude plugin update <name>@runt9`; running `bootstrap.py` again does not update a plugin already installed.

MIT licensed.
