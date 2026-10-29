# Development profile

What the `develop` skill needs to know about this repository. Where `CLAUDE.md`, `.claude/code-review-profile.md` or
a knowledge base note already answers a question, this file points there.

## 1. Ticket tracker

- GitHub issues on `Runt9-Productions/runt9-claude-harness`. Every change, fix or feature, is an issue in the shape
  of `.github/ISSUE_TEMPLATE/change.md`; `CLAUDE.md`, "Issues and pull request text", has the rules for writing one.
- A review finding deferred from its pull request becomes an issue labelled `from-review`.
- Step 3's setup: label `bug` or `enhancement`, plus exactly one of `area:harness`, `area:ci`, `area:plugins` and
  `area:review`. There are no assignment, planning or estimate fields; the estimate lives in the spec only.
- Work started: no update.
- Automation: none of this repository's own. GitHub closes an issue when a pull request whose body names it with a
  closing keyword (`Closes #<n>`) merges into `main`.
- Issue text is public the moment it posts and no CI scan reads it. Write it to a file with the title on the first
  line, run `review-text.sh <file> . origin/main` from the installed harness (`~/.claude/harness/current/leak-scan/`,
  or the checkout's `harness/leak-scan/` where none is installed), and post the title and body from that file only
  when it exits 0. Cite commits by their short hash, since a full one matches the scan's hex-identifier rule.
- Connection failure: `gh` answers 401 until `GH_TOKEN` is set, and how it is minted is machine-local. File an owner
  task and carry on.

## 2. Branches

- Base: `main`, both as the pull request target and for diffs.
- Naming: `claude/<kebab-case-slug>` naming the change, such as `claude/example-change`. The bot may push nothing
  outside `claude/`.
- Lag: `main` accepts a pull request only when its branch is up to date, so merge `main` in before the last push. A
  merge that brings in a change to `.github/workflows/` cannot be pushed by the bot (section 10).
- Trap: `origin/main` and `bot/main` track the same branch through two remotes and go stale separately. Fetch the
  one you compare against.

## 3. Worktree and working directory

- The repository has no `.worktreeinclude` and no `worktree.*` settings, so Claude Code's defaults apply. A new
  worktree needs no untracked file copied in. It needs `npm ci` once before mod checks, and a virtual environment
  for the Python checks (`CLAUDE.md`, "Trying a change").
- Renaming the branch: what it changes about the built-in worktree's cleanup has not been measured here.
- Shared with the main checkout: the git config, so `core.hooksPath` and the `claude.*` keys the hooks read apply in
  every worktree, and commits made in one are visible to all. Writes through it work.
- Working directory: `.claude/output/<ticket>/` in the main checkout, ignored by the tracked `.gitignore`. It is
  scratch: working documents that must last go in the spec location. No comment or doc may point at it, because no
  other clone has it.
- Fresh session: yes, started with `claude --worktree <name>`, because a session's language server stays rooted where
  the session started.

## 4. Spec location

- The knowledge base: one project per ticket at `.claude/reference/projects/<kebab-case-name>/`, in the reference-kb
  format (`plugins/reference-kb/skills/reference-kb/references/format.md`) plus what `.claude/reference/kb.toml`
  adds. The entry-point table in `.claude/reference/README.md` lists each project.
- Notes are public: generic facts only, as `.claude/reference/README.md`, "Local conventions", sets out.
- Validator: `python plugins/reference-kb/skills/reference-kb/scripts/validate.py --root .claude/reference`, and the
  same with `--stale-in origin/main..HEAD`. CI runs both; the second fails a note whose `sources` the branch changed
  without moving its `verified` date.

## 5. Agents

- Implementer `engineer`, verifier `verifier` and research agent `code-researcher`: the `delegation` plugin's
  templates adopted into `.claude/agents/` with this repository's values. Doc writer: `reference-kb:kb-writer` for
  knowledge base notes; the implementer keeps the other living docs (the table in `.claude/code-review-profile.md`)
  in step with the code. Comment sweep: `develop:comment-sweeper`.
- Ramp-up: not measured.
- Every brief adds:
  - the "Writing here" rules in `CLAUDE.md`;
  - a change to what a plugin ships raises its `version`, and a change under `harness/` raises
    `harness/harness.json`;
  - nothing is copied in from another project, and every fixture and example is synthetic.

## 6. Build, test and pre-push

- There is no build. The checks, from the root (`CLAUDE.md`, "Trying a change", has the setup):
  - Python: `ruff check .`, `ruff format --check .` and `python -m pytest -p no:cacheprovider` from the virtual
    environment.
  - A mod: load it once with `claude --plugin-dir plugins/<name>`, then `npx tsc -p plugins/<name>`,
    `npx oxlint -c .oxlintrc.json plugins/<name>` and `claude plugin test plugins/<name>`.
  - Any plugin: `claude plugin validate --strict plugins/<name>`.
  - Shell: `shellcheck` over the changed scripts, and `bats` over the `.bats` files.
  - The knowledge base: section 4's validator.
- Never run locally: none is barred. The version guard reads CI's merge checkout, so check the version rise by hand.
- Pre-push: the installed `pre-push` hook runs on every push. It checks authorship and the branch prefix, then the
  leak scan, then a `public-leak` review through `claude -p` costing about $0.10 to $0.50. Any finding above Normal,
  or any open question, refuses the push. It reads commit messages too. What CI fails that is cheapest to catch first:
  a missing version rise, `ruff format`, and a note left unverified after its sources changed.
- Duration: `CI` takes about 1.5 minutes; the label-triggered `Code review` takes 4 to 15 minutes (recent runs,
  2026-10-28).

## 7. Verification

- Method: no application runs here. A plugin change is exercised in a separate non-interactive session,
  `claude -p --plugin-dir plugins/<name> "<prompt>"`, which loads the branch's copy in place of the installed one. A
  hook or script is run against a scratch repository or input, as its bats tests do.
- Evidence: the command and the output lines that show the behaviour, in a pull request comment. It is public, so
  it holds no machine paths, session ids or private content.
- What it cannot show: interactive-only behaviour such as a mod's pane, band or toast; what an installed user gets,
  which needs the version rise and an update; and any Claude Code version other than the one run.

## 8. Shared machine resources

Not applicable: nothing here holds a device, a port or a server, and each worktree has its own `node_modules` and
virtual environment. The installed harness under `~/.claude/harness/` serves every repository on the machine and the
pre-push gate trusts it, so a build never writes to it.

## 9. Review

- Panel: the `lens-review` plugin, loaded from the pull request's own `plugins/lens-review`, with
  `.claude/code-review-profile.md` and the reviewers in `.claude/agents/code-review/`, run in CI.
- Trigger: the `code-review-requested` label on a same-repository pull request runs `/lens-review <n> auto`, posts
  a comment-type review on the head and removes the label; adding it again reruns. The workflow has no draft filter,
  so a draft is reviewed. A trivial change the owner can check at a glance skips the label and opens ready.
- Findings: the merge rule is CI green and no open Critical or High. A Normal is optional and may be declined on its
  thread with a one-line reason (`.claude/code-review-profile.md`, "Severity calibration").
- Test review: `.claude/test-review-profile.md` exists. The `test-review-requested` label runs the `test-review`
  plugin in CI over the test files the head changes, posts a comment-type review with each test fix as a suggested
  change, pushes nothing and removes the label. Add it first, and commit the fixes wanted before adding
  `code-review-requested`, so the panel reviews the tests as they will merge. Not skipped.
- External reviewer: none.
- Inline comments: one `gh api repos/Runt9-Productions/runt9-claude-harness/pulls/<n>/reviews --input <file>` with
  `event: "COMMENT"`, `commit_id`, `body` and `comments[]` of `path`, `line`, `side: "RIGHT"` and `body`. GitHub
  rejects the whole review when one comment misses the diff. No tooling posts images; evidence is text.
- Reply text: check each with `scan.sh --text <file> . origin/main` from the installed harness before posting.
  Pull request bodies go through `review-text.sh`, as in section 1.

## 10. Commit and push

- Identity: the GitHub App bot `runt9-claude-bot[bot]`, its name and email in `git config claude.botName` and
  `claude.botEmail`. Commit with
  `TZ=UTC git -c user.name="$(git config claude.botName)" -c user.email="$(git config claude.botEmail)" commit`;
  `TZ=UTC` keeps the machine's UTC offset out of the commit dates. `pre-commit` refuses any other author or
  committer.
- Messages and trailers: the trailer lines the harness supplies. A message states the change and its rule-level
  reason, with no decision ids and nothing from a private source; the pre-push review reads it.
- Remote: `bot`, the HTTPS remote the bot pushes through. `origin` is SSH and the owner's. A branch whose
  commits change `.github/workflows/`, including a merge of `main` that brings such a change in, is refused for the
  bot's token, so the owner pushes it over SSH.
- Guards: no guard hook stops destructive git commands such as a force push or `git reset --hard`. `pre-push` refuses
  only refs outside `claude/` and commits not made by the bot. The remote rules hold: the bot pushes only `claude/**`,
  and `main` takes changes only by pull request with `gate` passing and the branch up to date.
- With only the remote half present there is no standing grant: commit, push and open the pull request when the owner
  says so at the end of the task, or for the whole run where the owner has granted that.
- Pull request: `gh pr create --draft --base main --label code-review-requested --body-file <file>`. It leaves draft
  with `gh pr ready <n>` once the review has run, its Critical and High findings are fixed and pushed, every thread is
  answered and the fixed ones resolved, and the reviewer guide is posted. The owner squash-merges.

## 11. Hand-off

- Nobody reviews after the owner.
- Nothing else.
