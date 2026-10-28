#!/usr/bin/env bats
# Drives pre-push against a scratch repository and remote with a stub `claude`, so no review is spent. Needs what the
# hook needs except claude.

zero=0000000000000000000000000000000000000000

setup() {
    local source_root
    source_root=$(cd "$BATS_TEST_DIRNAME/../.." && pwd)
    # Laid out as bootstrap.py installs it: the hook runs through `current`, and keeps its state beside it.
    install=$BATS_TEST_TMPDIR/install
    mkdir -p "$install/versions/1"
    cp -r "$source_root/harness/githooks" "$source_root/harness/leak-scan" "$install/versions/1/"
    ln -s versions/1 "$install/current"
    hook=$install/current/githooks/pre-push

    # The stub goes first on PATH, so the real claude is never reached.
    export HOME=$BATS_TEST_TMPDIR/home
    stub_dir=$HOME/stub
    export PATH=$HOME/.local/bin:$PATH
    mkdir -p "$HOME/.local/bin" "$stub_dir"
    ln -s "$(command -v betterleaks)" "$HOME/.local/bin/betterleaks"
    # The hook gives claude a fixed environment, so the stub reads its verdict from ~/stub/mode. Every call is counted,
    # and the bundle and environment it was given are kept for inspection.
    cat > "$HOME/.local/bin/claude" << 'EOF'
#!/usr/bin/env bash
echo call >> "$HOME/stub/calls"
env > "$HOME/stub/env"
rm -rf "$HOME/stub/bundle"
cp -r . "$HOME/stub/bundle"
read=
for file in *; do
    read+="{\"file\":\"$file\",\"lines\":$(wc -l < "$file")},"
done
read="[${read%,}]"
finding() { printf '[{"severity":"%s","location":"a","text":"t","reveals":"r"}]' "$1"; }
case $(cat "$HOME/stub/mode") in
    normal) output="{\"findings\":$(finding Normal),\"open_questions\":[],\"read\":$read}" ;;
    high) output="{\"findings\":$(finding High),\"open_questions\":[],\"read\":$read}" ;;
    unknown) output="{\"findings\":$(finding Low),\"open_questions\":[],\"read\":$read}" ;;
    question) output="{\"findings\":[],\"open_questions\":[{\"location\":\"a\",\"text\":\"t\",\"question\":\"q\"}],\"read\":$read}" ;;
    unread) output='{"findings":[],"open_questions":[],"read":[]}' ;;
    unstructured) echo '{"result":"no verdict"}'; exit 0 ;;
    fail) exit 1 ;;
esac
echo "{\"structured_output\":$output}"
EOF
    chmod +x "$HOME/.local/bin/claude"

    remote=$BATS_TEST_TMPDIR/remote.git
    repo=$BATS_TEST_TMPDIR/repo
    git init -q --bare -b main "$remote"
    git init -q -b main "$repo"
    git -C "$repo" config user.name test
    git -C "$repo" config user.email test@example.com
    mkdir -p "$repo/.claude/agents/code-review" "$repo/.claude/agents/references"
    cp "$source_root/.claude/agents/code-review/public-leak.md" "$repo/.claude/agents/code-review/"
    cp "$source_root/.claude/agents/references/reviewer-brief.md" "$repo/.claude/agents/references/"
    commit base
    git -C "$repo" push -q "$remote" main
    git -C "$repo" fetch -q "$remote" '+refs/heads/*:refs/remotes/bot/*'
    git -C "$repo" switch -q -c claude/change
    echo "an ordinary line" > "$repo/new.txt"
    commit change
}

# commit <message> [git option]...: commits everything, with the options (such as an identity) before `commit`.
commit() {
    git -C "$repo" add -A
    git -C "$repo" "${@:2}" commit -qm "$1"
}

# The stdin line for pushing the current branch as a new ref.
new_branch() {
    echo "refs/heads/claude/change $(git -C "$repo" rev-parse HEAD) refs/heads/claude/change $zero"
}

# push <stub mode> <url> <stdin line>...: runs the hook as git would, setting $status, $output and $calls.
push() {
    local mode=$1 url=$2
    shift 2
    printf '%s\n' "$@" > "$BATS_TEST_TMPDIR/updates"
    rm -f "$stub_dir/calls"
    cd "$repo" || return
    echo "$mode" > "$stub_dir/mode"
    run "$hook" bot "$url" < "$BATS_TEST_TMPDIR/updates"
    calls=0
    if [[ -f $stub_dir/calls ]]; then
        calls=$(( $(wc -l < "$stub_dir/calls") ))
    fi
}

# Split so this file does not trip the scan it tests.
leak="write to someone@acme-corp"".com"

@test "claude fails: refused" {
    push fail "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
    [[ $output == *"leak-review: did not run (claude exited 1)"* ]]
}

@test "no structured output: refused" {
    push unstructured "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
    [[ $output == *"leak-review: did not run (claude exited 0)"* ]]
}

@test "High finding: refused" {
    push high "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
    [[ $output == *"raised 1 question(s) or finding(s) not rated Normal"* ]]
}

