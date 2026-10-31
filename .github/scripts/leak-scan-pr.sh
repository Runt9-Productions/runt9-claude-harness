#!/usr/bin/env bash
# Scans the PR's commits with the leak scan as the base branch has it, so a PR cannot loosen its own scan. Run in
# GitHub's merge checkout, where HEAD^1 is the base and HEAD^1..HEAD^2 is exactly the PR's commits.
set -Eeuo pipefail

if ! git cat-file -e HEAD^1:harness/leak-scan/scan.sh 2> /dev/null; then
    echo "::error::The base branch has no leak scan, so this PR cannot be scanned."
    exit 1
fi
scanner=$(mktemp -d)
trap 'rm -rf "$scanner"' EXIT
git archive HEAD^1 harness/leak-scan | tar -x -C "$scanner" --strip-components=2
# Dependabot's messages name the old and new commit of a dependency by full hash. PR_AUTHOR must come from the
# pull_request event: a commit's author fields are whatever the PR's author set them to.
options=()
if [[ ${PR_AUTHOR:-} == 'dependabot[bot]' ]]; then
    options+=(--allow-message-hex)
fi
bash "$scanner/scan.sh" "${options[@]}" . HEAD^1 HEAD^1..HEAD^2
