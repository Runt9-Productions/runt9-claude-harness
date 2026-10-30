---
title: Harness Migration Spec
type: note
permalink: projects/harness-migration/spec
tags: [migration, harness]
---

# Harness Migration Spec

The settled design of steps 03 to 06, archived as agreed. The decisions behind each are in
[[Harness Migration Decisions]]; what the steps are and where they stand is in [[Harness Migration Checklist]].

## 03 bootstrap.py and the Python CI job

Replaces the hand copy of the git hooks with one script, and gives later steps a place to add what they install.
Small on purpose: it grows with each step that brings something installable.

- **Location and dependencies:** `bootstrap.py` at the repository root, Python standard library only.
- **What it does:** installs `harness/` as a version under `~/.claude/harness/versions/`, with the source commit
  inside, behind the `current` link (see the versioned-install decision); installs plugins with `claude plugin marketplace add`, then `claude plugin install <name>@runt9`.
- **What it refuses:** a tree with uncommitted changes, and running inside a Claude Code session
  (`CLAUDE_CODE_SESSION_ID` set), since it writes the install directory no agent may write. It warns, without
  refusing, when HEAD is not on `origin/main`.
- **v1 components:** githooks (the git hooks and the leak scan together), `core.hooksPath` in the repositories the
  user names, and the plugins in `.claude-plugin/marketplace.json`. It warns when a picked plugin is also loaded
  through `CLAUDE_CODE_PLUGIN_DIRS`.
- **Shape:** what can be installed is a registry of components, so a later step adds a component rather than a
  branch in `main`. Plugins come from the marketplace file, never from a second list kept by hand. The user names
  components on the command line or, naming none, is asked per component.
- **Tests:** few, at the boundaries: the script runs as a subprocess against a synthetic repository in a temporary
  directory, with `HOME` pointed there and a stub `claude` on `PATH`.
- **CI:** a `python` job that `gate` needs, running ruff (lint and format) and pytest at exact versions from
  `requirements-dev.txt`.
- **Out of scope:** anything under `~/.claude` other than `~/.claude/harness/`; setting the authorship keys, which
  each repository sets up (the script may say when they are unset); the settings merge, local examples and the
  private-layer clone, which come when they exist; removing the source copies.

## 04 Style-guide skills

Code-style principles, language guides and a comment guide become skills a public user can install.

- **Skills:** `harness/skills/code-style/`, `python-style/`, `kotlin-style/`, `typescript-style/` and
  `comment-style/`, each a `SKILL.md`
  whose frontmatter holds `name`, a description naming the moment it applies and the phrases a user types, and
  `allowed-tools` for the local-additions injection only.
- **Content:** each rule keeps its structure and a one-line reason, with one synthetic instance only where a rule is
  ambiguous alone. Standalone for a public user: no references to one person, to a `CLAUDE.md` or to
  configuration paths. Skills refer to each other by skill name.
- **Local additions:** each skill injects `~/.claude/local/<skill>/additions.md` at load, and a missing file is not
  an error.
- **bootstrap component `skills`:** links `~/.claude/skills/<name>` to the installed version's copy; a user changes
  a skill through its local additions. It refuses when
  `~/.claude/skills` resolves outside `~/.claude`, since a linked skills directory would write into another
  repository. Tests at the boundaries, like bootstrap's.
- **References:** every in-repository mention of the guides points at the skills, including the code-review
  profile, which names the checkout's `harness/skills/` because CI has no `~/.claude`.
- **No compaction reload hook.**
- **Out of scope:** anything outside this repository, the comment-sweeper agent (step 06), and any hook.

## 05 reference-kb and this repository's knowledge base

- **Plugin:** `plugins/reference-kb/` holds the reference-kb skill (the shared format, how to read, write and
  validate, and Basic Memory usage), the validator with pytest tests, the templates and the kb-writer
  agent, spawned as `reference-kb:kb-writer`. Version 0.1.0, with a marketplace entry.
- **Format:** one shared format in the plugin. Each repository declares only what differs in
  `.claude/reference/kb.toml` (trees present, extra categories, tags and statuses), so its README holds entry points
  and local conventions.
