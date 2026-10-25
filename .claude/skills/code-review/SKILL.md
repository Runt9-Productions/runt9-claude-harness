---
name: code-review
description: Reviews a diff with a panel of specialist reviewer agents chosen per-review from this repository's pool, based on what the change actually touches. Runs in a forked subagent, so the calling session's context never filters or re-ranks the findings. Writes the diff to disk so reviewers read it selectively, reports findings as Critical/High/Normal (Must/Should/Could Fix), and delivers the report wherever the profile says. Use when the user asks to review changes, review a diff, review a PR, or says "/code-review".
context: fork
allowed-tools: Bash, Read, Write, Agent
argument-hint: "[diff-target] [reviewer-id-list | default | auto]"
---

# Code review

Orchestrates a review panel.

**This skill runs in a forked subagent (`context: fork`), not in the calling session.** The caller is often the
agent that wrote the code under review, and orchestrating means deduplicating, dropping and re-ranking what the
reviewers found. Done in the author's context, that step is filtered by what the author meant to build. The fork
starts with this file and the arguments below, and none of the caller's conversation. It inherits the session's
model. Three consequences shape the phases:

- **The fork cannot ask the caller anything.** Wherever a review needs a decision from the caller, the run ends
  and returns the question, and the caller answers by invoking again.
- **Its final message is all anyone receives.**
- **That message goes to the main session, not to whoever invoked the skill.** A teammate that runs `/code-review`
  never sees the result, which is one more reason for a profile to deliver the report somewhere everyone can read.

Two inputs come from the repository:

- **`.claude/code-review-profile.md`**: how to fetch a diff, the reviewer routing table, the known-fragile
  patterns, the living docs, the severity calibration, and where the report goes.
- **`.claude/agents/code-review/**/*.md`**: the reviewer pool. Each reviewer's lens, depth, tools and model live in
  its own agent file. A reviewer's id is its `name:` frontmatter, never its path, so ids must be unique across the
  pool.

**Single-pass by design.** No reviewer re-verifies another's findings; per-finding adversarial verification costs
more than it finds here. The only extra depth is a Phase 4 deep pass, which the caller requests separately.

## Usage

`/code-review [<diff target>] [<comma-separated reviewer-id-list> | default | auto]`, both optional.

- **Diff target** omitted means uncommitted working-tree changes. Otherwise a SHA, a ref, a `<ref>..<ref>` range,
  or a PR number.
- **Panel** is a reviewer-id list, `default` for the profile's always-on set, or `auto` to choose a panel from the
  diff and run it. Omitted, the run proposes a panel and stops (Phase 2). `default` and `auto` are never diff
  targets: `/code-review auto` reviews the working tree with a chosen panel.

Arguments for this run (empty means none): `$ARGUMENTS`

## Phase 0: Resolve the profile

Read `.claude/code-review-profile.md`. If it does not exist, stop and say so: without it there is no routing table,
no always-on set and no calibration.

## Phase 1: Fetch the diff once, to disk

Create `<review-dir>` under the profile's output root, named for the target plus a timestamp so consecutive
reviews of one target do not overwrite each other.

Write the diff to `<review-dir>/diff.patch` with the profile's command for the target. Never read it into this
conversation: reviewers read it from disk, selectively, and every later step points at that one file.

Then build the manifest:

```
## Diff manifest: <target>
Diff: <review-dir>/diff.patch  (<N> lines)

| File | Lines changed | Line range in diff.patch |
|---|---|---|
| <path> | +<a>/-<b> | <start>-<end> |
```

