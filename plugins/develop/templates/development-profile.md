# Development profile

<!--
Copy this file to .claude/development-profile.md in your repository and fill in every section. Write "not
applicable" in one line rather than leaving a section empty, so a section that does not apply looks different from
one nobody filled in. Where the repository's own docs already answer a question, point to them instead of repeating
them. Whether this file is tracked in git is your repository's choice.
-->

## 1. Ticket tracker

- Which tracker, and its site.
- How work for this repository shows up there.
- Step 3's setup updates: assignment, planning fields, and which estimate fields to ask for.
- The "work started" update in step 4.
- Transitions the tracker's automation already makes.
- What to do when the tracker connection fails.

## 2. Branches

- The base ref pull requests target and diff against.
- Branch naming.
- Whether a branch that lags its base is merged up before pushing.
- Any trap in the base, such as a default branch that is stale.

## 3. Worktree and working directory

- How the build checkout is made and named. Built-in worktrees need the repository's `.worktreeinclude` and the
  `worktree.symlinkDirectories` and `worktree.baseRef` settings it requires; these live in the repository's settings
  because a plugin cannot set worktree options.
- What renaming the worktree's branch changes about cleaning it up.
- What the worktree shares with the main checkout, and whether writes through it work.
- Where the working directory is in the main checkout (default `.claude/output/<ticket>/`, which must be
  git-excluded).
- Whether building needs a fresh session started in the worktree, and its start command.

## 4. Spec location

- A knowledge base project, or another place.
- Naming, format, and the validator to run.

## 5. Agents

- Implementer, verifier, doc writer, comment sweep (default `develop:comment-sweeper`) and research agents, each by
  the id it is spawned as. A `delegation` template is not one until it is copied into `.claude/agents/` and filled in.
- The ramp-up an agent spends before useful work, which task sizing in step 2 assumes.
- Anything a brief must add to an agent's definition.

## 6. Build, test and pre-push

- The build and test commands.
- Suites never run locally.
- The pre-push step CI checks for.
- The CI watch: one command that waits on a pushed head's checks and exits non-zero when one fails. Every push
  starts it in the background.
- How long a CI run takes, so a watch that runs far longer stands out.

## 7. Verification

- Method: an agent driving the user interface, a script over seeded data, or none.
- The evidence a reviewer should see.
- What the method cannot show.

## 8. Shared machine resources

- What sessions compete for (a device, a port, a server, a build directory).
- How to find who holds it.
- Checks to run before using it.

## 9. Review

- The panel review: the `lens-review` skill (the default) and whether its profile exists, or the repository's own.
- How the panel review is triggered: invoked locally with a panel, or a CI trigger such as a label. If the trigger
  skips draft pull requests, section 10's draft rule must allow for it.
- Whether a test-review profile exists, and whether to skip test review.
- The external reviewer, if any, and who requests it.
- Tooling for posting inline review comments and images.

## 10. Commit and push

- Commit identity and trailer lines.
- The remote to push to.
- Whether guard hooks block destructive git commands, and whether remote rules block pushes to protected branches.
  A standing grant to commit, push and open the draft pull request needs both.
- When the pull request leaves draft. With nothing stated, it leaves only on the owner's explicit approval.

## 11. Hand-off

- Who reviews after the owner.
- Anything else this repository needs at hand-off.
