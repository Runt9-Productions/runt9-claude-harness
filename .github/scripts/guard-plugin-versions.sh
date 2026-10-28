#!/usr/bin/env bash
# Fails when the PR changes a plugin without raising its version. Installed users get a change only when the version
# rises, so a change merged without a bump reaches nobody and nothing reports it. Tests and a plugin's top-level
# README do not ship behaviour. Run in GitHub's merge checkout, where HEAD^1 is the base.
set -Eeuo pipefail

changed=$(git diff --name-only HEAD^1 HEAD -- ':(glob)plugins/**' \
    ':(glob,exclude)plugins/*/README.md' ':(glob,exclude)**/*.test.ts' ':(glob,exclude)**/*.test.tsx' \
    ':(glob,exclude)**/test_*.py')

names=$(cut -d/ -f2 <<< "$changed" | sort -u)
mapfile -t plugins <<< "$names"

status=0
for plugin in "${plugins[@]}"; do
    manifest=plugins/$plugin/.claude-plugin/plugin.json
    [[ -f $manifest ]] || continue
    head=$(jq -r .version "$manifest")
    if ! base=$(git show "HEAD^1:$manifest" 2> /dev/null | jq -r .version); then
        echo "$plugin: new at $head"
        continue
    fi
    newest=$(printf '%s\n' "$base" "$head" | sort -V | tail -n 1)
    if [[ $head == "$base" || $newest != "$head" ]]; then
        echo "::error file=$manifest::$plugin changed, so its version must rise above $base (it is $head)."
        status=1
    else
        echo "$plugin: $base -> $head"
    fi
done
exit "$status"
