---
name: code-review
description: Runs this repository's reviewer panel over one change (the working tree, a commit, a range or a pull request), merges what the reviewers find into a single graded report, and delivers it as the repo's review profile directs. Use for "/code-review", "review my changes", "review this diff", "review PR 12", "look over this branch before I merge", or any request to check a change for defects before it ships.
argument-hint: "[<sha> | <ref> | <a>..<b> | <pr number>] [<id>,<id>... | default | auto] [-- <open question>]"
context: fork
allowed-tools: Bash, Read, Write, Agent
---

# /code-review

Arguments: `$ARGUMENTS`

You coordinate a panel of reviewer agents over one diff and turn their output into one report. You do not review the
code yourself, and you never edit it.

## Why this runs in a fork

Whoever calls this skill usually wrote the change. If findings were weighed and merged in that session, the author's
own reasoning would shape which ones survive. So the skill runs in a forked context, and three things follow:

- You cannot ask the caller anything. When you need an answer to continue, end with the question; the caller answers
  by invoking the skill again.
- Only your final message leaves the fork. Put everything the caller needs in it.
- That message goes to the lead session, even when a teammate invoked the skill.

## 1. Read the profile

Read `.claude/code-review-profile.md` in full. If it does not exist, stop and say so: every later step depends on it.

## 2. Parse the arguments

Every argument is optional.

- **Target**, at most one token. None means the working tree. A token containing `..` is a range. A token of digits
  only is a pull request number. Anything else is a commit, given as a SHA or a ref.
- **Panel**. `default`, `auto`, or reviewer ids separated by commas. `default` and `auto` are panel words, never
  targets, even when they come first.
- **Deep pass**. Text after `--` is one open question from an earlier run. Run only the profile's deep-pass reviewer,
  scoped to that question (step 6).

List the pool. Every `.md` under `.claude/agents/code-review/`, at any depth, is a reviewer, and its id is its
frontmatter `name`:

```bash
find .claude/agents/code-review -name '*.md' -print0 | while IFS= read -r -d '' file; do
    printf '%s\t%s\t%s\n' "$(sed -n '2,/^---$/s/^name: //p' "$file")" \
        "$(sed -n '2,/^---$/s/^model: //p' "$file")" "$file"
done
```

Stop, with the reason, when an id given does not match one in the pool (list the valid ids), or when the panel is
`default` and the profile names no always-on reviewers.

## 3. Fetch the diff once

Fetch it with the profile's commands, into a new directory for this run, and never read it into your own context
except to inline it in step 6. Fill in the first three values and run:

```bash
set -euo pipefail
label='worktree'                # worktree, the SHA or ref, the range, or pr-<n>
pr=''                           # the number, for a pull request target
fetch() { git diff HEAD; }      # the profile's command, for any other target
root=${CODE_REVIEW_OUTPUT:-.claude/output/code-review}
mkdir -p "$root"
dir=$(mktemp -d "$root/$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '_')-$(date -u +%Y%m%dT%H%M%SZ)-XXXX")
if [[ -n $pr ]]; then
    # The payload names the head the diff came from, so fetch again if a push lands in between.
    for _ in 1 2 3; do
        before=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
        gh pr diff "$pr" > "$dir/patch.diff"
        after=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
        if [[ $before == "$after" ]]; then
            printf '%s\n' "$after" > "$dir/head-sha"
            break
        fi
    done
    gh pr view "$pr" --json commits,body > "$dir/pr.json"
else
    fetch > "$dir/patch.diff"
fi
[[ -s $dir/patch.diff ]] || { echo "empty diff"; exit 3; }
echo "$dir"
```

The root line is this repo's; use the output root the profile names. An empty diff ends the run with that message.
Every later block runs in a new shell, so start each by setting `dir` to the path this one printed. When a pull
request has no `head-sha`, it kept moving; leave `commit_id` out of the payload.

A merge commit as target prints a combined diff, which the index below cannot read. Fetch it as the range
`<sha>^1..<sha>` instead and say so in the report.

## 4. Index the diff without reading it

Run this on the run directory. It writes `manifest.tsv` (per file: lines added, lines removed, the file's line span
inside `patch.diff`, and the path) and `hunks.txt` (per file: the new-side line spans its hunks cover, comma
separated, or `-` for none, then the path). It prints the patch's line count.

```bash
set -euo pipefail
dir='<run directory>'
cd "$dir"
# git apply reads a patch without applying it and prints each file's raw path, NUL-terminated, so quoting and the
# tab git adds after a path with a space never reach the parsing below. Its records come in patch order.
mapfile -d '' records < <(git apply --numstat -z < patch.diff)
# One line per `diff --git` section: its first and last line in patch.diff, then the new-side spans of its hunks.
mapfile -t sections < <(awk '
    /^diff --git / { n++; start[n] = NR; if (n > 1) end[n - 1] = NR - 1; next }
    n && /^@@+ / && match($0, /\+[0-9]+(,[0-9]+)?/) {
        k = split(substr($0, RSTART + 1, RLENGTH - 1), part, ",")
        count = k > 1 ? part[2] + 0 : 1
        if (count > 0) spans[n] = spans[n] (spans[n] == "" ? "" : ",") part[1] "-" (part[1] + count - 1)
    }
    END { end[n] = NR; for (i = 1; i <= n; i++) printf "%d\t%d\t%s\n", start[i], end[i], spans[i] }
' patch.diff)
if (( ${#records[@]} != ${#sections[@]} )); then
    echo "index: git apply found ${#records[@]} files but the patch has ${#sections[@]} sections" >&2
    exit 1
fi
: > manifest.tsv
: > hunks.txt
for i in "${!records[@]}"; do
    added=${records[i]%%$'\t'*}
    rest=${records[i]#*$'\t'}
    removed=${rest%%$'\t'*}
    path=${rest#*$'\t'}
    IFS=$'\t' read -r start end spans <<< "${sections[i]}"
    printf '%s\t%s\t%s-%s\t%s\n' "$added" "$removed" "$start" "$end" "$path" >> manifest.tsv
    printf '%s\t%s\n' "${spans:--}" "$path" >> hunks.txt
done
wc -l < patch.diff
```

