#!/usr/bin/env bats
# Drives review-text.sh against a scratch repository with a stub `claude`, so no review is spent. Needs betterleaks,
# git and jq.

setup() {
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    local source_root
    source_root=$(cd "$BATS_TEST_DIRNAME/../.." && pwd)
    review_text=$BATS_TEST_DIRNAME/review-text.sh

    # The stub goes first on PATH, so the real claude is never reached. It keeps the bundle, agent definitions, model
    # and effort it was given, and reports every input read to its last line, with the findings in ~/findings or none.
    export HOME=$BATS_TEST_TMPDIR/home
    mkdir -p "$HOME/.local/bin"
    export PATH=$HOME/.local/bin:$PATH
    cat > "$HOME/.local/bin/claude" << 'EOF'
#!/usr/bin/env bash
rm -rf "$HOME/bundle"
cp -r . "$HOME/bundle"
while (( $# )); do
    case $1 in
        --agents) cp "$2" "$HOME/agents.json" ;;
        --model) echo "$2" > "$HOME/model" ;;
        --effort) echo "$2" > "$HOME/effort" ;;
    esac
    shift
done
read=
for file in *; do
    read+="{\"file\":\"$file\",\"lines\":$(wc -l < "$file")},"
done
findings=$(cat "$HOME/findings" 2> /dev/null || echo '[]')
echo "{\"structured_output\":{\"findings\":$findings,\"open_questions\":[],\"read\":[${read%,}]}}"
EOF
    chmod +x "$HOME/.local/bin/claude"

    repo=$BATS_TEST_TMPDIR/repo
    git init -q -b main "$repo"
    brief=plugins/lens-review/skills/lens-review/references/reviewer-brief.md
    lens=$repo/.claude/agents/lens-review/reference/public-leak.md
    mkdir -p "${lens%/*}" "$repo/${brief%/*}"
    printf '# Lens: public-leak\n\nExample summary.\n\n## The question\n\nExample question?\n' > "$lens"
    printf -- '---\nname: lens-review\ndescription: Example agent.\nmodel: example-model\n---\n\n# Reviewer\n' \
        > "$repo/.claude/agents/lens-review/lens-review.md"
    cp "$source_root/$brief" "$repo/$brief"
    git -C "$repo" add -A
    git -C "$repo" -c user.name=Dev -c user.email=dev@example.com commit -qm base
    body=$BATS_TEST_TMPDIR/body.md
}

# review.sh refuses to run without public-leak.md, so the exit status already shows the agent reached the review.
@test "a clean body passes both checks, and the review gets it and the reviewer brief" {
    printf 'Example title\n\n## Objective\nNothing private here.\n' > "$body"
    run "$review_text" "$body" "$repo" main
    [ "$status" -eq 0 ]
    cmp "$body" "$HOME/bundle/body.md"
    [ -f "$HOME/bundle/reviewer-brief.md" ]
}

@test "the review runs the trusted ref's whole lens as its prompt, under its lens-review agent's model at high effort" {
    printf 'Example title\n' > "$body"
    trusted_lens=$(< "$lens")
    # A checked-out branch with its own lens and model, which the review must not use.
    git -C "$repo" switch -q -c topic
    printf '# Lens: public-leak\n\nTopic summary.\n' > "$lens"
    sed -i 's/^model: .*/model: topic-model/' "$repo/.claude/agents/lens-review/lens-review.md"
    git -C "$repo" -c user.name=Dev -c user.email=dev@example.com commit -qam topic
    run "$review_text" "$body" "$repo" main
    [ "$status" -eq 0 ]
    [ "$(jq -r '."public-leak".prompt' "$HOME/agents.json")" == "$trusted_lens" ]
    [ "$(jq -r '."public-leak".description' "$HOME/agents.json")" == "Example summary." ]
    [ "$(< "$HOME/model")" == example-model ]
    [ "$(< "$HOME/effort")" == high ]
}

@test "a pattern-scan hit stops before the review" {
    at=@
    # Assembled at run time so this file does not match the pattern scan.
    printf 'Ask someone%sacme-corp.com\n' "$at" > "$body"
    run "$review_text" "$body" "$repo" main
    [ "$status" -eq 1 ]
    [[ $output == *"email-address  (body):1  someone${at}acme-corp.com"* ]]
    [ ! -d "$HOME/bundle" ]
}

@test "a review finding not rated Normal exits 1" {
    printf 'Example title\n' > "$body"
    echo '[{"severity":"High","location":"a","text":"t","reveals":"r"}]' > "$HOME/findings"
    run "$review_text" "$body" "$repo" main
    [ "$status" -eq 1 ]
    [[ $output == *"leak-review: raised 1 question(s) or finding(s) not rated Normal"* ]]
}

@test "a check that did not run exits 2, not 1" {
    printf 'Example title\n' > "$body"
    run "$review_text" "$body" "$repo" missing
    [ "$status" -eq 2 ]
    [[ $output == *"trusted ref 'missing' does not exist"* ]]
}
