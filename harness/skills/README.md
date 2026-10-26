# Style-guide skills

Five skills that tell Claude how code and comments should be written: `code-style` (language-neutral
principles), `python-style`, `kotlin-style` and `typescript-style` (what they mean in each language) and
`comment-style` (when a comment earns its place, and the per-comment sweep). Each loads when the work calls for it, or by name, such as
`/comment-style`.

`python3 bootstrap.py skills` copies each into `~/.claude/skills/<name>/`. The installed copy is yours: when it
differs from the clone's copy, a run shows the diff and asks before replacing it. It refuses when
`~/.claude/skills`, or a skill directory in it, is a symlink resolving outside `~/.claude`, since the copy would
land wherever the link points.

## Local additions

Rules of your own go in `~/.claude/local/<skill>/additions.md`, which bootstrap never touches. Each skill ends with
a `!` command that inlines that file when the skill loads, and shows `(none)` when it is missing; an addition wins
where it conflicts with the skill. The skill's `allowed-tools` grants the read of that directory, which Claude Code
otherwise blocks as outside the working directory. With `disableSkillShellExecution` set, the skill shows
`[shell command execution disabled by policy]` in place of the additions.

Example `~/.claude/local/comment-style/additions.md`:

```markdown
### Doc comments in Example language

Public items use `///`. A summary line, then a blank line before anything longer.
```
