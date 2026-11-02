# Development profile

What the `develop` skill needs to know about this repository. Where `CLAUDE.md`, `.claude/code-review-profile.md` or
a knowledge base note already answers a question, this file points there.

## 1. Ticket tracker

- GitHub issues on `Runt9-Productions/runt9-claude-harness`. Every change, fix or feature, is an issue in the shape
  of `.github/ISSUE_TEMPLATE/change.md`; `CLAUDE.md`, "Issues and pull request text", has the rules for writing one.
- A review finding deferred from its pull request becomes an issue labelled `from-review`.
- Step 3's setup: label `bug` or `enhancement`, plus exactly one of `area:harness`, `area:ci`, `area:plugins`,
  `area:review` and `area:kb`. There are no assignment, planning or estimate fields; the estimate lives in the spec
  only.
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
- A `claude --worktree` session is confined to its worktree: it can read the main checkout but neither write files
  nor run git there (2026-10-31).
- Working directory: `.claude/output/<ticket>/` in the checkout the session works in, the ticket's worktree once one
  exists, ignored by the tracked `.gitignore`. It is scratch and goes when the worktree does: working documents that
  must last go in the spec location. No comment or doc may point at it, because no other clone has it.
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
- After a merge or checkout that changes `.claude/agents/`, a spawn waits until the session reports the updated agent
  types: Claude Code picks up a changed definition only a few seconds after it lands, and a teammate spawned before
  then runs the old definition, with no sign of it.
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
- CI watch: with `GH_TOKEN` set (section 1) and `sha` the pushed commit,

  ```
  while id=$(gh run list --commit "$sha" --workflow CI --json databaseId,createdAt \
      --jq 'max_by(.createdAt) | .databaseId // empty') && [ -z "$id" ]; do sleep 10; done
  gh run watch "$id" --exit-status
  ```

  It waits for the commit's `CI` run to exist, takes the newest because `edited` can start a second run on one head,
  and follows that run until every job, `gate` included, has finished. A `gh` error ends it non-zero. `CI` is the
  only workflow in `.github/workflows/`; CodeQL runs as GitHub's default setup outside `gate`, and the watch does not
  follow it.
- The bot cannot rerun a job, since its App lacks Actions write, so a run failed by the runner rather than the code
  is rerun by the owner or by the next push. It cannot push a change to `.github/workflows/` either (section 10). Nor
  can it command Dependabot: `@dependabot rebase` and the other commands are taken only from a user with push access,
  so the owner posts them.
- Duration: `CI` takes about 1.5 minutes (recent runs, 2026-10-28); a local code review took 8 and 16 minutes
  (two runs, 2026-10-31).

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

- Code review tool: the `lens-review` plugin, with `.claude/code-review-profile.md` and the agent and lenses in
  `.claude/agents/lens-review/` of the checkout the session runs in, run locally.
- When: the test review and the code review each run once per pull request, when it is first pushed: the test review,
  then the code review over the head that carries its fixes. A later push, after a fix round or the owner's review
  round, gets CI only; say what changed and the owner decides whether it gets another review, since a review costs far
  more than a CI run and a fix round rarely needs a whole review. A trivial pull request, such as one config line or a
  one-line doc fix, gets neither review and opens ready.
- Test review: `.claude/test-review-profile.md` exists. Run `/test-review` in the pull request's worktree before the
  code review, and commit and push the fixes wanted, so the code review reads the tests as they will merge. Skipped when
  the pull request changes no test, or its test changes are trivial enough for the owner to check at a glance.
- Code review: invoke `/lens-review <n> auto` as a skill in the session doing the work, from any checkout on any
  branch, so the owner sees the run: never a headless `claude -p` run and never a background one. The skill fetches
  the pull request's head and reads its files from the run directory, so no worktree of the pull request is needed.
  `gh` in the skill's commands needs `GH_TOKEN` (section 1). The session runs in auto mode or with prompts, never a
  bypass mode, so the review's tool calls on pull request content are judged. A refused or blocked call is skipped
  and the report still looks whole, so before posting, read the refused calls the report's coverage names; on one, run
  again or say in the posted review what went unread. The report and payload land in a run directory under the
  profile's output root. A draft is reviewed like any other pull request.
