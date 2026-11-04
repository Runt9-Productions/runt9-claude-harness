#!/usr/bin/env bats
# Runs prune-merged.sh in a scratch repository with a stub `gh`, so GitHub is never asked.

setup() {
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    script=$BATS_TEST_DIRNAME/prune-merged.sh

    # The stub answers `gh pr list` from $PRS, one "<state> <branch> <head>" line per pull request, and prints each
    # matching head as `--json headRefOid --jq '.[].headRefOid'` would. Asked for anything else it fails, because real
    # gh would print values that match no branch tip and every keep test would still pass.
    export PRS=$BATS_TEST_TMPDIR/prs
    touch "$PRS"
    mkdir -p "$BATS_TEST_TMPDIR/bin"
    export PATH=$BATS_TEST_TMPDIR/bin:$PATH
    cat > "$BATS_TEST_TMPDIR/bin/gh" << 'EOF'
#!/usr/bin/env bash
[[ $1 == pr && $2 == list ]] || exit 1
state=open
head=
json=
jq=
while (( $# )); do
    case $1 in
        --state) state=$2; shift ;;
        --head) head=$2; shift ;;
        --json) json=$2; shift ;;
        --jq) jq=$2; shift ;;
    esac
    shift
done
if [[ $json != headRefOid || $jq != '.[].headRefOid' ]]; then
    echo "gh stub: asked for --json '$json' --jq '$jq'" >&2
    exit 1
fi
awk -v state="$state" -v head="$head" '(state == "all" || $1 == state) && (head == "" || $2 == head) { print $3 }' "$PRS"
EOF
    chmod +x "$BATS_TEST_TMPDIR/bin/gh"

    remote=$BATS_TEST_TMPDIR/remote.git
    repo=$BATS_TEST_TMPDIR/repo
    trees=$BATS_TEST_TMPDIR/trees
    git init -q --bare -b main "$remote"
    git init -q -b main "$repo"
    git -C "$repo" config user.name test
    git -C "$repo" config user.email test@example.com
    git -C "$repo" remote add origin "$remote"
    commit "$repo" base
    git -C "$repo" push -q origin main

    branch_with_worktree merged-tree
    pull_request merged merged-tree
    # GitHub deletes a merged branch on the remote, leaving the clone's remote-tracking ref stale.
    git -C "$repo" push -q origin merged-tree
    git -C "$remote" update-ref -d refs/heads/merged-tree

    git -C "$repo" switch -q -c merged-plain
    commit "$repo" plain
    git -C "$repo" switch -q main
    pull_request merged merged-plain

    branch_with_worktree followed-up
    pull_request merged followed-up
    commit "$trees/followed-up" "after the merge"

    branch_with_worktree dirty
    pull_request merged dirty
    echo draft > "$trees/dirty/notes.txt"

    git -C "$repo" branch open-only
    pull_request open open-only
}

commit() {
    git -C "$1" commit -q --allow-empty -m "$2"
}

branch_with_worktree() {
    git -C "$repo" worktree add -q -b "$1" "$trees/$1"
    commit "$trees/$1" "work on $1"
}

pull_request() {
    echo "$1 $2 $(git -C "$repo" rev-parse "refs/heads/$2")" >> "$PRS"
}

# Prints nothing when the branch is gone.
branch_tip() {
    git -C "$repo" for-each-ref --format='%(objectname)' "refs/heads/$1"
}

# Every ref and worktree, to show a run changed nothing.
snapshot() {
    git -C "$repo" for-each-ref
    git -C "$repo" worktree list --porcelain
    ls -A "$trees"
}

@test "removes a branch whose tip is its merged pull request's head, with its worktree and stale remote ref" {
    cd "$repo"
    run "$script"
    [ "$status" -eq 0 ]
    [[ $output == *"removed worktree $trees/merged-tree"* ]]
    [[ $output == *"deleted branch merged-tree"* ]]
    [[ $output == *"deleted branch merged-plain"* ]]
    [[ $output == *"pruned origin/merged-tree"* ]]
    [ -z "$(branch_tip merged-tree)" ]
    [ -z "$(branch_tip merged-plain)" ]
    [ ! -e "$trees/merged-tree" ]
    [[ $(git worktree list) != *merged-tree* ]]
    [ -z "$(git for-each-ref refs/remotes/origin/merged-tree)" ]
}

