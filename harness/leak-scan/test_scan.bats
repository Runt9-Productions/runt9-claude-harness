#!/usr/bin/env bats
# Repo-local state that changes what git shows must not hide a leak from scan.sh. Needs betterleaks, git and jq.

setup() {
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    scan=$BATS_TEST_DIRNAME/scan.sh
    at=@
    # Assembled at run time so this file does not match the pattern scan.
    leak=someone${at}acme-corp.com
    repo=$BATS_TEST_TMPDIR/repo
    git init -q -b main "$repo"
    commit_file base base
    git -C "$repo" branch -q trusted
}

git_dev() {
    git -C "$repo" -c user.name=Dev -c user.email=dev@example.com "$@"
}

commit_file() {
    printf '%s\n' "$2" > "$repo/$1"
    git_dev add "$1"
    git_dev commit -qm "add $1"
}

@test "a clean range exits 0" {
    commit_file notes 'nothing to see'
    run "$scan" "$repo" none trusted..main
    [ "$status" -eq 0 ]
}

@test "the repo's git config cannot change what git log prints" {
    git_dev config color.ui always
    git_dev config format.pretty oneline
    git_dev config log.showRoot false
    commit_file mail "$leak"
    run "$scan" "$repo" none trusted..main
    [ "$status" -eq 1 ]
    [[ $output == *"mail:1  $leak"* ]]
}

trust_repo_allowlist() {
    cp "$BATS_TEST_DIRNAME/../../.leak-scan.toml" "$repo/.leak-scan.toml"
    git_dev add .leak-scan.toml
    git_dev commit -qm allowlist
    git_dev branch -qf trusted
}

@test "this repo's allowlist passes the owner's address as an identity only" {
    trust_repo_allowlist
    owner=runt9${at}runt9productions.com
    printf 'x\n' > "$repo/x"
    git -C "$repo" add x
    git -C "$repo" -c user.name=Owner -c user.email="$owner" commit -qm 'add x'
    run "$scan" "$repo" trusted trusted..main
    [ "$status" -eq 0 ]

    commit_file contact "$owner"
    git_dev commit -q --allow-empty -m "ask $owner"
    run "$scan" "$repo" trusted trusted..main
    [ "$status" -eq 1 ]
    [[ $output == *"contact:1  $owner"* ]]
    [[ $output == *"(message):1  $owner"* ]]
    [[ $output != *"(identity)"* ]]
}

@test "binary content is not scanned, and --export lists the file" {
    printf 'x\0mail %s\n' "$leak" > "$repo/blob"
    git_dev add blob
    git_dev commit -qm 'add blob'
    run "$scan" --export "$BATS_TEST_TMPDIR/out" "$repo" none trusted..main
    [ "$status" -eq 0 ]
    [ "$(cat "$BATS_TEST_TMPDIR/out/binary-files")" = "$(git_dev rev-parse main) blob" ]
}

@test "--export writes what was scanned" {
    commit_file mail "$leak"
    git_dev tag -a v1 -m "tag by $leak"
    run "$scan" --ref refs/tags/v1 --export "$BATS_TEST_TMPDIR/out" "$repo" none trusted..v1
    [ "$status" -eq 1 ]
    out=$BATS_TEST_TMPDIR/out
    sha=$(git_dev rev-parse main)
    grep -qx "+$leak" "$out/patch"
    [ "$(cat "$out/text/$sha.message")" = "add mail" ]
    [ "$(cat "$out/text/$sha.identity")" = "$(printf 'Dev <dev@example.com>\nDev <dev@example.com>')" ]
    grep -qx "tag by $leak" "$out/text/$(git_dev rev-parse v1).tag"
    [ "$(cat "$out/text/file-names")" = mail ]
    [ "$(cat "$out/text/ref-names")" = refs/tags/v1 ]
    [ ! -s "$out/binary-files" ]
}

@test "--export refuses a directory that is not empty" {
    mkdir "$BATS_TEST_TMPDIR/out"
    touch "$BATS_TEST_TMPDIR/out/stale"
    run "$scan" --export "$BATS_TEST_TMPDIR/out" "$repo" none trusted..main
    [ "$status" -eq 2 ]
    [[ $output == *"export directory $BATS_TEST_TMPDIR/out is not empty"* ]]
}

@test "an octopus merge exits 2" {
    for side in left right; do
        git_dev checkout -q -b "$side" trusted
        commit_file "$side" "$side"
    done
    git_dev checkout -q main
    git_dev merge -q --no-ff left right
    run "$scan" "$repo" none trusted..main
    [ "$status" -eq 2 ]
    [[ $output == *"the revisions include an octopus merge, which cannot be scanned"* ]]
}