`git diff --numstat <target>` (with the fetch's pathspec) and `grep -n '^diff --git' <review-dir>/diff.patch` give
both columns without reading the patch body. For a PR, count each file's `+`/`-` lines inside its range of
`diff.patch` instead. The line-range column lets a reviewer `Read(diff.patch, offset, limit)` straight to the files
in its lens.

If `diff.patch` is empty, stop.

A diff on disk can be read partially, or cut at `Read`'s 2000-line page, and still produce a plausible review of
the part seen. So reviewers report which manifest files they read, and Phase 5 checks that against the manifest.
Below the profile's inline threshold, put the patch in the prompt instead.

## Phase 2: Select the panel

**Caller supplied a list:** validate every id against the `name:` frontmatter of the files `find
.claude/agents/code-review -name '*.md'` lists. If an id does not resolve, stop and report which ids failed and
what the valid ones are. Then go to Phase 3.

**Caller supplied `default`:** the panel is the profile's always-on set, validated the same way, with no
confirmation step. Match the diff against the routing table anyway and list the rows it matched in the report's
Coverage, so the caller sees what the default set did not pay for. If the profile names no always-on set, stop and
say so.

**Caller supplied `auto`:** choose a panel as below, add every reviewer the profile names as the auto floor, and
go to Phase 3 without stopping. Nobody confirms an `auto` panel, so the report's Coverage carries the reasons and
the omissions the proposal would have shown.

**Caller supplied neither:** choose a panel as below, then stop. End the run with the proposal and the exact
invocation that runs it, `/code-review <target> <ids>`. Dispatch nothing.

Choosing a panel:
1. Summarize what the diff touches: paths, languages, subsystems, whether it is user-facing.
2. Match that against the profile's routing table.
3. Give each chosen reviewer one line on why this diff warrants it, plus its model from its frontmatter so the cost
   is visible.
4. State which reviewers you left out, and why. The caller can only correct an omission they can see.

No minimum or maximum. One reviewer is right for a narrow diff.

## Phase 3: Dispatch in parallel, once each

Spawn every selected reviewer in one message (`Agent`, `subagent_type: <reviewer-id>`, `run_in_background: false`),
so they run in parallel and this run waits for all of them. A background reviewer reports to the main session after
this fork has ended, so synthesis and delivery never run. The prompt carries the task,
where the diff is, the output format and the manifest, and nothing else: depth and what is worth raising belong to
each reviewer's own definition.

> You are one reviewer on a panel reviewing a single diff. Others are reviewing the same diff through different
> lenses, concurrently, and neither side sees the other's findings. Review through the lens in your agent
> definition.
>
> The diff is at `<review-dir>/diff.patch`, a plain file: read it with `Read`, and do not run `git diff` or
> re-fetch it. The manifest at the end of this prompt gives each changed file's line range inside it. `Read`
> returns at most 2000 lines per call, so paginate with `offset`/`limit` rather than stopping at the first page.
> Report in Coverage which manifest files you read and which you skipped, and why; this is checked against the
> manifest.
>
> Do not edit the checkout under review. Return your findings as your final response, in the format below.
>
> **Severity is consequence if this ships.** Not your confidence, not the size of the fix.
> - **Critical: Must Fix.** The change is wrong: breaks working behavior, corrupts or loses data, opens a security
>   hole, ships a defect a user hits. If you cannot name the input or state that triggers it, it is not Critical.
> - **High: Should Fix.** A real defect, bounded. Unhandled edge case, leaked resource, a test that cannot fail, a
>   doc or registry now inconsistent with the code. Won't bite on the happy path; will bite.
> - **Normal: Could Fix.** Correct but improvable. Leftover debug output, missing companion artifact, a structure
>   that costs the next reader time. No failure mode, just cost.
>
> ```
> ## Findings
> ### <Critical|High|Normal>: <path>:<line>
> - **Claim:** <one sentence: what is wrong>
> - **Consequence:** <the inputs or state that produce a wrong result, a crash, or a stale artifact; for a Normal
>   finding, what it costs>
> - **Evidence:** <the hunk, and any file:line you opened>
>
> ## Open Questions
> - **<path or subsystem>:** <what you could not resolve, what a deeper pass would check>
>
> ## Coverage
> - **Read:** <manifest files you read>
> - **Skipped:** <manifest files you did not read, and why>
> - **Examined:** <one or two sentences on what you looked for>
> ```
>
> If you found nothing, keep the `## Findings` header and say so under it.
>
> --- DIFF MANIFEST ---
> [manifest from Phase 1]

If the profile has a **Standing reviewer instructions** section, append it verbatim after the format and before
the manifest.

## Phase 4: Open Questions, never an automatic deep pass

Collect every reviewer's Open Questions. If there are none, skip this phase. Do not spawn anything "just in case".

Resolve a question only where another reviewer's output already answers it, and note that in one line. Every other
question goes into the report as open, naming the profile's deep-pass reviewer and what it would check. The caller
escalates by spawning that reviewer against the same `diff.patch` and manifest, scoped to the files and the
question, not a general re-review.

## Phase 5: Synthesize, do not re-verify

1. **Reconcile Coverage against the manifest.** A manifest file no reviewer read goes in `Not reviewed`. A reviewer
   whose Read list is short against the files its lens covers made a partial read; say so rather than presenting
   its findings as a full pass.
2. **Sanity-pass the findings.** Drop what a reviewer clearly got wrong (a cited line that does not exist, a misread
   hunk, a claim about code the diff did not change) and say you did. Do not spawn agents to verify findings.
3. **Deduplicate.** Two reviewers hitting one defect through different lenses is one finding with two lenses noted.
4. **Normalize severity.** Re-rank the merged list against the rubric and the profile's calibration as one list,
   since reviewers' self-assigned severities are not calibrated against each other. Where you overrode a reviewer,
   say so in a line.
5. **Write the report:**

```
# Code Review: <target>
<N> findings across <M> reviewers. <one-line verdict>
Diff reviewed: <review-dir>/diff.patch

## Critical: Must Fix
### <path>:<line>: <claim>
**Consequence:** <concrete failure, or cost>
**Evidence:** <hunk / file:line>
**Found by:** <reviewer-id>

## High: Should Fix
## Normal: Could Fix

## Open Questions
- **<question>**: <resolved from panel output | open: <deep-pass reviewer> would check <what>>

## Coverage
- **<reviewer-id>:** <read, skipped>
- **Not reviewed:** <manifest files no lens covered>
- **Matched but not run:** <routing-table rows the diff matched outside the panel, when it was `default`>
- **Chosen by `auto`:** <each reviewer and why; each left out and why>
```

Keep every severity header even when empty: "no Critical findings" is a result to state, not an absence to infer.
Name a reviewer that found nothing in Coverage rather than omitting it. A small panel did not review everything,
and the report must never read as though it did.

## Phase 6: Deliver the report

The profile decides where the report goes. If it names a destination, deliver the report there as it describes,
then end the run with a receipt: where the report went, the finding count per severity, and the path of anything
you wrote. If it names none, end the run with the full report. If delivery fails and the profile's fallback does
not cover the failure, end the run with the full report plus the error: a failed delivery must never lose the
review.

**Never edit the code under review.** Applying fixes is a separate, explicit request after the report lands.