@test "finding of a severity outside the schema: refused" {
    push unknown "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
    [[ $output == *"raised 1 question(s) or finding(s) not rated Normal"* ]]
}

@test "open question: refused" {
    push question "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
    [[ $output == *"raised 1 question(s) or finding(s) not rated Normal"* ]]
}

@test "review that did not read its inputs to the end: refused" {
    push unread "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
    [[ $output == *"leak-review: read 0 of the "*" lines in commits.patch"* ]]
}

@test "Normal finding only: allowed, and the pass is cached under the install directory" {
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 1 ]
    push fail "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 0 ]
    [ "$(find "$install/state/passed" -type f | wc -l)" -eq 1 ]
    [ "$(find "$install/state" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ]
}

@test "a pass under an earlier copy of the gate is not reused" {
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    echo "# changed" >> "$install/current/leak-scan/shapes.toml"
    push fail "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 1 ]
}

@test "LEAK_SCAN_SKIP on HTTPS: refused" {
    LEAK_SCAN_SKIP=1 push normal https://github.com/example/repo.git "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"LEAK_SCAN_SKIP works only on an SSH remote"* ]]
}

@test "LEAK_SCAN_SKIP on SSH: allowed" {
    LEAK_SCAN_SKIP=1 push fail git@github.com:example/repo.git "$(new_branch)"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 0 ]
}

@test "branch delete: allowed" {
    push fail "$remote" "(delete) $zero refs/heads/claude/change $(git -C "$repo" rev-parse HEAD)"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 0 ]
}

@test "remote with no default branch: refused" {
    git init -q --bare "$BATS_TEST_TMPDIR/empty.git"
    push normal "$BATS_TEST_TMPDIR/empty.git" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"cannot fetch the default branch of"* ]]
}

@test "shape finding: refused before review" {
    echo "$leak" > "$repo/leak.txt"
    commit leak
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"the leak scan flagged this push"* ]]
}

@test "a local remote-tracking ref at the leak does not take it out of the check" {
    echo "$leak" > "$repo/leak.txt"
    commit leak
    git -C "$repo" update-ref refs/remotes/bot/main HEAD
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"the leak scan flagged this push"* ]]
}

@test "an allowlist on the pushed branch does not apply, whatever the local remote HEAD names" {
    printf "filter = '''\nfilter.matchesAny(finding[\"match\"], [\`acme\`])\n'''\n" > "$repo/.leak-scan.toml"
    commit allowlist
    git -C "$repo" update-ref refs/remotes/bot/allowlist HEAD
    git -C "$repo" symbolic-ref refs/remotes/bot/HEAD refs/remotes/bot/allowlist
    echo "$leak" > "$repo/leak.txt"
    commit leak
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"the leak scan flagged this push"* ]]
}

@test "default branch without public-leak: refused" {
    git -C "$repo" switch -q main
    git -C "$repo" rm -q -r .claude
    commit "drop the agent"
    git -C "$repo" push -q "$remote" main
    git -C "$repo" switch -q claude/change
    git -C "$repo" merge -q main
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"has no .claude/agents/code-review/public-leak.md"* ]]
}

@test "the review gets identities, what a merge adds, tag messages and ref names" {
    git -C "$repo" -c user.name="Bundle Author" commit -q --allow-empty -m authored
    git -C "$repo" switch -q -c side main
    echo side > "$repo/side.txt"
    commit side
    git -C "$repo" switch -q claude/change
    git -C "$repo" merge -q --no-commit side
    echo "added by the merge" > "$repo/merged.txt"
    commit merge
    git -C "$repo" tag -a v1 -m "a tag message"
    push normal "$remote" "$(new_branch)" "refs/tags/v1 $(git -C "$repo" rev-parse v1) refs/tags/v1 $zero"
    [ "$status" -eq 0 ]
    grep -q "^Bundle Author " "$stub_dir/bundle/identities.txt"
    grep -q "^+added by the merge" "$stub_dir/bundle/commits.patch"
    grep -q "^a tag message" "$stub_dir/bundle/tags.txt"
    grep -qx refs/tags/v1 "$stub_dir/bundle/ref-names.txt"
}

@test "binary files are listed, and attributes or config cannot hide a text file's content" {
    printf 'x\0y\n' > "$repo/data.bin"
    echo '* -diff' > "$repo/.gitattributes"
    echo "committed attributes" > "$repo/one.txt"
    commit binary
    echo '* -diff' > "$repo/.git/info/attributes"
    git -C "$repo" config color.ui always
    echo "local attributes" > "$repo/two.txt"
    commit text
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    grep -q " data.bin$" "$stub_dir/bundle/binary-files.txt"
    grep -q "^+committed attributes" "$stub_dir/bundle/commits.patch"
    grep -q "^+local attributes" "$stub_dir/bundle/commits.patch"
}

