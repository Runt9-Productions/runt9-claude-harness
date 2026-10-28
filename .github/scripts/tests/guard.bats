#!/usr/bin/env bats
# Needs jq, and a grep with -P. The invisible characters are octal escapes: written literally, they would fail the
# guard on any PR that changes this file.

load helpers

setup() {
    start_repo
}

# A plugin with the version given, written into the working tree.
plugin_at() {
    mkdir -p "$FIXTURE/plugins/$1/.claude-plugin"
    printf '{"name": "%s", "version": "%s"}\n' "$1" "$2" > "$FIXTURE/plugins/$1/.claude-plugin/plugin.json"
}

# Commits the plugin on the base branch, then switches back to the PR.
base_plugin_at() {
    git_t -C "$FIXTURE" switch -q main
    plugin_at "$1" "$2"
    echo v1 > "$FIXTURE/plugins/$1/code.ts"
    git_t -C "$FIXTURE" add -A
    git_t -C "$FIXTURE" commit -q -m "base $1"
    git_t -C "$FIXTURE" switch -q pr
    git_t -C "$FIXTURE" merge -q main
}

run_in_fixture() {
    cd "$FIXTURE" || return
    run bash "$SCRIPTS/$1"
}

@test "a changed file with a zero-width space fails" {
    printf 'a\342\200\213b\n' > "$FIXTURE/notes.md"
    merge_pr
    run_in_fixture guard-invisible-characters.sh
    [ "$status" -eq 1 ]
    [[ $output == *"notes.md:1:"* ]]
}

@test "a changed file named like an option is still checked" {
    printf 'a\342\200\256b\n' > "$FIXTURE/-n"
    merge_pr
    run_in_fixture guard-invisible-characters.sh
    [ "$status" -eq 1 ]
    [[ $output == *"-n:1:"* ]]
}

@test "a file with a NUL byte is still checked" {
    printf 'a\0b\342\201\240c\n' > "$FIXTURE/blob.txt"
    merge_pr
    run_in_fixture guard-invisible-characters.sh
    [ "$status" -eq 1 ]
    [[ $output == *"blob.txt:1:"* ]]
}

@test "plain changed files pass" {
    echo 'plain text' > "$FIXTURE/notes.md"
    merge_pr
    run_in_fixture guard-invisible-characters.sh
    [ "$status" -eq 0 ]
    [[ $output == *"1 changed file(s) checked"* ]]
}

@test "a PR that only deletes files passes" {
    git_t -C "$FIXTURE" switch -q main
    echo x > "$FIXTURE/gone.md"
    git_t -C "$FIXTURE" add -A
    git_t -C "$FIXTURE" commit -q -m gone
    git_t -C "$FIXTURE" switch -q pr
    git_t -C "$FIXTURE" merge -q main
    git_t -C "$FIXTURE" rm -q gone.md
    merge_pr
    run_in_fixture guard-invisible-characters.sh
    [ "$status" -eq 0 ]
    [[ $output == *"No file added or changed"* ]]
}

@test "a marketplace entry with only name, source and description passes" {
    mkdir -p "$FIXTURE/.claude-plugin"
    echo '{"plugins": [{"name": "a", "source": "./plugins/a", "description": "d"}]}' > "$FIXTURE/.claude-plugin/marketplace.json"
    run_in_fixture guard-marketplace-entries.sh
    [ "$status" -eq 0 ]
}

@test "a marketplace entry with another key fails" {
    mkdir -p "$FIXTURE/.claude-plugin"
    echo '{"plugins": [{"name": "a", "source": "./plugins/a", "strict": false}]}' > "$FIXTURE/.claude-plugin/marketplace.json"
    run_in_fixture guard-marketplace-entries.sh
    [ "$status" -eq 1 ]
    [[ $output == *"Entries may hold only name, source and description"* ]]
}

@test "a marketplace entry pointing elsewhere fails" {
    mkdir -p "$FIXTURE/.claude-plugin"
    echo '{"plugins": [{"name": "a", "source": "./plugins/b"}]}' > "$FIXTURE/.claude-plugin/marketplace.json"
    run_in_fixture guard-marketplace-entries.sh
    [ "$status" -eq 1 ]
    [[ $output == *"Entries may hold only name, source and description"* ]]
}

@test "a changed plugin whose version rose passes" {
    base_plugin_at a 1.0.0
    echo v2 > "$FIXTURE/plugins/a/code.ts"
    plugin_at a 1.0.1
    merge_pr
    run_in_fixture guard-plugin-versions.sh
    [ "$status" -eq 0 ]
    [[ $output == *"a: 1.0.0 -> 1.0.1"* ]]
}

@test "a changed plugin with the same version fails" {
    base_plugin_at a 1.0.0
    echo v2 > "$FIXTURE/plugins/a/code.ts"
    merge_pr
    run_in_fixture guard-plugin-versions.sh
    [ "$status" -eq 1 ]
    [[ $output == *"a changed, so its version must rise above 1.0.0 (it is 1.0.0)"* ]]
}

# 1.9.0 sorts above 1.10.0 as text, so this checks the comparison is by version.
@test "a plugin whose version went down fails" {
    base_plugin_at a 1.10.0
    plugin_at a 1.9.0
    merge_pr
    run_in_fixture guard-plugin-versions.sh
    [ "$status" -eq 1 ]
    [[ $output == *"a changed, so its version must rise above 1.10.0 (it is 1.9.0)"* ]]
}

@test "a change to only a plugin's tests or README needs no bump" {
    base_plugin_at a 1.0.0
    echo docs > "$FIXTURE/plugins/a/README.md"
    echo test > "$FIXTURE/plugins/a/code.test.ts"
    merge_pr
    run_in_fixture guard-plugin-versions.sh
    [ "$status" -eq 0 ]
}

@test "a change to only a plugin's Python tests needs no bump" {
    base_plugin_at a 1.0.0
    mkdir -p "$FIXTURE/plugins/a/skills/s/scripts"
    echo test > "$FIXTURE/plugins/a/skills/s/scripts/test_example.py"
    merge_pr
    run_in_fixture guard-plugin-versions.sh
    [ "$status" -eq 0 ]
}

@test "a new plugin needs no bump" {
    plugin_at b 0.1.0
    merge_pr
    run_in_fixture guard-plugin-versions.sh
    [ "$status" -eq 0 ]
    [[ $output == *"b: new at 0.1.0"* ]]
}