- A pull request that changes `plugins/lens-review` is reviewed by its own copy of the plugin, in a session started
  in its checkout with `claude --plugin-dir plugins/lens-review`. That session loads the head's project settings,
  hooks and plugin code, which run outside the auto-mode classifier, so it is started only on a branch of this
  repository, never a fork, and when the head adds or changes `.claude/settings*.json`, `.mcp.json` or anything under
  `plugins/lens-review/hooks/`, the owner reads that change before the session starts.
- Posting: the bot posts the result as one comment-type review from the payload the skill wrote. Run the second
  command only when GitHub rejects the first, which it does for the whole review when one comment misses the diff. It
  posts the report as the body alone, cut below GitHub's 65,536-character limit for a review body. No tooling posts
  images; evidence is text. Before either, run what would be posted through `review-text.sh` (section 1): the payload's
  text (`jq -r '.body, .comments[].body'`) and `review.md` in one file. The reviewer loads the user's own `CLAUDE.md`
  and memory, so a finding can quote them; on a hit, edit both files and check again.

  ```
  jq '.event = "COMMENT"' <run dir>/review-payload.json \
    | gh api repos/Runt9-Productions/runt9-claude-harness/pulls/<n>/reviews --input -
  gh api repos/Runt9-Productions/runt9-claude-harness/pulls/<n>/reviews -f event=COMMENT \
    -f body="$(head -c 60000 <run dir>/review.md)"
  ```

- Findings: the merge rule is CI green and no open Critical or High. A fixed Critical or High needs CI on the new
  head, not another review round. A Normal is optional: fix it in the same round, decline it on its thread with a
  one-line reason (`.claude/code-review-profile.md`, "Severity calibration"), or defer it to a `from-review` issue
  (section 1).
- External reviewer: none.
- Public text: pull request bodies, reviewer guides and replies say what a change does and why in terms of the
  behaviour it targets, never where a rule came from: not the machine it was measured on, the owner's own setup or
  tools, or what was left out for them, since naming what was kept out reveals it. The scans catch identifiers and
  secrets, not such descriptions. Check a pull request body or a reviewer guide with `review-text.sh` (section 1), and
  a reply with `scan.sh --text <file> . origin/main` from the installed harness, before posting.

## 10. Commit and push

- Identity: the GitHub App bot `runt9-claude-bot[bot]`, its name and email in `git config claude.botName` and
  `claude.botEmail`. Commit with
  `TZ=UTC git -c user.name="$(git config claude.botName)" -c user.email="$(git config claude.botEmail)" commit`;
  `TZ=UTC` keeps the machine's UTC offset out of the commit dates. `pre-commit` refuses any other author or
  committer.
- Messages and trailers: the trailer lines the harness supplies. A message states the change and its rule-level
  reason, with no decision ids and nothing from a private source; the pre-push review reads it.
- Remote: `bot`, the HTTPS remote the bot pushes through. `origin` is SSH and the owner's. A push that
  adds a commit changing `.github/workflows/`, including a merge of `main` that brings such a change in, is refused
  for the bot's token, so the owner makes that push over SSH. Later pushes that add no such commit go through `bot`.
- Guards: no guard hook stops destructive git commands such as a force push or `git reset --hard`. `pre-push` refuses
  only refs outside `claude/` and commits not made by the bot. The remote rules hold: the bot pushes only `claude/**`,
  and `main` takes changes only by pull request with `gate` passing and the branch up to date.
- With only the remote half present there is no standing grant: commit, push and open the pull request when the owner
  says so at the end of the task, or for the whole run where the owner has granted that.
- Pull request: `gh pr create --draft --base main --body-file <file>`, then the test review and the code review
  (section 9; a trivial pull request skips both and the draft). It leaves draft with `gh pr ready <n>` once the
  review has run, its Critical and High findings are fixed and pushed, every thread is answered and resolved as the
  develop skill's step 8 says, and the reviewer guide is posted. The owner squash-merges.

## 11. Hand-off

- Nobody reviews after the owner.
- Nothing else.
