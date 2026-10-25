#!/usr/bin/env bash
# Scans the PR's commits with the leak scan as the base branch has it, so a PR cannot loosen its own scan. Run in
# GitHub's merge checkout, where HEAD^1 is the base and HEAD^1..HEAD^2 is exactly the PR's commits.
set -Eeuo pipefail

if ! git cat-file -e HEAD^1:harness/leak-scan/scan.sh 2> /dev/null; then
    echo "::warning::The base branch has no leak scan yet, so this PR is not scanned."
    exit 0
fi
scanner=$(mktemp -d)
trap 'rm -rf "$scanner"' EXIT
git archive HEAD^1 harness/leak-scan | tar -x -C "$scanner" --strip-components=2
bash "$scanner/scan.sh" . HEAD^1 HEAD^1..HEAD^2
