#!/usr/bin/env bash
# An entry can carry components or `strict: false` and so ship behaviour that no plugin version covers; a pointer to
# plugins/<name> is covered by the version check.
set -Eeuo pipefail

marketplace=.claude-plugin/marketplace.json
bad=$(jq -c '.plugins[] | select((keys - ["name", "source", "description"]) != [] or .source != "./plugins/\(.name)")' "$marketplace")
if [[ -n $bad ]]; then
    echo "::error file=$marketplace::Entries may hold only name, source and description, with source ./plugins/<name>:"
    echo "$bad"
    exit 1
fi
