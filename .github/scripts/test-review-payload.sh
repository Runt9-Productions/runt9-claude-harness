#!/usr/bin/env bash
# Turns a /test-review run in this checkout into a pull request review, written to GITHUB_OUTPUT as `payload`, a
# review whose comments carry the test fixes as suggested changes, and `fallback`, the report with every fix as one
# diff, for when GitHub rejects the payload. Fails when the run ended in an error or wrote no report.
#
#   test-review-payload.sh <claude-json> <base-commit>
#
# <claude-json> is the run's `claude -p --output-format json` output, whose `result` is the report. The fixes are the
# working tree's changes against HEAD, untracked files included. GitHub takes a comment only on a line inside one hunk
# of the pull request's diff, which is <base-commit>..HEAD, so a fix whose replaced lines are not all inside one hunk
# goes into the body as a diff instead.
set -Eeuo pipefail

# A review body holds at most 65,536 characters.
BODY_BYTES=60000

report=$(jq -r 'select(.is_error | not) | .result // empty' "$1")
if [[ -z $report ]]; then
    echo "::error::The test review wrote no report."
    exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

diff_options=(--no-color --no-renames --no-ext-diff --no-textconv)
git ls-files -z --others --exclude-standard | xargs -0 -r git add -N --
git -c core.quotePath=false diff "${diff_options[@]}" -U1 HEAD > "$work/fixes.diff"
git -c core.quotePath=false diff "${diff_options[@]}" "$2" HEAD > "$work/pr.diff"
echo "::group::The fixes"
cat "$work/fixes.diff"
echo "::endgroup::"

# One line per file of the PR's diff: its path, a tab, and the new-side spans of its hunks, comma separated.
awk '
    /^diff --git / { if (path != "") print path "\t" spans; path = ""; spans = ""; next }
    /^\+\+\+ b\// && spans == "" { path = substr($0, 7); next }
    path != "" && /^@@+ / && match($0, /\+[0-9]+(,[0-9]+)?/) {
        k = split(substr($0, RSTART + 1, RLENGTH - 1), part, ",")
        count = k > 1 ? part[2] + 0 : 1
        if (count > 0) spans = spans (spans == "" ? "" : ",") part[1] "-" (part[1] + count - 1)
    }
    END { if (path != "") print path "\t" spans }
' "$work/pr.diff" > "$work/pr-spans.tsv"

# Each fix hunk that fits inside one PR hunk becomes suggestion-<n>, its new text, and a line of suggestions.tsv: n, the
# path, the first and last line it replaces, and the length of the longest backtick run in it. Every other hunk, with
# its file's header, goes to unplaced.diff. A quoted path, as git writes one holding a tab, newline or quote, and a file
# added or deleted, have no lines to comment on.
awk -v dir="$work" '
    BEGIN {
        while ((getline line < (dir "/pr-spans.tsv")) > 0) {
            tab = index(line, "\t")
            spans[substr(line, 1, tab - 1)] = substr(line, tab + 1)
        }
    }
    function fits(path, first, last,    n, i, span, b) {
        if (!(path in spans) || first > last) return 0
        n = split(spans[path], span, ",")
        for (i = 1; i <= n; i++) if (split(span[i], b, "-") == 2 && first >= b[1] + 0 && last <= b[2] + 0) return 1
        return 0
    }
    function end_hunk(    rest, longest) {
        if (hunk == "") return
        if (fits(path, first, last)) {
            count++
            printf "%s", content > (dir "/suggestion-" count)
            close(dir "/suggestion-" count)
            longest = 0
            for (rest = content; match(rest, /`+/); rest = substr(rest, RSTART + RLENGTH)) {
                if (RLENGTH > longest) longest = RLENGTH
            }
            print count "\t" path "\t" first "\t" last "\t" longest > (dir "/suggestions.tsv")
        } else {
            if (!header_written) printf "%s", header > (dir "/unplaced.diff")
            header_written = 1
            printf "%s", hunk > (dir "/unplaced.diff")
        }
        hunk = ""
        hunks++
    }
    function end_file() {
        end_hunk()
        if (header != "" && hunks == 0) printf "%s", header > (dir "/unplaced.diff")
        header = ""; hunks = 0; header_written = 0; in_hunk = 0; old = ""; path = ""
    }
    /^diff --git / { end_file(); header = $0 "\n"; next }
    !in_hunk && /^--- / { old = substr($0, 5); header = header $0 "\n"; next }
    !in_hunk && /^\+\+\+ / {
        if (old ~ /^a\// && $0 ~ /^\+\+\+ b\// && substr(old, 3) == substr($0, 7)) path = substr(old, 3)
        header = header $0 "\n"
        next
    }
    /^@@ / {
        end_hunk()
        in_hunk = 1
        match($0, /^@@ -[0-9]+(,[0-9]+)?/)
        k = split(substr($0, 5, RLENGTH - 4), part, ",")
        first = part[1] + 0
        last = first + (k > 1 ? part[2] + 0 : 1) - 1
        hunk = $0 "\n"
        content = ""
        next
    }
    in_hunk {
        hunk = hunk $0 "\n"
        sign = substr($0, 1, 1)
        if (sign == " " || sign == "+") content = content substr($0, 2) "\n"
        next
    }
    { header = header $0 "\n" }
    END { end_file() }
' "$work/fixes.diff"

# fenced <file> <info>: the file in a code fence one backtick longer than any run of backticks inside it.
fenced() {
    local fence
    fence=$(awk '{ while (match($0, /`+/)) { if (RLENGTH > n) n = RLENGTH; $0 = substr($0, RSTART + RLENGTH) } }
        END { n = n < 3 ? 3 : n + 1; while (n--) printf "`" }' "$1")
    printf '%s%s\n%s\n%s\n' "$fence" "$2" "$(< "$1")" "$fence"
}

body=$report
if [[ -s $work/unplaced.diff ]]; then
    body+=$'\n\n## Fixes outside the diff\n\nGitHub takes a suggestion only on lines this pull request changes, so '
    body+=$'these fixes are a diff to apply by hand.\n\n'
    body+=$(fenced "$work/unplaced.diff" diff)
fi
fallback=$report
if [[ -s $work/fixes.diff ]]; then
    fallback+=$'\n\n## Fixes\n\nThe suggested changes could not be posted, so every fix is in this diff.\n\n'
    fallback+=$(fenced "$work/fixes.diff" diff)
fi

: > "$work/comments.jsonl"
if [[ -f $work/suggestions.tsv ]]; then
    while IFS=$'\t' read -r n path first last longest; do
        jq -n --arg path "$path" --argjson first "$first" --argjson last "$last" --argjson longest "$longest" \
            --rawfile text "$work/suggestion-$n" '
            ("`" * ([$longest + 1, 3] | max)) as $fence
            | {path: $path, line: $last, side: "RIGHT", body: "\($fence)suggestion\n\($text)\($fence)"}
            + (if $first < $last then {start_line: $first, start_side: "RIGHT"} else {} end)' \
            >> "$work/comments.jsonl"
    done < "$work/suggestions.tsv"
fi

delimiter=$(openssl rand -hex 16)
{
    echo "payload<<$delimiter"
    jq -c -s --rawfile body <(head -c "$BODY_BYTES" <<< "$body") '{body: $body, comments: .}' "$work/comments.jsonl"
    echo "$delimiter"
    echo "fallback<<$delimiter"
    head -c "$BODY_BYTES" <<< "$fallback"
    echo
    echo "$delimiter"
} >> "$GITHUB_OUTPUT"
