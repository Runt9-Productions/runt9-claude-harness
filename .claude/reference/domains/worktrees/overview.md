---
title: Built-in Worktrees
type: note
permalink: worktrees/overview
tags: [worktrees, claude-code, language-server]
verified: 2026-11-02
coverage: partial
measured_on: "Claude Code 2.1.312"
sources:
  - plugins/develop/skills/develop/SKILL.md
  - plugins/delegation/skills/delegation/SKILL.md
---

# Built-in Worktrees

> **Scope.** What Claude Code's built-in worktree settings do for a `claude --worktree` session and an `isolation: "worktree"` agent, and which language server a worktree agent queries. The `#measured` lines are carried from headless `-p` runs on 2.1.312 (2026-10-28) on a synthetic repository, with pyright (version not recorded) run through a minimal plugin, and were not re-measured when this note was written; the two lines marked 2.1.316 come from one interactive `--worktree` session against this repository's real remote; step 3 of the develop skill (its worktree, base check, spec and handoff items) and the worktree section of the delegation skill were read, and the develop skill's step 3 lines cited were re-read on 2026-11-02, after the changes to its step 7. Not covered: `worktree.baseRef` against a real remote, the `fresh` value written out, re-entering an existing worktree, worktree cleanup, and any interactive session.

Read this before relying on a worktree's contents or base, or before trusting a language server answer about a
worktree. The language-server trap returns a clean "not found" rather than an error.

## Observations

- [fact] `.worktreeinclude` copies the git-ignored files it lists into a new worktree, for `--worktree` sessions and `isolation: "worktree"` agents alike; an ignored file it does not list is absent #measured
- [trap] `.worktreeinclude` is read from the main checkout's root, so it applies even when the worktree's base commit predates the file #measured
- [fact] `worktree.symlinkDirectories` links each listed directory to the main checkout's copy; without it an ignored directory such as `node_modules` is absent from the worktree #measured
- [fact] With `worktree.baseRef` unset the worktree started at the remote-tracking default branch, not at HEAD, and with `"head"` at the current HEAD #measured (a locally made `origin/HEAD`, no remote configured)
- [question] The docs, as the measuring run quoted them and not re-read here, say that with no remote configured the base falls back to HEAD, which this run contradicts, and the fetch path with a real remote was not exercised. A run against a real remote settles both.
- [fact] With `worktree.baseRef` unset, an interactive `claude --worktree` session started at the local `origin/main` ref as last fetched, not at the remote's current head, so a ref behind the remote gives a base behind it too #measured (2.1.316, 2026-10-31; whether it tried to fetch first was not observed)
- [trap] An interactive `claude --worktree` session is confined to its worktree: it reads the main checkout, but a file write or a `git -C` aimed there is refused, so any step that edits the main checkout falls to the owner #measured (2.1.316, 2026-10-31)
- [fact] A worktree made in `-p` is left on disk under `.claude/worktrees/<name>`, on branch `worktree-<name>` #measured
- [fact] The develop skill's step 3 compares the worktree's HEAD with the ticket's freshly fetched base before the first commit, because the built-in knows only the remote default branch or HEAD (`plugins/develop/skills/develop/SKILL.md` step 3 "Base check", `:114`).
- [risk] develop also relies on `claude --worktree <name>` re-entering an existing worktree of that name with its commits intact (`plugins/develop/skills/develop/SKILL.md` step 3 "Worktree", `:108`); that was not measured here.
- [trap] A session runs one language server, rooted where it was first started. Once the lead has started it in the main checkout, a worktree agent's queries resolve against the main checkout and a worktree-only symbol comes back "No definition found." with no error #silent-failure #measured
- [fact] When the worktree agent makes the first language-server call, or the session itself was started with `--worktree`, the server resolves the worktree's own files #measured
- [trap] The `LSP` tool prints paths relative to the caller's directory, so an answer pointing into the main checkout shows only as an absolute path #measured
- [fact] The delegation skill has a worktree agent confirm its own new symbols with the build or a text search, never the language server (`SKILL.md:88`).

## Relations

- see_also [[Plugin Platform]]
- see_also [[Teammate Lifecycle]]
