#!/usr/bin/env bash
# Decides where each finding in a run directory's locations.tsv goes. Each line there is a new-side line number, a tab,
# then a path as hunks.txt gives it. Each is printed back prefixed with `inline` and a tab when the line falls inside a
# span hunks.txt lists for that path, and with `body` otherwise.
#
#   place-findings.sh <run directory>
set -euo pipefail

if (( $# != 1 )); then
    echo "usage: place-findings.sh <run directory>" >&2
    exit 2
fi

awk -F'\t' '
    { path = $0; sub(/^[^\t]*\t/, "", path) }
    FILENAME == ARGV[1] { if ($1 != "-") spans[path] = $1; next }
    {
        line = $1 + 0; hit = 0
        span_count = split(spans[path], span, ",")
        for (each = 1; each <= span_count; each++) {
            split(span[each], bounds, "-")
            if (line >= bounds[1] + 0 && line <= bounds[2] + 0) hit = 1
        }
        print (hit ? "inline" : "body") "\t" $0
    }
' "$1/hunks.txt" "$1/locations.tsv"