If it fails, stop and report the error; a review placed from a wrong index puts comments on the wrong lines.

## 5. Choose the panel

Match the manifest's paths, and the kind of code they hold, against the profile's routing table.

- **No panel argument**: dispatch nothing. End with a proposal: one or two sentences on what the diff touches; each
  reviewer you would pick, with one reason and its frontmatter model; each reviewer you would leave out, with why;
  and the exact command that runs your pick. Any size of panel is fine.
- **`default`**: the profile's always-on reviewers. Still run the routing match, and list in the report every row that
  matched but was not run.
- **`auto`**: the always-on reviewers plus every routing match, dispatched without asking. The report says why each
  reviewer ran and why each one in the pool did not.
- **An id list**: exactly those reviewers.

## 6. Dispatch

Send every reviewer in one message, as parallel Agent calls with `subagent_type` set to its id and
`run_in_background: false`. A reviewer left in the background would report after the fork has ended. Do not pass
`model`; each reviewer's frontmatter sets it.

Each prompt holds these parts and nothing else:

1. The task: review this diff.
2. Where the diff is: `$dir/patch.diff`, plus `$dir/pr.json` for a pull request. When the patch is under the
   profile's inline threshold, put the diff itself in the prompt instead.
3. The severity rubric below.
4. The response format below.
5. The profile's "Standing instructions" section, copied word for word.
6. The contents of `manifest.tsv`.

Leave out any word on depth, focus, priorities or what you expect to be found. Each reviewer's own file sets those,
and the reviewer brief tells them to refuse a prompt that steers.

For a deep pass, send only the profile's deep-pass reviewer, with the parts above plus the open question quoted as
the earlier report gave it and the files it involves.

**Severity rubric.**
- Critical (Must Fix): merging it ships something broken, unsafe or private.
- High (Should Fix): a real defect or cost that should be fixed before merge, unless the owner accepts it.
- Normal (Could Fix): worth fixing, and fine to defer.
Use the profile's "Severity calibration" for what each level looks like here.

**Response format.**
- Findings, each with: severity; location as `path:line`, using the new-side line number; the claim; what goes
  wrong because of it; and the evidence, meaning the lines opened and what they show.
- Open questions: what is unknown, why it matters, and what would settle it.
- Coverage: each file read whole, each read in part with the line ranges, and each skipped. When the diff was on
  disk, give the line ranges of `patch.diff` read.

## 7. Synthesize

This is a single pass. No reviewer checks another's work, and you do not send findings back out.

1. **Coverage.** Compare the reviewers' coverage with the manifest. Name every changed file no reviewer read, and,
   when the diff was on disk, every file whose span in `patch.diff` no reviewer read in full.
2. **Open questions.** Settle one only from another reviewer's output, and cite it. Every other question goes in the
   report with the command that sends it to the deep-pass reviewer: `/code-review <target> -- <question>`.
3. **Wrong findings.** Drop any finding that is plainly wrong on its own evidence, and list each dropped one with the
   reason.
4. **Duplicates.** Merge findings that describe the same defect into one, crediting every reviewer that raised it.
5. **Grades.** Grade the combined set again with the rubric and the profile's calibration. When reviewers disagree,
   `principal-review`'s grade weighs most. For each finding whose final severity differs from a reviewer's, add one
   line saying what changed and why.

The report has a Critical, a High and a Normal heading, each present even when empty. It names every reviewer that
ran, and says what the panel did not cover; never write it as if a small panel saw everything.

## 8. Deliver

Follow the profile's "Delivery" section.

Whether a finding goes inline is a lookup, not a judgment. A finding goes inline only when its line falls inside a
span listed for its path in `hunks.txt`; every other finding stays in the body alone. Check each one with:

```bash
dir='<run directory>'
# Exit 0 when line $LINE of $FILE lies inside one of its hunks. The values travel through the environment because
# awk -v would rewrite backslashes in a path.
FILE='path/from/finding' LINE=42 awk -F'\t' '
    BEGIN { want = ENVIRON["FILE"]; line = ENVIRON["LINE"] + 0 }
    { path = $0; sub(/^[^\t]*\t/, "", path) }
    path == want {
        n = split($1, span, ",")
        for (i = 1; i <= n; i++) if (split(span[i], b, "-") == 2 && line >= b[1] + 0 && line <= b[2] + 0) hit = 1
    }
    END { exit !hit }
' "$dir/hunks.txt"
```

Check any JSON you write with `jq empty <file>` before ending.

- When the profile names a destination, end with a receipt: where the review went, the number of findings at each
  severity, and every path written.
- When it names none, end with the report itself.
- When delivery fails and the profile gives no fallback for it, end with the report and the error.
