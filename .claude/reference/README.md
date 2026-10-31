# runt9-claude-harness knowledge base

Notes an agent reads before the code or the platform behaviour they cover. The format is the reference-kb plugin's,
`plugins/reference-kb/skills/reference-kb/references/format.md`; `kb.toml` declares what this knowledge base adds.

## Entry points

| Note | Read it before |
|---|---|
| [Plugin Platform](domains/plugins/overview.md) | writing, loading or naming a plugin, its skills or its agents, or reasoning about how a change reaches users |
| [Mod CI Checks](domains/plugins/mod-ci.md) | changing the `plugins` CI job, or checking a mod locally |
| [Hooks Module Loader](domains/plugins/hooks-module-loader.md) | splitting a mod's hooks module across files, or moving a function, atom or matcher value between them |
| [Skill Loading](domains/skills/overview.md) | relying on a skill being in context: when it loads, and what survives compaction |
| [Teammate Mailbox](domains/agent-teams/mailbox.md) | sending text between teammates that holds tags |
| [Teammate Lifecycle](domains/agent-teams/lifecycle.md) | writing a rule about how teammates report, wait or stop, or testing one headless |
| [Built-in Worktrees](domains/worktrees/overview.md) | relying on a worktree's contents or base, or on a language server answer inside one |
| [Guardrails](domains/guardrails/overview.md) | writing an auto-mode rule, a permission deny rule or a sandbox setting, or relying on one of them to stop a call |
| [Development Process](domains/development-process/overview.md) | changing what a plugin ships, CI, or anything under `.github/workflows/` |
| [Harness Migration](projects/harness-migration/overview.md) | resuming the harness migration |

## Local conventions

- **The repository is public.** Notes hold generic facts only: no machine paths, private project names, ids or
  addresses. The leak scan and the review panel read notes like any other file.
- **Platform facts carry `measured_on`**, naming the Claude Code version (and any other tool) they were measured on.
  Re-measure on a newer version before depending on one.
- **`[vendor]`** is a claim from Claude Code's documentation that was not measured here.
- **`[decision]` lines name the owner and the date, with the reason in one line.** They say what was decided and why,
  never how it came to be decided.
