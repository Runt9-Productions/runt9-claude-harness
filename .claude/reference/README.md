# runt9-claude-harness knowledge base

Notes an agent reads before the code or the platform behaviour they cover. The format is the reference-kb plugin's,
`plugins/reference-kb/skills/reference-kb/references/format.md`; `kb.toml` declares what this knowledge base adds.

## Entry points

| Note | Read it before |
|---|---|
| [Plugin Platform](domains/plugins/overview.md) | writing, loading or naming a plugin, its skills or its agents, reasoning about how a change reaches users, or relying on a mod's state, timers, messages or refusals at run time |
| [Mod CI Checks](domains/plugins/mod-ci.md) | changing the `plugins` CI job, checking a mod locally, or writing a kit test |
| [Hooks Module Loader](domains/plugins/hooks-module-loader.md) | splitting a mod's hooks module across files, or moving a function, atom or matcher value between them |
| [Skill Loading](domains/skills/overview.md) | relying on a skill being in context: when it loads, and what survives compaction |
| [Teammate Mailbox](domains/agent-teams/mailbox.md) | sending text between teammates that holds tags, changing how teammate-delivery delivers a message, appending a row for a teammate with `$.session.append`, or testing delivery in `claude -p` |
| [Teammate Lifecycle](domains/agent-teams/lifecycle.md) | writing a rule about how teammates report, wait or stop, or testing one headless, where a named spawn is a background subagent rather than a teammate |
| [Built-in Worktrees](domains/worktrees/overview.md) | relying on a worktree's contents or base, or on a language server answer inside one |
| [TypeScript Language Server](domains/lsp/typescript.md) | trusting a TypeScript `findReferences`, `incomingCalls` or `hover` answer, or changing the root `tsconfig.json` |
| [Guardrails](domains/guardrails/overview.md) | writing an auto-mode rule, a permission deny rule or a sandbox setting, or relying on one of them to stop a call |
| [Comparing Harness Variants](domains/experiments/overview.md) | running two or more versions of a prompt, skill or reviewer against each other, or reading such a comparison's results |
| [Development Process](domains/development-process/overview.md) | changing what a plugin ships, CI, anything under `.github/workflows/`, or a file the pre-push gate reads |
| [Bootstrap](domains/bootstrap/overview.md) | adding or moving a module of the `bootstrap/` package, or changing what `bootstrap.py` writes into `~/.claude/local/` |
| [Harness Migration](projects/harness-migration/overview.md) | resuming the harness migration |
| [Test Review Breaks](projects/test-review-batch/overview.md) | reading the rulings and measurements behind test-review's breaks and the single-agent lens-review (issue #55) |
| [Away Plugin](projects/away-plugin/overview.md) | building or changing the `away` plugin (issue #67) |
| [Bootstrap Split](projects/bootstrap-split/overview.md) | reading the rulings and the module map behind the `bootstrap/` package (issue #14) |
| [Plugin Templates](projects/plugin-templates/overview.md) | reading the rulings and the designs ruled out behind the template copy (issue #37) |
| [Bootstrap Update](projects/bootstrap-update/overview.md) | reading the rulings and the designs ruled out behind `bootstrap.py --update` (issue #41) |
| [Bootstrap Menu](projects/bootstrap-menu/overview.md) | reading the rulings and the designs ruled out behind the `bootstrap.py` selection menu and `all` (#121) |
| [Watcher Plugin](projects/watcher-plugin/overview.md) | building or changing the `watcher` plugin (issue #35) |
| [Teammate Delivery Tool Result](projects/teammate-delivery-tool-result/overview.md) | building or reviewing the teammate-delivery fix that carries a mid-turn message on the next tool result (issue #143) |
| [TypeScript Go LSP Plugin](projects/typescript-go-lsp/overview.md) | reading the rulings and the designs ruled out behind the `typescript-go-lsp` plugin and the root `tsconfig.json` (issue #131) |

## Local conventions

- **The repository is public.** Notes hold generic facts only: no machine paths, private project names, ids or
  addresses. The leak scan and the code review read notes like any other file.
- **Platform facts carry `measured_on`**, naming the Claude Code version (and any other tool) they were measured on.
  Re-measure on a newer version before depending on one.
- **`[vendor]`** is a claim from Claude Code's documentation that was not measured here.
- **A Scope line cites the pull request (`#NNN`) the sources were read on, never a branch commit.** Pull requests
  squash-merge, so a branch commit is unreachable from `main` after the merge, while the pull request still leads
  to its commits.
- **`[decision]` lines name the owner and the date, with the reason in one line.** They say what was decided and why,
  never how it came to be decided.
