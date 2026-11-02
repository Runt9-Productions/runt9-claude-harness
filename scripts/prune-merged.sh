#!/usr/bin/env bash
# Clears what merged pull requests leave in the repository it runs in: the worktree of each merged branch, the branch
# itself, and remote-tracking refs whose branch is gone from its remote. A squash merge leaves nothing git can trace,
# so a branch counts as merged only when its tip is exactly the head commit of a pull request for it that GitHub
# reports as merged; it is then deleted with `git branch -D`. Asks GitHub through the caller's own gh login and remotes.
#
#   prune-merged.sh [--dry-run]
#
# Prints one line per worktree removed, branch deleted, branch kept with the reason, and remote-tracking ref pruned.
# --dry-run prints the same lines and changes nothing. A worktree with changes, a locked one, the main worktree and the
# one it runs from are never removed, and their branches are kept.
#
# Each remote is pruned on its own. One that cannot be reached is skipped with a line giving git's error, the rest
# still run, and the exit status is 1. Any other failure stops the run with exit status 2.
set -Eeuo pipefail
trap 'echo "prune-merged: failed at line $LINENO" >&2; exit 2' ERR

usage() {
    echo "usage: prune-merged.sh [--dry-run]" >&2
    exit 2
}

dry_run=false
dry_run_flag=()
case $# in
    0) ;;
    1)
        [[ $1 == --dry-run ]] || usage
        dry_run=true
        dry_run_flag=(--dry-run)
        ;;
    *) usage ;;
esac

keep() {
    echo "kept $1: $2"
}

declare -A worktree_of=() locked=()
main_branch=
entries=0
worktrees=$(git worktree list --porcelain)
while IFS= read -r line; do
    case $line in
        'worktree '*)
            path=${line#worktree }
            entries=$(( entries + 1 ))
            ;;
        'branch refs/heads/'*)
            branch=${line#branch refs/heads/}
            worktree_of[$branch]=$path
            if (( entries == 1 )); then
                main_branch=$branch
            fi
            ;;
        locked*) locked[$path]=true ;;
    esac
done <<< "$worktrees"
current_ref=$(git symbolic-ref -q HEAD || true)
current_branch=${current_ref#refs/heads/}

# Prints why `git worktree remove` without --force would refuse the worktree, or nothing, so that --dry-run reports
# the same refusals a real run meets.
worktree_blocker() {
    local path=$1
    if [[ -n ${locked[$path]-} ]]; then
        echo "worktree $path is locked"
        return
    fi
    # A directory already gone holds nothing to lose, and `git worktree remove` unregisters it.
    if [[ ! -d $path ]]; then
        return
    fi
    if [[ -n $(git -C "$path" status --porcelain --ignore-submodules=none) ]]; then
        echo "worktree $path has changes"
    fi
}

branches=$(git for-each-ref --format='%(objectname) %(refname:lstrip=2)' refs/heads)
while read -r tip branch; do
    merged_heads=$(gh pr list --head "$branch" --state merged --json headRefOid --jq '.[].headRefOid' < /dev/null)
    if [[ -z $merged_heads ]]; then
        keep "$branch" "no merged pull request"
        continue
    fi
    if ! grep -qxF "$tip" <<< "$merged_heads"; then
        keep "$branch" "tip differs from the head of its merged pull request"
        continue
    fi
    if [[ $branch == "$current_branch" ]]; then
        keep "$branch" "checked out in the worktree this runs from"
        continue
    fi
    if [[ $branch == "$main_branch" ]]; then
        keep "$branch" "checked out in the main worktree"
        continue
    fi

    path=${worktree_of[$branch]-}
    if [[ -n $path ]]; then
        blocker=$(worktree_blocker "$path")
        if [[ -n $blocker ]]; then
            keep "$branch" "$blocker"
            continue
        fi
        if [[ $dry_run == false ]] && ! refusal=$(git worktree remove "$path" 2>&1); then
            keep "$branch" "git worktree remove refused: $refusal"
            continue
        fi
        echo "removed worktree $path"
    fi
    if [[ $dry_run == false ]]; then
        git branch -q -D "$branch"
    fi
    echo "deleted branch $branch"
done <<< "$branches"

skipped_remote=false
remotes=$(git remote)
while read -r remote; do
    [[ -n $remote ]] || continue
    # The C locale keeps git's report untranslated, so its lines can be matched. On failure git has printed nothing
    # to stdout, so the first line is its error.
    if ! report=$(LC_ALL=C git remote prune "${dry_run_flag[@]}" "$remote" 2>&1); then
        echo "skipped remote $remote: ${report%%$'\n'*}"
        skipped_remote=true
        continue
    fi
    sed -nE 's/^ \* \[(would prune|pruned)\] /pruned /p' <<< "$report"
done <<< "$remotes"

if [[ $dry_run == false ]]; then
    git worktree prune
fi

if [[ $skipped_remote == true ]]; then
    exit 1
fi
