#!/usr/bin/env bats
# Needs openssl.

load helpers

setup() {
    export GITHUB_OUTPUT=$BATS_TEST_TMPDIR/output
    reports=$BATS_TEST_TMPDIR/code-review
    mkdir -p "$reports/earlier" "$reports/later"
}

@test "the newest report is the one passed on" {
    echo "earlier report" > "$reports/earlier/review.md"
    touch -d '1 hour ago' "$reports/earlier/review.md"
    echo "later report" > "$reports/later/review.md"
    run bash "$SCRIPTS/review-read-report.sh" "$reports"
    [ "$status" -eq 0 ]
    grep -q '^later report$' "$GITHUB_OUTPUT"
    refute_grep 'earlier report' "$GITHUB_OUTPUT"
    refute_grep '^payload<<' "$GITHUB_OUTPUT"
}

@test "the payload beside the newest report is passed on" {
    echo '{"body": "earlier payload"}' > "$reports/earlier/review-payload.json"
    echo "earlier report" > "$reports/earlier/review.md"
    touch -d '1 hour ago' "$reports/earlier/review.md"
    echo '{"body": "later payload"}' > "$reports/later/review-payload.json"
    echo "later report" > "$reports/later/review.md"
    run bash "$SCRIPTS/review-read-report.sh" "$reports"
    [ "$status" -eq 0 ]
    grep -q '^payload<<' "$GITHUB_OUTPUT"
    grep -q '^{"body": "later payload"}$' "$GITHUB_OUTPUT"
    refute_grep 'earlier payload' "$GITHUB_OUTPUT"
}

@test "no report fails" {
    run bash "$SCRIPTS/review-read-report.sh" "$reports"
    [ "$status" -eq 1 ]
    [[ $output == *"no report"* ]]
}

@test "a missing report directory fails" {
    run bash "$SCRIPTS/review-read-report.sh" "$BATS_TEST_TMPDIR/absent"
    [ "$status" -eq 1 ]
    [[ $output == *"no report"* ]]
}
