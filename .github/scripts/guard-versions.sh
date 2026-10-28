#!/usr/bin/env bash
# Fails when the PR changes a plugin or the harness without raising its version. Installed users get a change only when
# the version rises, so a change merged without a bump reaches nobody and nothing reports it. Tests and top-level
# READMEs do not ship behaviour. Run in GitHub's merge checkout, where HEAD^1 is the base.
set -Eeuo pipefail

changed=$(git diff --name-only HEAD^1 HEAD -- ':(glob)plugins/**' ':(glob)harness/**' \
    ':(glob,exclude)plugins/*/README.md' ':(glob,exclude)harness/*/README.md' ':(glob,exclude)**/*.test.ts' \
    ':(glob,exclude)**/*.test.tsx' ':(glob,exclude)**/test_*.py' ':(glob,exclude)**/test_*.bats')

# Each changed unit as "<name> <manifest>": the harness has one version for everything under harness/.
units=()
if grep -q '^harness/' <<< "$changed"; then
    units+=("harness harness/harness.json")
fi
while read -r plugin; do
    units+=("$plugin plugins/$plugin/.claude-plugin/plugin.json")
done < <(grep '^plugins/' <<< "$changed" | cut -d/ -f2 | sort -u)

status=0
for unit in "${units[@]}"; do
    read -r name manifest <<< "$unit"
    [[ -f $manifest ]] || continue
    head=$(jq -r .version "$manifest")
    if ! base=$(git show "HEAD^1:$manifest" 2> /dev/null | jq -r .version); then
        echo "$name: new at $head"
        continue
    fi
    newest=$(printf '%s\n' "$base" "$head" | sort -V | tail -n 1)
    if [[ $head == "$base" || $newest != "$head" ]]; then
        echo "::error file=$manifest::$name changed, so its version must rise above $base (it is $head)."
        status=1
    else
        echo "$name: $base -> $head"
    fi
done
exit "$status"
