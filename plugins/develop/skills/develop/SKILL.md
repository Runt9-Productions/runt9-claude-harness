---
name: develop
description: Runs one ticket through the whole development process, from investigating it to a reviewed draft pull request and then the owner's review rounds, taking everything project-specific from the repository's development profile. Use it when someone invokes it with a ticket, asks to "work this ticket", "build this ticket end to end", "get this ticket to a PR", "make the worktree for this ticket", "carry on with this ticket" or "resume the ticket", and when they ask for one step by number or by name, such as "run step 7" or "post the reviewer guide on this PR". Use it even when only a single step is wanted, since every step depends on state the others leave.
argument-hint: <ticket> [step number]
allowed-tools: Read(~/.claude/local/develop/**)
---

# Develop

Twelve numbered steps take one ticket from investigation to a draft pull request that has been reviewed, then
through the owner's review of it. The numbers never change, because resume lines and the handoff cite them. Given a
step number, start there; see "Starting mid-process".

## Definitions

- **Owner**: whoever owns the repository and reviews its pull requests. A value only the invoking user can supply,
  such as an estimate field, is asked of the person running the skill, who is not always the owner.
- **Development profile**: `.claude/development-profile.md` in the repository holding the ticket's code, which may
  not be the repository the session started in. "Section N" below means that section of it. With no profile, stop
  and name the template, `${CLAUDE_PLUGIN_ROOT}/templates/development-profile.md`. A filled profile never goes inside
  the plugin directory, because an update replaces that directory.
- **Spec location**: where steps 1 and 2 write the plan and every later step reads it. In a repository with a
  reference knowledge base it is the ticket's project under the knowledge base's `projects/` tree, written to the
  `reference-kb` skill's format (load that skill first):
  - `overview.md`: the goal and the designs ruled out, each with why.
  - `decisions.md`: settled decisions with their ids, and open questions.
  - `checklist.md`: the engineer tasks, one deliverable commit each. Steps 5 to 12 are not deliverable commits, so
    their progress lives in the task-progress tool or the checklist's status section.
  - `spec.md`: the per-file implementation map and the draft ticket description.
  - `research/`: the estimate, as a note.

  Without a knowledge base, section 4 names the location and its format.
- **Working directory**: per-ticket scratch that section 3 names, defaulting to `.claude/output/<ticket>/` when that
  path is git-excluded. It always lies in the main checkout, never in a worktree, and once a worktree exists it is
  named by its absolute path, in briefs, the handoff and resume lines alike: removing a worktree deletes everything
  inside it. It holds task results, saved review reports, evidence, the three lists below and the handoff. Anything
  a later step relies on goes here, because it must outlive the teammate that produced it.
- **Decision tools**: the tools the "Decision tools" section at the end names for four kinds of output: decisions,
  owner tasks, task progress and the status line. Where it names none for a kind, decisions are asked in chat, owner
  tasks go in the final report, and progress is kept in the spec location's checklist.
- **The three lists**: `reviewer-notes.md` (notes for the human reviewer, including every owner request that the
  pull request mention something), `pending-strings.md` (user-facing strings still awaiting product sign-off) and
  `accepted-gaps.md` (gaps the owner has accepted), all in the working directory. Each is started with its first
  entry and added to as entries arise, because lists assembled at the end miss entries.

## Standing rules

- **Teammates.** Load the `delegation` skill before the first spawn and follow it for spawning, briefing, replying
  to and stopping teammates. This skill adds only what is particular to the process and repeats none of it, because
  two copies of a rule drift apart.
- **Owner choices.** One decision per decision-tool call, the recommended option first, each written so it reads
  cold. Anything only the owner can do is an owner task. Work that does not depend on the answer carries on. A
  reversible choice with no reply yet is acted on as recommended, and the decision records that it was. A dismissal
  or silence means "later", not "no". Work proceeds while the owner is away, and every choice stays where they will
  find it.
- **Commit, push and the draft pull request.** These are granted for the whole run only when section 10 declares
  both guard hooks that stop destructive git commands and remote rules that stop pushes to protected branches.
  Without both, ask before each push. A standing grant is safe only when something outside the model rejects a bad
  push. Commit identity and trailer lines come from section 10. Merging is never this skill's. The pull request
  leaves draft when section 10 says, and on the owner's explicit approval where it says nothing.
- **Effort, never duration.** Size work in files, lines and complexity, and tell every briefed teammate the same; a
  model's time figure has no grounding. A ticket type that implies a duration is the owner's choice.
- **Paste text that needs approval.** A ticket body, a pull request body or user-facing copy is shown in full, never
  summarised, because people approve a summary without reading the text it stands for.

## The steps

### 1. Investigate and estimate

Use the `effort-estimate` skill, or an estimate already on the ticket or in the spec location. Record each design
the owner rejects, with the reason, so no later task reopens it.

Exit: a chosen design and an estimate that fits it.

### 2. Spec

Write to the spec location: the goal; the decisions settled so far, with ids; the rejected designs; the task list;
a per-file implementation map; the estimate; a draft ticket description.

Size each task so one engineer, after the ramp-up section 5 states, finishes below the degradation point the
`delegation` skill gives. Tasks run in order unless the list marks them independent. Paste the draft ticket text in
full, and send it only once the owner approves it.

### 3. Set up

Make no writes until the owner has settled this step's decisions, and tell them up front that this step needs them
present.

- **Ticket.** Reconcile the spec with the ticket (body, links and the fields section 1 lists). Show the planned
  ticket changes, then make section 1's setup updates. Ask the person running the skill for the estimate fields
  alongside the effort estimate; never invent them. If the tracker cannot be reached, file an owner task and carry
  on. How a tracker is driven is not this skill's concern; it owns only when the updates happen and that drafts are
  shown first.
- **Capacity.** Check section 8's shared resources, and file an owner task when a build will not fit.
- **Decisions.** Post the edit scope (the paths the build may write, the knowledge base included) and every open
  question from the spec.
- **Worktree.** Use Claude Code's built-in worktrees; this process adds no worktree hook. The repository's
  `.worktreeinclude` copies files into a new worktree, `worktree.symlinkDirectories` links directories, and
  `worktree.baseRef` picks `fresh` (the remote default branch) or `head` (the current HEAD). All three apply to
  `--worktree` sessions and `isolation: "worktree"` agents alike. Name the worktree after the ticket.
  - When section 3 requires a fresh build session, do not create the worktree here. The start command
    `claude --worktree <name>` creates it, and the same command later re-enters it with its commits, files and
    renamed branch intact, so it also serves to resume. The build session renames the branch, runs the base check
    and brings the spec into the branch before anything else.
  - Otherwise create it in this session with the `EnterWorktree` tool, then rename, check and bring the spec in.
- **Branch.** Rename the built-in's branch to section 2's pattern with `git branch -m`. Section 3 says what the
  rename changes about cleanup.
- **Base check.** Before the first commit, compare the worktree's HEAD with the base ref from section 2, freshly
  fetched. The built-in starts from the remote default branch or the current HEAD and knows nothing of the ticket's
  base, so a stacked or feature base would otherwise drag foreign commits into the pull request unnoticed. On a
  mismatch, stop: report both commits and the intended base, and touch nothing until the owner replies.
- **Spec into the branch.** A new worktree holds none of the uncommitted files in the main checkout. When the spec
  location is tracked in git, the session in the worktree copies each file steps 1 and 2 added or changed there from
  the main checkout to the same path, commits them as the branch's first commit, then takes them out of the main
  checkout (deleting added files, restoring changed ones), where they would otherwise block the merge that later
  brings the branch back. Until then, and wherever the spec is untracked, it reads the spec from the main checkout.
- **Task progress.** The session that does the build posts the task-progress items: one per spec task, then steps 5
  to 12. When section 3 requires a fresh build session in the worktree, write the handoff and end here, giving the
  owner the start command and the line that resumes at step 4, which names the handoff by its absolute path. A
  session's language server stays rooted where the session started, so from anywhere else it answers wrongly about
  the branch and raises no error.
- **Handoff.** Write `handoff.md` in the working directory, because decision-tool state may not carry across
  sessions and this file is the bridge. Every path in it is absolute. It holds:
  - the ticket, the repository, the main checkout, the worktree path, the branch and the base commit;
  - the working directory;
  - the spec paths in the main checkout, and the first task;
  - every decision so far with its id, the owner's answer and any note, quoted;
  - the ticket changes made, the estimate value included;
  - owner tasks still open, and capacity notes;
  - what the build session does first.

Exit: every decision answered and step 4 unblocked.

### 4. Develop, one task at a time

The build session opens by reading the handoff, making one trial write into the working directory to prove it has
access, posting the task-progress items, and making section 1's "work started" ticket update.

For each task, spawn the implementer section 5 names. A `delegation` template is not an agent until it is copied
into `.claude/agents/` and filled in, so with no adopted implementer named, stop and point at that plugin's
`templates/engineer.md`. The brief holds only what the engineer cannot discover:

- the spec paths, and the previous task's result file;
- the write scope settled in step 3;
- which decisions stay with the lead: scope, accepting a known gap, and sequencing builds;
- stage by path and make no commits;
- questions go to the lead;
- the deliverable, `task<N>-result.md` in the working directory, covering the change and its reason, new tests split
  by whether they fail without the change, reviewer notes, manual checks against the running application, and any
  spec errors found.

When the engineer reports: read the result file, confirm the build outcome from the build tool rather than from the
report, commit, fold the result into the plan, move its reviewer notes into `reviewer-notes.md`, and stop the
engineer. A scope ruling made mid-task goes into the plan before the next spawn. When an engineer dies, save its
uncommitted diff as a patch and hand that to its replacement.

Exit: every task committed and the relevant suites green.

### 5. Verify

Section 7 picks the method: section 5's verifier driving the manual checks (the `delegation` plugin's
`templates/verifier.md`, adopted, is a starting point), a script over seeded data, or nothing. First check who holds any
shared server. Evidence must be something a reviewer can see: each new or altered UI state, or sample output.
Problems found become tasks through step 4. An old bug the change exposes is a decision: repair it here, or open a
separate issue.

### 6. Push and open a draft pull request

Run section 6's pre-push step. Check how far the branch lags its base, and merge the base in if section 2 asks for
that. Push, then open a draft pull request against the base with its body read from a file. Follow CI, trusting only
the runs for the newest head.

### 7. Test review, then panel review

If the repository has `.claude/test-review-profile.md`, the `test-review` skill is installed and section 9 does not
opt out, run `/test-review` first.

Then run the panel review section 9 names on the pull request, the way it says: invoked locally with a panel, or
through a CI trigger such as a label. Where it names none, the panel is the `lens-review` skill; if that is not
installed, stop and name the `lens-review` plugin. Invoked without a panel, `lens-review` stops after proposing one,
on purpose. Invoke it again with that proposal plus any additions, and give a reason for each proposed reviewer left
out.

Author notes wait until this step is done, because reviewers anchor on them. A review that runs after step 10 is
told those notes are not established fact. The review runs in a fork and returns its report as text: save it in the
working directory, where it is the only full copy, and post from it if the fork did not.

### 8. Fix

Findings are claims to weigh, not orders, Normal ones most of all, and they get the same doubt the reviewers gave the
code. Decline a finding with a one-line reason on its thread when the case it guards cannot occur in honest use or
the added code costs more than it protects. The target is clean, defensible code, not perfection.

One engineer handles the unambiguous findings and CI failures. Anything that needs judgment becomes a decision, and
is flagged when it reverses something the owner was told earlier. Answer every thread and resolve the fixed ones.

Before pushing, run the comment sweep: spawn `develop:comment-sweeper` unless section 5 names a substitute, and move
any reviewer justification it hands back into `reviewer-notes.md`. Section 5's doc writer brings the docs up to date
from the current code.

### 9. External review

Only when section 9 names an external reviewer: file an owner task to request the review, wait for it, and treat
its findings as in step 8. A clean panel is no reason to skip it, because outside reviewers find what the panel does
not.

### 10. Reviewer guide

Post only against a head whose CI passes, since notes on code that moves afterwards mislead. Re-check every entry in
`reviewer-notes.md` against the current code, then post them as a single review of inline comments with section 9's
tooling. Typical subjects, as illustrations only: code whose purpose is not evident, a summary above a dense block,
behaviour that differs from before, a risk taken on purpose, an accepted gap, and deleted code with its replacement
or proof it was unused.

Evidence goes in a separate pull request comment, and every image is looked at before it is posted. Drafting the
notes often exposes a behaviour change nobody decided on; that becomes a decision before its note is posted.

### 11. Hand off

- File an owner task for human review, naming any companion pull requests.
- List the entries in `pending-strings.md` as bullets ready to paste.
- Record the actual size next to the estimate: files, and lines added and removed against the base, production and
  test separately, plus one line on what the estimate missed. That record is how estimates get calibrated.
- Rewrite the ticket description to describe the final result rather than the progress.
- Update the plan and the handoff, and set the status to say who is waiting on whom.

### 12. Review loop

Classify each incoming comment as a fix, an answer or a decision. An engineer makes the fixes. A design change sends
the work back through steps 4 to 8, with a new panel. Every push in this step refreshes the step 10 notes and
evidence it made stale. When the host rejects a review because the owner has an unsubmitted one, ask them to submit
it. The pull request still leaves draft only as the standing rules say.

## Starting mid-process

Given a step number, first read the spec, the working directory and the decision tools' current state, then have the
owner confirm the state the earlier steps left before doing anything.

## Resuming

After a compaction or in a new session, read in this order: the decision tools' state, the plan, the handoff, the
newest task result. Task-progress state that should exist and does not means a new session; rebuild it from the
handoff and the plan. Then give the owner a short report of where things stand and the next action, and wait for
their go-ahead.

## Decision tools

Tools named on this machine for each kind of output. `(none)`, a kind left blank, or a named tool this session does
not have (not in the tool list, nor loadable as a deferred tool) means the chat fallback in "Definitions" for that
kind.

!`cat ~/.claude/local/develop/decision-tools.md 2>/dev/null || echo "(none)"`

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/develop/additions.md 2>/dev/null || echo "(none)"`
