#!/usr/bin/env bash
# Indexes a run directory's patch.diff without anyone reading it. Writes manifest.tsv (per file: lines added, lines
# removed, the file's line span inside patch.diff, and the path) and hunks.txt (per file: the new-side line spans its
# hunks cover, comma separated, or `-` for none, then the path), both in patch order, and prints the patch's line
# count.
#
#   index-diff.sh <run directory>
#
# Exits non-zero with the reason on stderr when the patch cannot be indexed exactly, as for a combined diff of a merge
# commit or a path holding a tab or newline.
set -euo pipefail

if (( $# != 1 )); then
    echo "usage: index-diff.sh <run directory>" >&2
    exit 2
fi
cd "$1"

# Run below the top of a work tree, git apply drops every patched path outside the current directory, so it runs from
# the top of the work tree holding the run directory, when there is one.
top=$(git rev-parse --show-toplevel 2> /dev/null) || top=.
# git apply reads a patch without applying it and prints each file's raw path, NUL-terminated, so quoting and the
# tab git adds after a path with a space never reach the parsing below. Its records come in patch order.
mapfile -d '' records < <(git -C "$top" apply --numstat -z < patch.diff)
if ! wait "$!"; then
    echo "index: git apply could not read patch.diff" >&2
    exit 1
fi
# One line per `diff --git` section: its first and last line in patch.diff, then the new-side spans of its hunks.
mapfile -t sections < <(awk '
    /^diff --git / { section++; start[section] = NR; if (section > 1) end[section - 1] = NR - 1; next }
    /^@@+ / && match($0, /\+[0-9]+(,[0-9]+)?/) {
        parts = split(substr($0, RSTART + 1, RLENGTH - 1), range, ",")
        count = parts > 1 ? range[2] + 0 : 1
        if (count > 0) spans[section] = spans[section] (spans[section] == "" ? "" : ",") range[1] "-" (range[1] + count - 1)
    }
    END { end[section] = NR; for (each = 1; each <= section; each++) printf "%d\t%d\t%s\n", start[each], end[each], spans[each] }
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
