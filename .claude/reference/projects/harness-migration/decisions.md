---
title: Harness Migration Decisions
type: note
permalink: projects/harness-migration/decisions
tags: [migration, harness]
---

# Harness Migration Decisions

Decisions taken and questions raised while moving the harness. Decisions that stay true after the project closes
are in the domain notes ([[Plugin Platform]], [[Mod CI Checks]], [[Skill Loading]], [[Teammate Mailbox]],
[[Development Process]]) and are not repeated here.

## Decisions

- [decision] The marketplace is named `runt9`; each plugin is self-contained under `plugins/<name>/`, and `harness/` holds what cannot be a plugin (owner, 2026-10-24).
- [decision] `bootstrap.py` at the root is the one entry point: standard library only, it copies `harness/` parts into `~/.claude/harness/` and never symlinks #superseded (owner, 2026-10-24; replaced by the versioned-install decision below, which still never links into the clone).
- [decision] bootstrap writes the source commit into the install directory, refuses a tree with uncommitted changes and warns when HEAD is not on `origin/main` (owner, 2026-10-24).
- [decision] One clone, the working clone; updating is checking out `main`, pulling and re-running bootstrap (owner, 2026-10-24).
- [decision] The bot's credential helper is optional (owner, 2026-10-24): where a human already gates merges, Claude commits as that user, co-authored.
- [decision] No template repository for private layers: examples sit beside the code that reads them, bootstrap offers to copy each where no file exists and never overwrites, and an optional private repository URL is cloned to `~/.claude/local` only when that directory is absent (owner, 2026-10-24).
- [decision] Local layers become flat data files, not modules the hooks import (owner, 2026-10-24).
- [decision] Style guides become flat skills under `harness/skills/<guide>/`, copied by bootstrap per guide; the copy is the user's, so a re-run shows the diff and asks before overwriting #superseded (owner, 2026-10-24; replaced by the versioned-install decision below: skills are links, changed through local additions).
- [decision] A hook lists the skills loaded before a compaction and tells the agent to reload what it needs #superseded (owner, 2026-10-24; replaced by the no-reload-hook decision in [[Skill Loading]]).
- [decision] No hook reminds an agent of the style skills after each edit (owner, 2026-10-24): the comment sweep and the review panel catch style.
- [decision] No standalone tool-routing guide ships (owner, 2026-10-24): Opus used `LSP` unprompted on reference questions without one (4 of 4 on a Python fixture). Tool-routing guidance is split across reference-kb, delegation, the CLAUDE.md template and dev-process.
- [decision] Delegation's how-to is a skill, and its always-on rules a CLAUDE.md fragment that bootstrap installs by adding an import line, diff shown first (owner, 2026-10-24).
- [decision] While away mode is on, away refuses every tool-call write under `~/.claude` except `output/` and `projects/*/memory/`, adding an exception only when a refusal shows a real need (owner, 2026-10-24).
- [decision] Order of moves: scaffolding, teammate-delivery, then the state plugins together, guardrails, `harness/` and bootstrap's menus, style guides and delegation, dev-process, context-budget with reference-kb, then cleanup #superseded (owner, 2026-10-24; replaced by the infrastructure-first order below).
- [decision] Safety rails come before any more code: a shape scan (betterleaks with this repository's own rules, paranoid on purpose), a public-leak agent with no term list, a pre-push gate that fails closed, the code-review skill and a CI review job (owner, 2026-10-25): a leak in a public repository is permanent.
- [decision] Every file is audited before it is copied, with one verdict per file: drop, no longer serves its purpose, trim substantially, make generic, or copy as is (owner, 2026-10-25).
- [decision] CI's invisible-character check stays the tested grep script `guard-invisible-characters.sh` rather than anti-trojan-source (owner, 2026-10-25): a smaller change, and the script already had tests.
- [decision] away's write guard is self-contained: Write, Edit, MultiEdit and NotebookEdit are checked by file path, any other tool call is refused if its input names a guarded path, and the guard is on in away mode only (owner, 2026-10-25). The owner reviews it again once the code exists.
- [decision] handoff keeps the in-repository `.claude/output` convention, and its README says to git-exclude it (owner, 2026-10-25).
- [decision] The mod-authoring notes split: engine gotchas become a skill holding only what the built-in plugin-authoring skill lacks, the contracts go in this repository's CLAUDE.md under one heading, and anything tied to one machine is dropped or goes local (owner, 2026-10-25).
- [decision] board ships with one saved-state format and no migration code (owner, 2026-10-25).
- [decision] Order of moves, infrastructure first: bootstrap and Python CI, style-guide skills, reference-kb, delegation with worktrees and dev-process, guardrails with bootstrap's settings merge, the CLAUDE.md template, the state plugins, the rest, then cleanup (owner, 2026-10-25): what this repository needs to develop itself comes before what already works elsewhere.
- [decision] bootstrap refuses to run inside a Claude Code session (owner, 2026-10-26): it writes the install directory no agent may write.
- [decision] bootstrap v1 installs the githooks component #superseded (git hooks and leak scan together; replaced by the versioned-install decision below, whose harness component installs all of `harness/`), `core.hooksPath` in the repositories the user names, and the marketplace's plugins; the settings merge waits for guardrails (owner, 2026-10-26): it grows with each step that brings something installable.
- [decision] The harness is versioned like a plugin, in `harness/harness.json`, and CI requires the version to rise with any shipped change. bootstrap installs `harness/` from HEAD into `~/.claude/harness/versions/<version>/` (asking before it replaces an installed version, and leaving out the READMEs and tests the guard exempts) with `SOURCE_COMMIT` inside, swaps the `current` link to it, and removes other versions; hooks and skills are reached only through `current`, skills as links in `~/.claude/skills/` (owner, 2026-10-27): one atomic switch per version replaces the per-part swaps, rollbacks and the skills diff-and-ask.
- [decision] A `kotlin-style` skill ships beside the other language skills, and comment-style holds only rules that apply in any repository (owner, 2026-10-26).
- [decision] Design justification for a reviewer goes in comments on the pull request, not in the commit message or code comments (owner, 2026-10-26).
- [decision] One reference-kb plugin carries the skill, the validator and templates, and the kb-writer agent (owner, 2026-10-26): the knowledge base arrives with its writer.
- [decision] One shared format lives in the plugin, and each repository declares only what differs in `.claude/reference/kb.toml` (owner, 2026-10-26).
- [decision] The validator keeps PyYAML (owner, 2026-10-26): Basic Memory rewrites frontmatter with `yaml.dump`, and the two parsers must agree.
- [decision] The plugin ships no hook; the skill says to write with Basic Memory's tools in a registered checkout (owner, 2026-10-26): routing writes needs a copy of Basic Memory's ignore rules, and if the prose does not hold, that is accepted.
- [decision] This repository's knowledge base holds domain notes for generic measured facts, with `measured_on` standing in for `sources` on platform facts, plus this project directory for the migration's specs, order and decisions; CI runs the validator and its errors fail the job (owner, 2026-10-26).
- [decision] Basic Memory tools read and search, `Edit` in the working tree writes, and registering a project is the owner's step (owner, 2026-10-26): Basic Memory's write tools write into the registered checkout, which is not the agent's branch in a worktree.
- [decision] Only the main checkout is registered with Basic Memory (owner, 2026-10-26): sessions search the merged notes through Basic Memory and edit with `Edit` in their own worktree.
- [decision] CI runs the validator with `--stale-in` over each pull request's own commits (owner, 2026-10-26): a pull request that changes a note's sources has to re-read the note and move `verified`.
- [decision] The dev process ships as four plugins, `delegation`, `lens-review`, `test-review` and `develop`, with no worktrees plugin (owner, 2026-10-26): Claude Code's built-in worktree settings cover what the hooks did.
- [decision] The plugins are canonical and this repository's project copies of the review skills are deleted (owner, 2026-10-26): two copies drift.
- [decision] code-review is renamed `lens-review` (owner, 2026-10-26): Claude Code has a built-in `/code-review`.
- [decision] Reviewers that judge correctness or safety run on opus, pattern passes on sonnet (owner, 2026-10-26): the cheap model is enough only where the check is a pattern.
- [decision] develop reaches its user through decision tools named in a local file, and asks in chat when none is named (owner, 2026-10-26): a public user may run none.
- [decision] develop's standing push grant holds only when the development profile declares the guard hooks and branch rules (owner, 2026-10-26): without them an agent would push on its own judgment.
- [decision] Delegation states 30% as where rule-following degrades on Opus 5.5 and 60% as the ceiling, both overridable (owner, 2026-10-26): a number is structure a reader can act on.
- [decision] delegation's agent definitions ship as templates only (owner, 2026-10-26): each repository's agents carry its own project rules.
- [decision] Test review runs in CI as a label-triggered job whose fixes arrive as suggested changes (owner, 2026-10-26): the author decides what lands.
- [decision] Step 06 lands as three pull requests: delegation; the two review plugins with this repository's switch-over; develop with the development profile (owner, 2026-10-26): it keeps the one workflow change in one pull request.
