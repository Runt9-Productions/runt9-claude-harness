# Style skills

Five Claude Code skills that tell Claude how to write and review code.

| skill | covers |
|---|---|
| `code-style` | language-neutral principles, numbered so the language skills can refer to them |
| `python-style` | code-style applied to Python |
| `kotlin-style` | code-style applied to Kotlin |
| `typescript-style` | code-style applied to TypeScript |
| `comment-style` | when a comment earns its place, worked examples, and a sweep over changed comments |

A language skill loads together with `code-style`. A repository's own style guide wins over both wherever they differ.

## Installing

Run this from a clone of the repository, in your own shell rather than a Claude Code session:

    python3 bootstrap.py skills

It copies each skill into `~/.claude/skills/<name>/`. The installed copy is yours to edit. When it differs from the
clone's copy, a later run shows the difference as a diff and replaces your copy only if you answer yes.

The installer refuses to write when `~/.claude/skills`, or one skill's directory inside it, is a symlink that resolves
outside `~/.claude`, so it never writes into another repository through a link.

## Local additions

Each skill ends by inlining `~/.claude/local/<name>/additions.md`, for rules that belong to one machine rather than to
this repository. The installer never creates, reads or changes that file.

The last line of every skill is a shell command that Claude Code runs when the skill loads:

    !`cat ~/.claude/local/<name>/additions.md 2>/dev/null || echo "(none)"`

Its output replaces the line, so the skill shows the file's contents, or `(none)` when there is no file. Where an
addition conflicts with a rule in the skill, the addition wins.

Each skill's `allowed-tools` grants `Read(~/.claude/local/<name>/**)`. Without it, reading the file would be blocked as
a path outside the working directory.

If the `disableSkillShellExecution` setting is on, the command does not run, and the skill shows
`[shell command execution disabled by policy]` in its place.

An example `~/.claude/local/python-style/additions.md`:

```markdown
- The interpreter on this machine is Python 3.11, so do not use syntax added later.
- Money amounts are `decimal.Decimal`, never `float`.
- Command-line parsing uses `argparse`; do not add `click`.
```