@test "the caller's environment does not reach the review" {
    ANTHROPIC_BASE_URL=http://127.0.0.1:9 NODE_OPTIONS=--require=/x HTTPS_PROXY=http://127.0.0.1:9 \
        ANTHROPIC_API_KEY=synthetic-key push normal "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    run grep -e ANTHROPIC_BASE_URL -e NODE_OPTIONS -e HTTPS_PROXY "$stub_dir/env"
    [ "$status" -eq 1 ]
    grep -qx ANTHROPIC_API_KEY=synthetic-key "$stub_dir/env"
}

@test "a line too long to read in one piece reaches the review whole, in overlapping pieces" {
    { printf 'start '; head -c 9000 /dev/zero | tr '\0' x; printf ' end-of-line\n'; } > "$repo/long.txt"
    commit long
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    [ "$(awk '{ print length($0) }' "$stub_dir/bundle/commits.patch" | sort -n | tail -n 1)" -le 4000 ]
    # Each piece after the first repeats the previous one's last 200 characters, so dropping them rebuilds the line.
    whole=$(awk '/^[+]start x/ { on = 1; line = $0; next }
        on { line = line substr($0, 201) }
        on && /end-of-line$/ { print line; exit }' "$stub_dir/bundle/commits.patch")
    [ "$whole" = "+$(cat "$repo/long.txt")" ]
}

bot_name='example-bot[bot]'
bot_email='1+example-bot[bot]@users.noreply.example.com'
as_bot=(-c user.name="$bot_name" -c user.email="$bot_email")

name_bot() {
    git -C "$repo" config claude.botEmail "$bot_email"
    git -C "$repo" config claude.botName "$bot_name"
}

# Names the bot and starts claude/bot from main with one commit of the bot's.
use_bot() {
    name_bot
    git -C "$repo" switch -q -c claude/bot main
    echo "a bot line" > "$repo/bot.txt"
    commit bot "${as_bot[@]}"
}

# The stdin line for pushing HEAD to <remote ref>, which is at <remote sha> on the remote.
update_of() {
    echo "refs/heads/claude/bot $(git -C "$repo" rev-parse HEAD) $1 ${2:-$zero}"
}

agent_push() {
    CLAUDE_CODE_SESSION_ID=synthetic-session push "$@"
}

@test "a commit not by the bot, from a session: refused before the leak gate" {
    name_bot
    agent_push normal "$remote" "$(new_branch)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"is authored by test <test@example.com>, not by the bot $bot_name <$bot_email>"* ]]
    [[ $output == *"user.name='$bot_name'"*" rebase --exec "*" bot/main"* ]]
}

@test "a commit with the bot's email but not its name, from a session: refused" {
    use_bot
    echo "a misnamed line" > "$repo/misnamed.txt"
    commit misnamed -c user.email="$bot_email"
    agent_push normal "$remote" "$(update_of refs/heads/claude/bot)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"is authored by test <$bot_email>, not by the bot"* ]]
}

@test "a ref outside the bot's branch prefix, with claude.branchPrefix empty, from a session: refused under claude/" {
    use_bot
    git -C "$repo" config claude.branchPrefix ''
    agent_push normal "$remote" "$(update_of refs/heads/main)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"pushes and deletes only branches under claude/, not refs/heads/main"* ]]
}

@test "the bot's branch after merging the owner's new commits on main: allowed" {
    use_bot
    git -C "$repo" push -q "$remote" claude/bot
    pushed=$(git -C "$repo" rev-parse HEAD)
    git -C "$repo" switch -q main
    echo "an owner line" > "$repo/owner.txt"
    commit owner
    git -C "$repo" push -q "$remote" main
    git -C "$repo" fetch -q "$remote" '+refs/heads/*:refs/remotes/bot/*'
    git -C "$repo" switch -q claude/bot
    git -C "$repo" "${as_bot[@]}" merge -q --no-edit main
    agent_push normal "$remote" "$(update_of refs/heads/claude/bot "$pushed")"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 1 ]
}

@test "outside a session: the owner's push is not checked for authorship" {
    name_bot
    unset CLAUDE_CODE_SESSION_ID
    push normal "$remote" "$(new_branch)"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 1 ]
}

@test "a commit the bot authored but did not commit, from a session: refused, naming the committer" {
    use_bot
    echo "a cherry-picked line" > "$repo/picked.txt"
    GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com commit picked "${as_bot[@]}"
    agent_push normal "$remote" "$(update_of refs/heads/claude/bot)"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"is committed by test <test@example.com>, not by the bot"* ]]
    [[ $output != *"is authored by"* ]]
}

@test "deletions from a session: allowed under the bot's branch prefix, refused outside it" {
    name_bot
    main=$(git -C "$repo" rev-parse main)
    agent_push fail "$remote" "(delete) $zero refs/heads/claude/change $main"
    [ "$status" -eq 0 ]
    [ "$calls" -eq 0 ]
    agent_push fail "$remote" "(delete) $zero refs/heads/main $main"
    [ "$status" -eq 1 ]
    [ "$calls" -eq 0 ]
    [[ $output == *"pushes and deletes only branches under claude/, not refs/heads/main"* ]]
}