- **Validator:** takes the knowledge base's directory as a `--root` option, keeping PyYAML (pinned in
  `requirements-dev.txt`). An optional `measured_on` key stands in for `sources` on a platform fact.
- **Hooks:** none.
- **Reading and writing:** Basic Memory tools read and search; `Edit` in the working tree writes. Registering a
  project with Basic Memory is the owner's step.
- **This repository's knowledge base:** domain notes for generic measured facts, settled decisions as `[decision]`
  lines with a one-line reason, and this project directory for the migration's specs, order and decisions. CI runs
  the validator, and its errors fail the job.
- **Order:** the plugin first, then this repository's notes, written against the shipped format and validated by it.
- **Constraints:** private sources are read, never copied: no private project names, notes or vocabulary. A ticket
  example uses a shape the leak scan allows. No history in prose.

## 06 Delegation and the dev-process plugins

Four plugins carry the development process: how a lead delegates, how a change is reviewed, how its tests are
reviewed, and the ticket-to-pull-request flow that ties them together.

- **Plugins:** `delegation` (the skill and five agent templates: `engineer`, `web-researcher`, `code-researcher`,
  `verifier` and `triager`); `lens-review` (the panel review skill, renamed from code-review so it does not collide
  with the built-in command, with the reviewer brief and templates for a profile and a reviewer); `test-review` (the
  skill, the `test-reviewer` agent and a profile template); `develop` (the develop and effort-estimate skills, the
  `comment-sweeper` agent and a development-profile template), which lists `delegation` in `dependencies` and runs
  `lens-review` as its panel unless the profile names another. Each starts at 0.1.0.
- **Always-on fragment:** delegation's `CLAUDE.md` fragment is `harness/fragments/delegation.md`, in the harness
  rather than the plugin, because a plugin's install path carries its version and an import line pointing into it
  would break on every update.
- **One copy:** the plugins are canonical. This repository's project copies of the review skills are deleted, and
  the label-triggered review workflows load the plugins from the pull request's checkout with `--plugin-dir`.
- **Worktrees:** no hooks ship. develop uses Claude Code's built-in `.worktreeinclude`, `worktree.symlinkDirectories`
  and `worktree.baseRef`, which each repository sets itself, since a plugin cannot.
- **Models:** opus for reviewers that judge whether code is correct or safe, `test-reviewer` included; sonnet for
  pattern passes (`staleness-and-debris`, `comment-sweeper`). The templates inherit the session's model.
- **Delegation thresholds:** rule-following degrades past about 30% of the context on Opus 5.5 and 60% is the
  ceiling, both overridable in `~/.claude/local/delegation/additions.md`. Ramp-up cost belongs to each repository's
  development profile.
- **Agents as templates:** the templates are not loaded as agents. A repository copies the ones it uses into
  `.claude/agents/` and fills them in, and develop stops and points at `templates/engineer.md` when the profile names
  no adopted implementer.
- **develop's decision tools:** decisions, owner tasks, task progress and the status line go through the tools named in
  `~/.claude/local/develop/decision-tools.md`. For a kind with no tool named, or a tool the session lacks, develop asks
  in chat, lists owner tasks in its final report and keeps progress in the spec's checklist.
- **Push grant:** develop commits, pushes and opens the draft pull request on its own only when the development
  profile declares both guard hooks that stop destructive git commands and remote rules that stop pushes to protected
  branches; otherwise it asks before each push.
- **Test review:** develop runs `/test-review` before the panel review when the repository has a test-review profile,
  the skill is installed and the profile does not opt out. In CI it is a label-triggered job whose fixes arrive only as
  suggested changes on the pull request.
- **This repository:** a tracked `.claude/development-profile.md`, with `engineer`, `verifier` and `code-researcher`
  adopted from the templates. It declares the remote rules but no guard hook, so develop holds no standing push grant
  here.
- **Order:** four pull requests: delegation; lens-review and test-review; this repository's switch-over to them,
  which changes CI and is pushed by the owner; develop with the development profile.
- **Measured first:** every Claude Code behaviour a rule rests on (plugin agent names, built-in worktree settings,
  what a teammate's idle notification carries, how a forked skill reports, headless `--plugin-dir` in CI) is measured
  on the current version before the rule is written; results go into the domain notes with `measured_on`.
