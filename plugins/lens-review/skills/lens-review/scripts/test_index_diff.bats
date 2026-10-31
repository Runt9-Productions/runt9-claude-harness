#!/usr/bin/env bats
# Drives index-diff.sh over patches git writes from a scratch repository. Needs git and awk.

setup() {
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    index_diff=$BATS_TEST_DIRNAME/index-diff.sh
    repo=$BATS_TEST_TMPDIR/repo
    git init -q -b main "$repo"
    mkdir "$repo/dir"
    printf 'one\ntwo\nthree\n' > "$repo/top.txt"
    printf 'alpha\nbeta\n' > "$repo/dir/inner.txt"
    commit base
}

commit() {
    git -C "$repo" add -A
    git -C "$repo" -c user.name=Dev -c user.email=dev@example.com commit -qm "$1"
}

# Writes the working tree's change against HEAD into a new run directory, as the skill's fetch does.
diff_into() {
    run_dir=$1
    git -C "$repo" add -A
    git -C "$repo" diff HEAD > "$BATS_TEST_TMPDIR/patch.diff"
    mkdir -p "$run_dir"
    mv "$BATS_TEST_TMPDIR/patch.diff" "$run_dir/"
}

edit_both_files() {
    printf 'one\nTWO\nthree\n' > "$repo/top.txt"
    printf 'gamma\n' >> "$repo/dir/inner.txt"
}

# The patch lists dir/inner.txt on lines 1 to 8 with one line added, then top.txt on lines 9 to 17 with one changed.
expected_manifest=$'1\t0\t1-8\tdir/inner.txt\n1\t1\t9-17\ttop.txt'
expected_hunks=$'1-3\tdir/inner.txt\n1-3\ttop.txt'

@test "a run directory inside the work tree, below none of the patched paths, indexes every file" {
    edit_both_files
    run_dir=$repo/.claude/output/code-review/run
    diff_into "$run_dir"
    run "$index_diff" "$run_dir"
    [ "$status" -eq 0 ]
    [ "$output" = 17 ]
    [ "$(< "$run_dir/manifest.tsv")" = "$expected_manifest" ]
    [ "$(< "$run_dir/hunks.txt")" = "$expected_hunks" ]
}

@test "a run directory outside any repository indexes every file" {
    edit_both_files
    run_dir=$BATS_TEST_TMPDIR/outside/run
    diff_into "$run_dir"
    run git -C "$run_dir" rev-parse --git-dir
    [ "$status" -ne 0 ]
    run "$index_diff" "$run_dir"
    [ "$status" -eq 0 ]
    [ "$(< "$run_dir/manifest.tsv")" = "$expected_manifest" ]
    [ "$(< "$run_dir/hunks.txt")" = "$expected_hunks" ]
}

# git quotes such a path in the patch, as "b/dir/with space \303\274.txt", so the raw path shows the quoting was undone.
@test "a path with a space and non-ASCII characters is indexed as the raw path" {
    printf 'new\n' > "$repo/dir/with space ü.txt"
    diff_into "$BATS_TEST_TMPDIR/run"
    run "$index_diff" "$BATS_TEST_TMPDIR/run"
    [ "$status" -eq 0 ]
    [ "$(< "$BATS_TEST_TMPDIR/run/manifest.tsv")" = $'1\t0\t1-7\tdir/with space ü.txt' ]
    [ "$(< "$BATS_TEST_TMPDIR/run/hunks.txt")" = $'1-1\tdir/with space ü.txt' ]
}

@test "a path holding a tab is refused" {
    printf 'new\n' > "$repo/dir/tab"$'\t'"name.txt"
    diff_into "$BATS_TEST_TMPDIR/run"
    run "$index_diff" "$BATS_TEST_TMPDIR/run"
    [ "$status" -eq 1 ]
    [[ $output == *"a path holds a tab or newline"* ]]
}

@test "a file deleted whole has no new-side span" {
    git -C "$repo" rm -q top.txt
    diff_into "$BATS_TEST_TMPDIR/run"
    run "$index_diff" "$BATS_TEST_TMPDIR/run"
    [ "$status" -eq 0 ]
    [ "$(< "$BATS_TEST_TMPDIR/run/manifest.tsv")" = $'0\t3\t1-9\ttop.txt' ]
    [ "$(< "$BATS_TEST_TMPDIR/run/hunks.txt")" = $'-\ttop.txt' ]
}

@test "the combined diff of a merge commit is refused rather than indexed as empty" {
    git -C "$repo" switch -q -c side
    printf 'side\n' >> "$repo/top.txt"
    commit side
    git -C "$repo" switch -q main
    printf 'main\n' >> "$repo/top.txt"
    commit main
    git -C "$repo" -c user.name=Dev -c user.email=dev@example.com merge -q side > /dev/null || true
    printf 'one\ntwo\nthree\nmain\nside\n' > "$repo/top.txt"
    commit merge
    mkdir "$BATS_TEST_TMPDIR/run"
    git -C "$repo" show HEAD > "$BATS_TEST_TMPDIR/run/patch.diff"
    grep -q '^diff --cc top.txt$' "$BATS_TEST_TMPDIR/run/patch.diff"
    run "$index_diff" "$BATS_TEST_TMPDIR/run"
    [ "$status" -eq 1 ]
    [[ $output == *"index: "* ]]
    [ ! -e "$BATS_TEST_TMPDIR/run/manifest.tsv" ]
}