@test "keeps a branch with a commit after its merged pull request's head" {
    cd "$repo"
    run "$script"
    [ "$status" -eq 0 ]
    [[ $output == *"kept followed-up: tip differs from the head of its merged pull request"* ]]
    [ -n "$(branch_tip followed-up)" ]
    [ -d "$trees/followed-up" ]
}

@test "keeps a branch whose tip is the head of an open pull request only" {
    cd "$repo"
    run "$script"
    [ "$status" -eq 0 ]
    [[ $output == *"kept open-only: no merged pull request"* ]]
    [ -n "$(branch_tip open-only)" ]
}

@test "keeps a merged branch whose worktree has changes" {
    cd "$repo"
    run "$script"
    [ "$status" -eq 0 ]
    [[ $output == *"kept dirty: worktree $trees/dirty has changes"* ]]
    [ -n "$(branch_tip dirty)" ]
    [ -f "$trees/dirty/notes.txt" ]
}

@test "keeps a merged branch whose worktree is locked" {
    git -C "$repo" worktree lock "$trees/merged-tree"
    cd "$repo"
    run "$script"
    [ "$status" -eq 0 ]
    [[ $output == *"kept merged-tree: worktree $trees/merged-tree is locked"* ]]
    [ -n "$(branch_tip merged-tree)" ]
    [ -d "$trees/merged-tree" ]
}

@test "keeps merged branches checked out in the main worktree and in the worktree it runs from" {
    git -C "$repo" switch -q merged-plain
    cd "$trees/merged-tree"
    run "$script"
    [ "$status" -eq 0 ]
    [[ $output == *"kept merged-plain: checked out in the main worktree"* ]]
    [[ $output == *"kept merged-tree: checked out in the worktree this runs from"* ]]
    [ -n "$(branch_tip merged-plain)" ]
    [ -n "$(branch_tip merged-tree)" ]
    [ -d "$trees/merged-tree" ]
}

@test "skips a remote it cannot reach with git's fatal line, prunes the others and still prunes worktrees, exiting 1" {
    # `git remote` lists remotes by name, so the unreachable one comes before origin. Its ssh prints a line of its own
    # before git's error, as ssh does without an askpass helper.
    git -C "$repo" remote add gone ssh://example.invalid/missing.git
    printf '#!/usr/bin/env bash\necho "ssh_askpass: exec(ssh-askpass): No such file or directory" >&2\nexit 255\n' \
        > "$BATS_TEST_TMPDIR/bin/ssh"
    chmod +x "$BATS_TEST_TMPDIR/bin/ssh"
    export GIT_SSH_COMMAND=$BATS_TEST_TMPDIR/bin/ssh
    rm -rf "$trees/followed-up"
    cd "$repo"
    run "$script"
    [ "$status" -eq 1 ]
    [[ $output == *"skipped remote gone: fatal: Could not read from remote repository."* ]]
    [[ $output == *"pruned origin/merged-tree"* ]]
    [[ $(git worktree list) != *followed-up* ]]
}

@test "--dry-run changes nothing and prints the lines a real run prints" {
    # A worktree whose directory is gone, so a real run's `git worktree prune` has something to change.
    rm -rf "$trees/followed-up"
    cd "$repo"
    before=$(snapshot)
    run "$script" --dry-run
    [ "$status" -eq 0 ]
    dry_output=$output
    [ "$(snapshot)" = "$before" ]
    run "$script"
    [ "$status" -eq 0 ]
    [ "$output" = "$dry_output" ]
    [ "$(snapshot)" != "$before" ]
}

@test "refuses an argument other than --dry-run and changes nothing" {
    cd "$repo"
    before=$(snapshot)
    run "$script" --dry
    [ "$status" -eq 2 ]
    [ "$output" = "usage: prune-merged.sh [--dry-run]" ]
    [ "$(snapshot)" = "$before" ]
}

@test "stops with exit 2 and changes nothing when gh fails" {
    # gh exits 4 when it has no login.
    printf '#!/usr/bin/env bash\necho "To get started with GitHub CLI, please run:  gh auth login" >&2\nexit 4\n' \
        > "$BATS_TEST_TMPDIR/bin/gh"
    cd "$repo"
    before=$(snapshot)
    run "$script"
    [ "$status" -eq 2 ]
    [[ $output == *"prune-merged: failed at line"* ]]
    [ "$(snapshot)" = "$before" ]
}
