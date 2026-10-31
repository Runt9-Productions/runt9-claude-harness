#!/usr/bin/env bats
# Drives place-findings.sh over a hunks.txt in the shape index-diff.sh writes. Needs awk.

setup() {
    place_findings=$BATS_TEST_DIRNAME/place-findings.sh
    run_dir=$BATS_TEST_TMPDIR/run
    mkdir "$run_dir"
    printf '%s\t%s\n' '3-5,10-12' 'src/with space.txt' '-' 'gone.txt' > "$run_dir/hunks.txt"
}

@test "a line inside a span, its ends included, is inline and a line between spans is body" {
    printf '%s\t%s\n' 3 'src/with space.txt' 12 'src/with space.txt' 7 'src/with space.txt' > "$run_dir/locations.tsv"
    run "$place_findings" "$run_dir"
    [ "$status" -eq 0 ]
    [ "$output" = $'inline\t3\tsrc/with space.txt\ninline\t12\tsrc/with space.txt\nbody\t7\tsrc/with space.txt' ]
}

@test "a line in a file with no new-side span, or in a file outside the diff, is body" {
    printf '%s\t%s\n' 1 'gone.txt' 4 'elsewhere.txt' > "$run_dir/locations.tsv"
    run "$place_findings" "$run_dir"
    [ "$status" -eq 0 ]
    [ "$output" = $'body\t1\tgone.txt\nbody\t4\telsewhere.txt' ]
}
