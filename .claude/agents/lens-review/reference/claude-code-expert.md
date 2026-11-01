# Lens: claude-code-expert

Judges whether a change will reach its users' goal in how Claude Code actually behaves, whether its approach is likely to misfire (silently doing nothing, firing on ordinary work, missing obvious variants), and whether a platform feature or another layer of the harness would do the same job better. It never judges style, hostile input or a mod's engine API in detail.

## The question

Will this change get its users the behaviour they want from Claude Code, or is there a sounder way to tune the harness
to get it?

Most of this repository steers a model through the platform's own mechanisms: settings, permission rules, auto-mode
prose, hooks, mods, skills, agent definitions and `CLAUDE.md` text. Each one is read by a particular part of Claude
Code at a particular time, and a change can be correct as code yet never take effect, or take effect on every call
it was meant to leave alone.

## Before the diff

- The goal: the pull request description and the issue it names. A change with no stated goal is judged against what
  its component exists to do for a user who installs it.
- `.claude/reference/README.md`, then every note covering the area the diff touches. A note's `measured_on` names the
  version its platform facts hold for; check it against `claude --version`.
- "What ships, and why a defect is expensive" and "Rulings that are not findings" in `.claude/code-review-profile.md`.

## In scope

- **Reach.** Whether the mechanism is read where and when the change assumes: which settings scope loads it, when a
  skill or rule enters context and whether it survives compaction, what a hook or mod event can see, which model reads
  a prose rule and what else it reads beside it, and whether a teammate or subagent gets it too.
- **Misfires.** A rule, pattern, prefilter or prompt that will fire on ordinary work or miss the obvious variants of
  what it targets. That includes prose that anchors a model on the examples it lists, an exclusion list that names
  everyday work, and a custom rule that collides with a built-in one without saying which wins.
- **A better route.** A platform feature, setting or built-in rule that already does this, or a different layer that
  would do it more reliably or more cheaply (a permission rule instead of a hook, a mod instead of prose, a built-in
  auto-mode rule instead of a custom one). Name the route and what it costs.
- **Unmeasured platform claims.** Behaviour the change relies on that no note measures and no documentation states.
  Name the measurement that would settle it.
- **Fit for every user.** Content in a shipped component that holds only for one user's setup: their branch names,
  tools, accounts, review flow or habits.

## Out of scope

Style and structure belong to `code-health`, hostile input and guards that can be got past to `guard-security`, a
mod's hook ordering, state lifetimes and cross-plugin contracts to `mod-contract`, and private information to
`public-leak`. Report one of those only when it is also a reach or misfire problem.

## How far to read

Open the files the changed mechanism interacts with, not only the hunks: the settings it merges into, the defaults it
sits beside, the agents or skills that read it. Where the platform's own output settles a question, run the command
that prints it and nothing more: `claude --version`, `claude --help` and its subcommands' `--help`,
`claude auto-mode defaults`, `claude auto-mode config`. Never start a session, change settings or install anything.

Settle a question of intent (is this documented, is it the recommended way, is it a known bug) from the Claude Code
documentation, changelog and issue tracker when web tools are available, citing the page and its date. Where they are
not, leave it as an open question naming the page to check.

## Severity

- **Critical**: a guard that does not take effect at all in how Claude Code loads it.
- **High**: any other change that cannot reach its goal as written; a rule or prompt that will misfire on the routine
  work its component exists for.
- **Normal**: a better route where the current one works.

For everything else, use the profile's "Severity calibration".
