#!/usr/bin/env bats
# Needs tar, and betterleaks and jq for the test that runs the real scan.

load helpers

setup() {
    start_repo
    export SCAN_LOG=$BATS_TEST_TMPDIR/scan.log
}

# Puts a stand-in scan.sh on the base branch that logs its arguments and exits with the status given.
base_scanner() {
    git_t -C "$FIXTURE" switch -q main
    mkdir -p "$FIXTURE/harness/leak-scan"
    cat > "$FIXTURE/harness/leak-scan/scan.sh" << EOF
#!/usr/bin/env bash
echo "\$*" > "\$SCAN_LOG"
exit $1
EOF
    git_t -C "$FIXTURE" add -A
    git_t -C "$FIXTURE" commit -q -m scanner
    git_t -C "$FIXTURE" switch -q pr
    git_t -C "$FIXTURE" merge -q main
}

@test "a base branch without the scanner fails" {
    merge_pr
    cd "$FIXTURE"
    run bash "$SCRIPTS/leak-scan-pr.sh"
    [ "$status" -eq 1 ]
    [[ $output == *"::error::The base branch has no leak scan"* ]]
}

@test "the base branch's scanner runs over the PR's commits" {
    base_scanner 0
    merge_pr
    cd "$FIXTURE"
    run bash "$SCRIPTS/leak-scan-pr.sh"
    [ "$status" -eq 0 ]
    [ "$(cat "$SCAN_LOG")" = ". HEAD^1 HEAD^1..HEAD^2" ]
}

@test "a PR's own copy of the scanner is not the one run" {
    base_scanner 1
    printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE/harness/leak-scan/scan.sh"
    merge_pr
    cd "$FIXTURE"
    run bash "$SCRIPTS/leak-scan-pr.sh"
    [ "$status" -eq 1 ]
    [ -s "$SCAN_LOG" ]
}

@test "a PR that deletes the scanner is still scanned" {
    base_scanner 1
    git_t -C "$FIXTURE" rm -q -r harness
    merge_pr
    cd "$FIXTURE"
    run bash "$SCRIPTS/leak-scan-pr.sh"
    [ "$status" -eq 1 ]
    [ -s "$SCAN_LOG" ]
}

@test "only a Dependabot PR's commit messages may name commits by full hash" {
    git_t -C "$FIXTURE" switch -q main
    mkdir -p "$FIXTURE/harness"
    cp -R "$SCRIPTS/../../harness/leak-scan" "$FIXTURE/harness/"
    git_t -C "$FIXTURE" add -A
    git_t -C "$FIXTURE" commit -q -m scanner
    git_t -C "$FIXTURE" switch -q pr
    git_t -C "$FIXTURE" merge -q main
    old=$(printf '0a%.0s' {1..20})
    new=$(printf '1b%.0s' {1..20})
    merge_pr "$(printf 'Bump example/action\n\n- [Commits](https://github.com/example/action/compare/%s...%s)' "$old" "$new")"
    cd "$FIXTURE"
    run env PR_AUTHOR='dependabot[bot]' bash "$SCRIPTS/leak-scan-pr.sh"
    [ "$status" -eq 0 ]

    run env PR_AUTHOR=someone-else bash "$SCRIPTS/leak-scan-pr.sh"
    [ "$status" -eq 1 ]
    [[ $output == *"(message):3  $old"* ]]
}
