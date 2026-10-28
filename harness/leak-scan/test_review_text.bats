#!/usr/bin/env bats
# Drives review-text.sh against a scratch repository with a stub `claude`, so no review is spent. Needs betterleaks,
# git and jq.

setup() {
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    local source_root
    source_root=$(cd "$BATS_TEST_DIRNAME/../.." && pwd)
    review_text=$BATS_TEST_DIRNAME/review-text.sh

    # The stub goes first on PATH, so the real claude is never reached. It keeps the bundle it was given and passes
    # with every input read to its last line.
    export HOME=$BATS_TEST_TMPDIR/home
    mkdir -p "$HOME/.local/bin"
    export PATH=$HOME/.local/bin:$PATH
    cat > "$HOME/.local/bin/claude" << 'EOF'
#!/usr/bin/env bash
rm -rf "$HOME/bundle"
cp -r . "$HOME/bundle"
read=
for file in *; do
    read+="{\"file\":\"$file\",\"lines\":$(wc -l < "$file")},"
done
echo "{\"structured_output\":{\"findings\":[],\"open_questions\":[],\"read\":[${read%,}]}}"
EOF
    chmod +x "$HOME/.local/bin/claude"

    repo=$BATS_TEST_TMPDIR/repo
    git init -q -b main "$repo"
    mkdir -p "$repo/.claude/agents/code-review"
    cp "$source_root/.claude/agents/code-review/public-leak.md" "$repo/.claude/agents/code-review/"
    git -C "$repo" add -A
    git -C "$repo" -c user.name=Dev -c user.email=dev@example.com commit -qm base
    body=$BATS_TEST_TMPDIR/body.md
}

@test "a clean body passes both checks, and the review reads it" {
    printf 'Example title\n\n## Objective\nNothing private here.\n' > "$body"
    run "$review_text" "$body" "$repo" main
    [ "$status" -eq 0 ]
    cmp "$body" "$HOME/bundle/body.md"
    [ -f "$HOME/bundle/public-leak.md" ]
}

@test "a pattern-scan hit stops before the review" {
    at=@
    # Assembled at run time so this file does not match the pattern scan.
    printf 'Ask someone%sacme-corp.com\n' "$at" > "$body"
    run "$review_text" "$body" "$repo" main
    [ "$status" -eq 1 ]
    [ ! -d "$HOME/bundle" ]
}
