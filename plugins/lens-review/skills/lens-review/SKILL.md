---
name: lens-review
description: Reviews one change (the working tree, a commit, a range or a pull request) through the repository's lenses in a single reviewer pass, and delivers one graded report as the repo's review profile directs. Use for "/lens-review", "review my changes", "review this diff", "review PR 12", or any request to check a change for defects before it ships.
argument-hint: "[<sha> | <ref> | <a>..<b> | <pr number>] [auto | default | <id>,<id>...]"
context: fork
agent: lens-review
allowed-tools: Bash, Read, Write
---

# /lens-review

Arguments: `$ARGUMENTS`

You are reviewing one change. Nobody who wrote it is in this conversation, and nothing here tells you what to
conclude.

## 1. Read the profile and the brief, and parse the arguments

Read `.claude/code-review-profile.md` in full. If it does not exist, stop and say so, pointing at "Setting a
repository up" in `${CLAUDE_PLUGIN_ROOT}/README.md`.

Read the reviewer brief, `${CLAUDE_PLUGIN_ROOT}/skills/lens-review/references/reviewer-brief.md`, and follow it. If it
cannot be read, stop and say so.

Every argument is optional.

- **Target**, at most one token. None means the working tree. A token containing `..` is a range. A token of digits
  only is a pull request number. Anything else is a commit, given as a SHA or a ref.
- **Lenses**: `auto`, `default`, or lens ids separated by commas. None means `auto`. `auto` and `default` are lens
  words, never targets, even when they come first.

## 2. Fetch the diff once

Fetch it with the profile's commands, into a new directory for this run, and never read it into your own context
except to review it. Fill in the first four values and run:

```bash
set -euo pipefail
label='worktree'                # worktree, the SHA or ref, the range, or pr-<n>
pr=''                           # the number, for a pull request target
fetch() { git diff HEAD; }      # the profile's command, for any other target
root="<output root>"            # the profile's "Output" root; a variable it names stays a shell expansion
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
    # Reviewers read files on disk, so a checkout of another commit puts their line numbers on the wrong text. In a
    # merge checkout the PR head is HEAD^2.
    if [[ -s $dir/head-sha ]]; then
        head=$(< "$dir/head-sha")
        if [[ $(git rev-parse HEAD) != "$head" && $(git rev-parse -q --verify 'HEAD^2' || true) != "$head" ]]; then
            echo "the checkout is not the PR head $head"
            exit 4
        fi
    fi
    gh pr view "$pr" --json commits,body > "$dir/pr.json"
else
    fetch > "$dir/patch.diff"
fi
[[ -s $dir/patch.diff ]] || { echo "empty diff"; exit 3; }
echo "$dir"
```

An empty diff ends the run with that message, and so does a checkout that is not the PR's head: check out the head, or
its merge, and run again.
Every later block runs in a new shell, so start each by setting `dir` to the path this one printed. When a pull
request has no `head-sha`, it kept moving; leave `commit_id` out of the payload.

A merge commit as target prints a combined diff, which the index below cannot read. Fetch it as the range
`<sha>^1..<sha>` instead and say so in the report.

## 3. Index the diff without reading it

Run this on the run directory. It writes `manifest.tsv` (per file: lines added, lines removed, the file's line span
inside `patch.diff`, and the path) and `hunks.txt` (per file: the new-side line spans its hunks cover, comma
separated, or `-` for none, then the path). It prints the patch's line count.

<!-- Claude Code replaces a dollar sign before a digit with an argument when it loads a skill, so every awk field in
this file carries a backslash, which the load removes. -->

