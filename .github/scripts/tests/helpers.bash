# shellcheck shell=bash
# Shared by the .bats files beside this one: a repository shaped like GitHub's merge checkout.

SCRIPTS=$(cd "$BATS_TEST_DIRNAME/.." && pwd)
export SCRIPTS

git_t() {
    git -c user.name=test -c user.email=test@example.com -c init.defaultBranch=main "$@"
}

# A repository at $FIXTURE whose HEAD merges branch `pr` into `main`, as GitHub checks out a PR: HEAD^1 is the base,
# HEAD^2 the PR head. Write the base's files, call this, write the PR's files, then call merge_pr.
start_repo() {
    export FIXTURE=$BATS_TEST_TMPDIR/repo
    mkdir -p "$FIXTURE"
    git_t -C "$FIXTURE" init -q
    git_t -C "$FIXTURE" add -A
    git_t -C "$FIXTURE" commit -q --allow-empty -m base
    git_t -C "$FIXTURE" switch -q -c pr
}

merge_pr() {
    git_t -C "$FIXTURE" add -A
    git_t -C "$FIXTURE" commit -q --allow-empty -m "${1:-pr}"
    git_t -C "$FIXTURE" switch -q main
    git_t -C "$FIXTURE" merge -q --no-ff -m merge pr
}

# Fails when the file holds the pattern. `! grep` would not: bash's errexit ignores a negated command, so only on a
# test's last line would it fail the test.
refute_grep() {
    if grep -q -- "$1" "$2"; then
        echo "found '$1' in $2" >&2
        return 1
    fi
}
