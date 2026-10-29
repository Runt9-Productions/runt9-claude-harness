# delegation

Rules for a lead session that hands work to Agent Teams teammates: when to delegate, how many teammates to run, how
to size and brief a task, how to wait on and answer teammates, how to receive their reports, and how to shut them
down. Most of it loads on demand as a skill; a short fragment in your `CLAUDE.md` keeps the reason to delegate in
every session and names the skill.

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install delegation@runt9
```

Then install the harness (see the repository's README) and add this line to your `~/.claude/CLAUDE.md`:

```
@~/.claude/harness/current/fragments/delegation.md
```

The fragment lives in the harness rather than in this plugin because a plugin's install path carries its version,
so an import line pointing into it would break on every update. The harness's `current` link does not move.

## What it ships

| file | what it is |
|---|---|
| `skills/delegation/SKILL.md` | The `delegation` skill: the lead's rules before spawning, while teammates run, on receiving work and at shutdown. Loads before a spawn and before a reply to a teammate. |
| `templates/engineer.md` | An agent definition for an implementer that does one task, verifies it from real build output, stages by path and reports. |
| `templates/researcher.md` | An agent definition for answering one question about something outside the repository, with a verdict and attributed sources. |
| `local.example/additions.md` | An example of the machine-local additions, below. |

The fragment itself is `harness/fragments/delegation.md` in this repository.

## Adopting the templates

The templates are not loaded as agents. Copy one into a repository's `.claude/agents/`, or into `~/.claude/agents/`
for every repository, then replace each placeholder in angle brackets (`<build command>`, `<knowledge base location>`
and the rest) with that repository's value, and delete any line that does not apply.

Keep the report section. The skill relies on every agent reporting the same way, and that holds only when the rule is
in the definition rather than in each spawn prompt.

## Local additions

The skill ends by inlining `~/.claude/local/delegation/additions.md`, for rules that belong to one machine: different
context thresholds, a shared build directory, where reports go. Where an addition conflicts with the skill, the
addition wins. A missing file shows as `(none)`. The plugin never creates or changes the file.

The skill's `allowed-tools` grants `Read(~/.claude/local/delegation/**)`, which the injection needs to read a file
outside the working directory.
