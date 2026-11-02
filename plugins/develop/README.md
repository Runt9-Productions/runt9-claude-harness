# develop

A development process for one ticket at a time: investigation and an effort estimate, a spec, a worktree, one
engineer teammate per task, verification, a draft pull request, test and code review, fixes, an optional external
review, a reviewer guide, hand-off, and the owner's review loop. Everything that differs between repositories comes
from a development profile the repository keeps.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install develop@runt9
```

It depends on the `delegation` plugin, whose skill governs every teammate and whose templates are the starting point
for the implementer, verifier and research agents. A template is not an agent: copy each one a repository uses into
its `.claude/agents/`, fill in every placeholder (that plugin's README, "Adopting the templates", says how), and name
the ids it is spawned as in the profile's section 5. The `lens-review` plugin runs the code review in step 7 unless
the profile names another, so install it unless every repository brings its own. The `test-review` skill is
optional: step 7 runs it when it is installed and the repository has a test-review profile.

## What it ships

| file | what it is |
|---|---|
| `skills/develop/SKILL.md` | The `develop` skill: the twelve steps from ticket to reviewed draft pull request and the review loop after it. |
| `skills/effort-estimate/SKILL.md` | The `effort-estimate` skill: sizes a change in files, lines of code and complexity, never duration. Step 1 of `develop`, and usable alone. |
| `agents/comment-sweeper.md` | The `comment-sweeper` agent, spawned as `develop:comment-sweeper`: sweeps every comment a diff adds or edits and repairs the failures without touching code. |
| `templates/development-profile.md` | The skeleton of a repository's development profile. |
| `local.example/` | Examples of the machine-local files, below. |

## Adopting the profile

Copy `templates/development-profile.md` to `.claude/development-profile.md` in the repository and fill in each
section, writing "not applicable" where one does not apply. Keep it in the repository, never in the plugin directory,
which an update replaces. `develop` stops and names the template when a repository has no profile.

## Worktree settings

Builds run in Claude Code's built-in worktrees. A plugin cannot set worktree options, so the repository carries
them itself:

- `.worktreeinclude` at the repository root lists files git does not track that a new worktree needs copied in.
- `worktree.symlinkDirectories` in the repository's `.claude/settings.json` lists directories to link rather than
  copy.
- `worktree.baseRef` there is `fresh` to branch from the remote default branch or `head` to branch from the current
  HEAD.

`claude --worktree <name>` creates the worktree and starts a session in it, and run again it re-enters the existing
worktree of that name, so the same command starts and resumes a build session. Step 3 checks the worktree's starting
commit against the ticket's base either way.

## Local files

Machine-local data lives in `~/.claude/local/develop/`, and a missing file counts as empty:

- `decision-tools.md` names the tools for decisions, owner tasks, task progress and the status line. Without it,
  `develop` asks in chat and keeps progress in the spec. `local.example/` shows its shape with made-up tool names.
- `additions.md` holds rules for `develop` on this machine.
- `effort-estimate.md` holds rules for `effort-estimate` on this machine.

`python3 bootstrap.py plugin:develop`, run from a clone of the repository, writes each file in `local.example/` to
this directory with `.example` added to its name, unless that path already exists. No skill reads a `.example` file,
so a template takes effect only once you save a filled copy without `.example`.

Each skill inlines its files when it loads, and a rule there wins over the skill's own where they conflict. Each
skill's `allowed-tools` grants `Read(~/.claude/local/develop/**)`, which reading outside the working directory needs.
