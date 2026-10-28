#!/usr/bin/env bash
# Checks an issue or pull request body before it is posted: the pattern scan, then the public-leak review, both under
# the repository's <trusted-ref> (its default branch, as last fetched).
#
#   review-text.sh <file> <repo> <trusted-ref>
#
# Exit 0 clean, 1 a finding, 2 a check did not run. Treat 2 as a failure, never as clean.
set -Eeuo pipefail
trap 'echo "review-text: failed at line $LINENO" >&2; exit 2' ERR

if (( $# != 3 )); then
    echo "usage: review-text.sh <file> <repo> <trusted-ref>" >&2
    exit 2
fi
file=$1
repo=$2
trusted_ref=$3
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Exits with the scan's own status, which the ERR trap would turn into 2.
"$here/scan.sh" --text "$file" "$repo" "$trusted_ref" || exit

git_dir=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
trusted=$(git -C "$repo" rev-parse --verify "$trusted_ref^{commit}")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$file" "$work/body.md"
mkdir "$work/review"

request="Review this text before it is posted on GitHub, where it is public at once. Its one input is body.md in \
this directory: the body of an issue or pull request."
"$here/review.sh" "$work/review" "$git_dir" "$trusted" "$request" "$work/body.md" || exit
