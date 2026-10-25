#!/usr/bin/env bash
# Writes the newest review.md under the directory given to GITHUB_OUTPUT as `report`. Fails when there is none, so a
# review that wrote nothing fails the job.
set -Eeuo pipefail

# A review body holds at most 65,536 characters.
REPORT_BYTES=60000

report=$(find "$1" -name review.md -printf '%T@ %p\n' 2> /dev/null | sort -n | tail -n 1 | cut -d' ' -f2-) || true
if [[ -z $report ]]; then
    echo "::error::The review wrote no report."
    exit 1
fi
delimiter=$(openssl rand -hex 16)
{
    echo "report<<$delimiter"
    head -c "$REPORT_BYTES" "$report"
    echo
    echo "$delimiter"
} >> "$GITHUB_OUTPUT"
