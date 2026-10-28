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

    python3 bootstrap.py harness skills

It links `~/.claude/skills/<name>` to the installed version's copy, so a new harness version updates every skill at
once. Change a skill through its local additions (below), not by editing the installed copy, which the next version
replaces.

The installer refuses when `~/.claude/skills` resolves outside `~/.claude`, so it never writes into another
repository through a link, and when a skill's name there is already taken by anything but its link.

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
