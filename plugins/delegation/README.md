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

Then, from a clone of the repository (see its README), install the harness and the fragment, which adds the line
`@~/.claude/harness/current/fragments/delegation.md` to your `~/.claude/CLAUDE.md` after showing you the diff:

```
python3 bootstrap.py harness fragment:delegation
```

The fragment lives in the harness rather than in this plugin because a plugin's install path carries its version,
so an import line pointing into it would break on every update. The harness's `current` link does not move.

## What it ships

| file | what it is |
|---|---|
| `skills/delegation/SKILL.md` | The `delegation` skill: the lead's rules before spawning, while teammates run, on receiving work and at shutdown. Loads before a spawn and before a reply to a teammate. |
| `templates/engineer.md` | An agent definition for an implementer that does one task, verifies it from real build output, stages by path and reports. |
| `templates/web-researcher.md` | An agent definition for answering one question about something outside the repository, with a verdict and attributed sources. |
| `templates/code-researcher.md` | An agent definition for answering one question about how the codebase behaves, returning the traced path as `file:line` hops with a confidence mark on each claim. It never changes code. |
| `templates/verifier.md` | An agent definition that drives the running application through the brief's steps to a known end state and reports what it saw at each step, with evidence. It never changes code or configuration. |
| `templates/triager.md` | An agent definition that reads one large, noisy artifact (logs, a crash dump, build output) and returns the answer with the few lines that prove it. |
| `local.example/additions.md` | An example of the machine-local additions, below. |

The fragment itself is `harness/fragments/delegation.md` in this repository.

## Adopting the templates

The templates are not loaded as agents. Copy one into a repository's `.claude/agents/`, or into `~/.claude/agents/`
for every repository, then replace each placeholder in angle brackets (`<build command>`, `<knowledge base location>`
and the rest) with that repository's value, and delete any line that does not apply.

Each template grants its tools with `tools:`, an allow-list, so a tool added to Claude Code later is not granted until
you add it. A tool that exists only on some machines, such as a browser or UI-driving tool, is a placeholder in that
list: replace it with the tool names you have, or delete it. Each template states its standard in full and assumes
nothing about your own `CLAUDE.md`. None of them says which tool answers which kind of question; that is left to your
own setup.

Keep the report section. The skill relies on every agent reporting the same way, and that holds only when the rule is
in the definition rather than in each spawn prompt.

## Local additions

The skill ends by inlining `~/.claude/local/delegation/additions.md`, for rules that belong to one machine: different
context thresholds, a shared build directory, where reports go. Where an addition conflicts with the skill, the
addition wins. A missing file shows as `(none)`. The plugin never creates or changes the file.

`python3 bootstrap.py plugin:delegation`, run from a clone of the repository, writes `local.example/additions.md` to
`~/.claude/local/delegation/additions.md.example`, unless that path already exists. The skill does not read that name,
so the additions take effect only once you save a filled copy as `additions.md`.

The skill's `allowed-tools` grants `Read(~/.claude/local/delegation/**)`, which the injection needs to read a file
outside the working directory.
