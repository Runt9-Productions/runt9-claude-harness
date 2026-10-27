---
title: Harness Migration Spec
type: note
permalink: projects/harness-migration/spec
tags: [migration, harness]
---

# Harness Migration Spec

The settled design of steps 03 to 05, archived as agreed. The decisions behind each are in
[[Harness Migration Decisions]]; what the steps are and where they stand is in [[Harness Migration Checklist]].

## 03 bootstrap.py and the Python CI job

Replaces the hand copy of the git hooks with one script, and gives later steps a place to add what they install.
Small on purpose: it grows with each step that brings something installable.

- **Location and dependencies:** `bootstrap.py` at the repository root, Python standard library only.
- **What it does:** copies `harness/` parts into `~/.claude/harness/`, never symlinking, and writes the source
  commit there; installs plugins with `claude plugin marketplace add`, then `claude plugin install <name>@runt9`.
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
- **bootstrap component `skills`:** copies each `harness/skills/<name>/` into `~/.claude/skills/<name>/`. The copy is
  the user's, so a re-run shows the diff against the installed copy and asks before overwriting. It refuses when
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
