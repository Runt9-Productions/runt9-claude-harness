#!/usr/bin/env bats
# Needs jq and openssl.

load helpers

# A repository at $FIXTURE whose base commit holds a 20-line test file, example.bats, and a production file, tool.sh,
# and whose HEAD, the PR, changes line 3 of the test file.
setup() {
    export GITHUB_OUTPUT=$BATS_TEST_TMPDIR/output
    export FIXTURE=$BATS_TEST_TMPDIR/repo
    mkdir -p "$FIXTURE"
    cd "$FIXTURE" || return
    git_t init -q
    seq 1 20 | sed 's/^/line /' > example.bats
    echo 'exit 0' > tool.sh
    git_t add -A
    git_t commit -qm base
    base=$(git rev-parse HEAD)
    sed -i '3s/.*/line three/' example.bats
    git_t commit -qam pr
    echo '{"result": "the report"}' > "$BATS_TEST_TMPDIR/review.json"
}

# output_value <name>: one multi-line value from GITHUB_OUTPUT.
output_value() {
    awk -v name="$1" '$0 ~ "^" name "<<" { d = substr($0, length(name) + 3); on = 1; next } on && $0 == d { exit } on' \
        "$GITHUB_OUTPUT"
}

@test "a fix inside the PR's diff is a suggestion and one outside it is a diff in the body" {
    sed -i -e '3s/.*/line 3, fixed/' -e '15s/.*/line 15, fixed/' example.bats
    run bash "$SCRIPTS/test-review-payload.sh" "$BATS_TEST_TMPDIR/review.json" "$base"
    [ "$status" -eq 0 ]
    payload=$(output_value payload)
    [ "$(jq '.comments | length' <<< "$payload")" -eq 1 ]
    [ "$(jq -c '.comments[0] | [.path, .start_line, .line, .side]' <<< "$payload")" = '["example.bats",2,4,"RIGHT"]' ]
    [ "$(jq -r '.comments[0].body' <<< "$payload")" = $'```suggestion\nline 2\nline 3, fixed\nline 4\n```' ]
    [[ $(jq -r .body <<< "$payload") == "the report"*"+line 15, fixed"* ]]
    [[ $(jq -r .body <<< "$payload") != *"line 3, fixed"* ]]
    [[ $(output_value fallback) == "the report"*"+line 3, fixed"*"+line 15, fixed"* ]]
}

@test "a test file the review added is a diff in the body" {
    echo "a new test" > new.bats
    run bash "$SCRIPTS/test-review-payload.sh" "$BATS_TEST_TMPDIR/review.json" "$base"
    [ "$status" -eq 0 ]
    payload=$(output_value payload)
    [ "$(jq '.comments | length' <<< "$payload")" -eq 0 ]
    [[ $(jq -r .body <<< "$payload") == *"+a new test"* ]]
}

@test "a change outside the test files is named in the body and never suggested" {
    echo 'exit 1' > tool.sh
    echo "a copy set aside" > notes.txt
    run bash "$SCRIPTS/test-review-payload.sh" "$BATS_TEST_TMPDIR/review.json" "$base"
    [ "$status" -eq 0 ]
    payload=$(output_value payload)
    [ "$(jq '.comments | length' <<< "$payload")" -eq 0 ]
    [[ $(jq -r .body <<< "$payload") == *"outside the tests"*"- \`notes.txt\`"*"- \`tool.sh\`"* ]]
    [[ $(jq -r .body <<< "$payload") != *"exit 1"* ]]
    [[ $(output_value fallback) != *"exit 1"* ]]
}

@test "a run with no report fails" {
    echo '{"result": ""}' > "$BATS_TEST_TMPDIR/review.json"
    run bash "$SCRIPTS/test-review-payload.sh" "$BATS_TEST_TMPDIR/review.json" "$base"
    [ "$status" -eq 1 ]
    [[ $output == *"no report"* ]]
}