```bash
set -euo pipefail
dir='<run directory>'
cd "$dir"
# git apply reads a patch without applying it and prints each file's raw path, NUL-terminated, so quoting and the
# tab git adds after a path with a space never reach the parsing below. Its records come in patch order. Inside a
# checkout it drops every path outside the current directory, so the ceiling keeps it from finding one above this.
mapfile -d '' records < <(GIT_CEILING_DIRECTORIES=${PWD%/*} git apply --numstat -z < patch.diff)
# One line per `diff --git` section: its first and last line in patch.diff, then the new-side spans of its hunks.
mapfile -t sections < <(awk '
    /^diff --git / { n++; start[n] = NR; if (n > 1) end[n - 1] = NR - 1; next }
    n && /^@@+ / && match(\$0, /\+[0-9]+(,[0-9]+)?/) {
        k = split(substr(\$0, RSTART + 1, RLENGTH - 1), part, ",")
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
    # Both files hold one tab-separated record per line, so such a path could forge a record of its own.
    if [[ $path == *[$'\t\n']* ]]; then
        echo "index: a path holds a tab or newline, which the index cannot carry: ${path@Q}" >&2
        exit 1
    fi
    IFS=$'\t' read -r start end spans <<< "${sections[i]}"
    printf '%s\t%s\t%s-%s\t%s\n' "$added" "$removed" "$start" "$end" "$path" >> manifest.tsv
    printf '%s\t%s\n' "${spans:--}" "$path" >> hunks.txt
done
wc -l < patch.diff
```

If it fails, stop and report the error; a review placed from a wrong index puts comments on the wrong lines.

## 4. Choose your lenses

Your lens directory is `.claude/agents/lens-review/reference/`. List its lenses, each id with its one-line summary:

```bash
for file in .claude/agents/lens-review/reference/*.md; do
    [[ -e $file ]] || { echo "no lenses"; exit 3; }
    id=${file##*/}
    printf '%s\t%s\n' "${id%.md}" "$(sed -n '2,$ { /[^[:space:]]/ { p; q; } }' "$file")"
done
```

- **`auto`**: apply every lens the profile's "Lenses" section lists as default, and every lens whose routing row
  matches the diff's paths or the kind of code they hold; those rows are binding. Apply any other lens your judgment
  says this change needs.
- **`default`**: exactly the profile's default lenses. The report also names each routing row that matched and so
  did not run.
- **An id list**: exactly those lenses.

The report says which lenses you applied, which you left out and why.

Stop, with the reason, when the directory holds no lens, when an id given is not one listed (name the valid ids), or
when the lenses are `default` and the profile names none.

## 5. Review

Review the diff with the lenses you chose, as your instructions describe, reading the files around each hunk.

**Severity rubric.**
- Critical (Must Fix): merging it ships something broken, unsafe or private.
- High (Should Fix): a real defect or cost that should be fixed before merge, unless the owner (whoever rules on
  this repository's reviews) accepts it.
- Normal (Could Fix): worth fixing, and fine to defer.
Use the profile's "Severity calibration" for what each level looks like here.

**Response format.**
- Findings, each with: severity; location as `path:line`, using the new-side line number; the claim; what goes
  wrong because of it; and the evidence, meaning the lines opened and what they show.
- Open questions: what is unknown, why it matters, and what would settle it.
- Coverage: each file read whole, each read in part with the line ranges, and each skipped. When the diff was on
  disk, give the line ranges of `patch.diff` read.

The report has a Critical, a High and a Normal heading, each present even when empty, then the open questions, then
which lenses you applied and left out, then coverage: each changed file read whole, read in part (with ranges) or
skipped.

## 6. Deliver

Follow the profile's "Delivery" section.

Whether a finding goes inline is a lookup, not a judgment. A finding goes inline only when its line falls inside a
span listed for its path in `hunks.txt`; every other finding stays in the body alone.

Never type a path into a command: paths come from the diff, and a file name can carry shell syntax. Instead, use
Write to create `$dir/locations.tsv` with one line per finding: its line number, a tab, then its path exactly as
`hunks.txt` gives it. Then run this, which prints each of those lines prefixed with `inline` or `body`:

```bash
dir='<run directory>'
awk -F'\t' '
    { path = \$0; sub(/^[^\t]*\t/, "", path) }
    FNR == NR { if (\$1 != "-") spans[path] = \$1; next }
    {
        line = \$1 + 0; hit = 0
        n = split(spans[path], span, ",")
        for (i = 1; i <= n; i++) if (split(span[i], b, "-") == 2 && line >= b[1] + 0 && line <= b[2] + 0) hit = 1
        print (hit ? "inline" : "body") "\t" \$0
    }
' "$dir/hunks.txt" "$dir/locations.tsv"
```

Check any JSON you write with `jq empty <file>` before ending.

- When the profile names a destination, end with a receipt: where the review went, the number of findings at each
  severity, and every path written.
- When it names none, end with the report itself.
- When delivery fails and the profile gives no fallback for it, end with the report and the error.
