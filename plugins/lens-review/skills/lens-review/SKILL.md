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
except to review it. Fill in the first five values and run:

```bash
set -euo pipefail
label='worktree'                # worktree, the SHA or ref, the range, or pr-<n>
pr=''                           # the number, for a pull request target
commit=''                       # the SHA or ref, for a commit target; a range's right side, or HEAD when it is empty
fetch() { git diff HEAD; }      # the profile's command, for any target but a pull request
root="<output root>"            # the profile's "Output" root; a variable it names stays a shell expansion
mkdir -p "$root"
dir=$(mktemp -d "$root/$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '_')-$(date -u +%Y%m%dT%H%M%SZ)-XXXX")
if [[ -n $pr ]]; then
    # The diff and the files read beside it must come from one head, so fetch again if a push lands in between.
    for _ in 1 2 3; do
        before=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
        gh pr diff "$pr" > "$dir/patch.diff"
        after=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
        if [[ $before == "$after" ]]; then
            commit=$after
            break
        fi
    done
    [[ -n $commit ]] || { echo "the pull request's head kept moving"; exit 4; }
    gh pr view "$pr" --json commits,body > "$dir/pr.json"
    # The URL is the repository gh resolved the pull request against, whatever the local remotes are named, and gh's
    # login is the fetch's only credential, so it works where git itself authenticates only over SSH.
    if ! git cat-file -e "$commit^{commit}" 2> /dev/null; then
        git -c credential.helper= -c credential.helper='!gh auth git-credential' \
            fetch --quiet --no-tags "$(gh repo view --json url --jq .url)" "refs/pull/$pr/head"
    fi
else
    fetch > "$dir/patch.diff"
fi
[[ -s $dir/patch.diff ]] || { echo "empty diff"; exit 3; }
if [[ -n $commit ]]; then
    # The checkout may hold another commit, whose files would put the review's line numbers on the wrong text.
    git rev-parse --verify "$commit^{commit}" > "$dir/head-sha"
    mkdir "$dir/tree"
    git archive "$(< "$dir/head-sha")" | tar -x -C "$dir/tree"
    # Claude Code loads the instruction files and skills of a directory it reads in, and reading a symlink follows it
    # out of the tree, so none of them stays.
    find "$dir/tree" \( -type l -o -iname CLAUDE.md -o -iname CLAUDE.local.md -o -iname AGENTS.md \
        -o -ipath '*/.claude/rules' -o -ipath '*/.claude/skills' -o -ipath '*/.claude/commands' \) \
        -prune -exec rm -rf {} +
fi
echo "$dir"
```

An empty diff ends the run with that message, and so does a pull request whose head moved on each of three fetches:
run again.
Every later block runs in a new shell, so give each the path this one printed as its run directory. For every target
but the working tree, the run directory also holds `head-sha`, the commit the diff ends at, and `tree/`, that commit's
files.

A merge commit as target prints a combined diff, which the index below refuses. Fetch it as the range
`<sha>^1..<sha>` instead and say so in the report.

## 3. Index the diff without reading it

Run the index on the run directory:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/lens-review/scripts/diff_index.py" index '<run directory>'
```

It writes `manifest.tsv` (per file: lines added, lines removed, the file's line span inside `patch.diff`, and the
path) and `hunks.txt` (per file: the new-side line spans its hunks cover, comma separated, or `-` for none, then the
path) into the run directory, and prints the patch's line count.

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

- **`auto`**: choose from what the change touches alone; the profile's default lenses play no part. Apply every lens
  whose routing row in the profile's "Lenses" section matches the diff's paths or the kind of code they hold; those
  rows are binding. Apply any other lens your judgment says this change needs.
- **`default`**: exactly the profile's default lenses. The report also names each routing row that matched and so
  did not run.
- **An id list**: exactly those lenses.

The report says which lenses you applied, which you left out and why.

Stop, with the reason, when the directory holds no lens, when an id given is not one listed (name the valid ids), or
when the lenses are `default` and the profile names none.

## 5. Review

Review the diff with the lenses you chose, as your instructions describe, reading the files around each hunk.

For every target but the working tree, read those files in the run directory's `tree/`, never in the checkout, which
may hold another commit. Reach history through the commit in `head-sha`: `git show <sha>:<path>`,
`git grep <pattern> <sha>`, `git log <sha>`. Some paths are missing from `tree/`: every symlink, any path the target's
`.gitattributes` marks `export-ignore`, and the files Claude Code would load as instructions or skills (`CLAUDE.md`,
`CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claude/skills/` and `.claude/commands/`, at any depth). A path
marked `export-subst` is rewritten there. Read any of these with `git show <sha>:<path>`, which prints a symlink's
target rather than following it. The profile and the lenses stay the checkout's, so a change under review cannot
rewrite its own review.

**Severity rubric.**
- Critical (Must Fix): merging it ships something broken, unsafe or private.
- High (Should Fix): a real defect or cost that should be fixed before merge, unless the owner (whoever rules on
  this repository's reviews) accepts it.
- Normal (Could Fix): worth fixing, and fine to defer.
Use the profile's "Severity calibration" for what each level looks like here.

**Response format.**
- Findings, each with: severity; location as `path:line`, using the path the diff names rather than its copy in
  `tree/`, and the new-side line number; the claim; what goes
  wrong because of it; and the evidence, meaning the lines opened and what they show.
- Open questions: what is unknown, why it matters, and what would settle it.
- Coverage: each file read whole, each read in part with the line ranges, and each skipped. When the diff was on
  disk, give the line ranges of `patch.diff` read. Name every tool call that was refused or blocked and what it would
  have read, or say there was none.

The report has a Critical, a High and a Normal heading, each present even when empty, then the open questions, then
which lenses you applied and left out, then coverage: each changed file read whole, read in part (with ranges) or
skipped.

## 6. Deliver

Follow the profile's "Delivery" section.

Whether a finding goes inline is a lookup, not a judgment. A finding goes inline only when its line falls inside a
span listed for its path in `hunks.txt`; every other finding stays in the body alone.

Never type a path into a command: paths come from the diff, and a file name can carry shell syntax. Instead, use
Write to create `locations.tsv` in the run directory with one line per finding: its line number, a tab, then its path
exactly as `hunks.txt` gives it. Then run this, which prints each of those lines prefixed with `inline` or `body`:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/lens-review/scripts/diff_index.py" place '<run directory>'
```

Check any JSON you write with `jq empty <file>` before ending.

- When the profile names a destination, end with a receipt: where the review went, the number of findings at each
  severity, and every path written.
- When it names none, end with the report itself.
- When delivery fails and the profile gives no fallback for it, end with the report and the error.
