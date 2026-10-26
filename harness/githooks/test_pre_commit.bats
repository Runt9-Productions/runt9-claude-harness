#!/usr/bin/env bats
# Drives pre-commit through real `git commit`, so the hook checks the identity git resolves for the commit, with the
# `git -c user.email=...` the agent is told to use.

bot_name='example-bot[bot]'
bot_email='1+example-bot[bot]@users.noreply.example.com'

setup() {
    local source_root
    source_root=$(cd "$BATS_TEST_DIRNAME/../.." && pwd)
    export HOME=$BATS_TEST_TMPDIR/home
    mkdir -p "$HOME"
    cp -r "$source_root/harness/githooks" "$BATS_TEST_TMPDIR/"
    repo=$BATS_TEST_TMPDIR/repo
    git init -q "$repo"
    git -C "$repo" config core.hooksPath "$BATS_TEST_TMPDIR/githooks"
    git -C "$repo" config user.name owner
    git -C "$repo" config user.email owner@example.com
    git -C "$repo" config claude.botEmail "$bot_email"
    git -C "$repo" config claude.botName "$bot_name"
    echo a > "$repo/a.txt"
    git -C "$repo" add a.txt
}

as_agent() {
    run env CLAUDE_CODE_SESSION_ID=synthetic-session "$@"
}

as_owner() {
    run env -u CLAUDE_CODE_SESSION_ID "$@"
}

@test "no claude.botEmail: the agent's commit as the owner is allowed" {
    git -C "$repo" config --unset claude.botEmail
    as_agent git -C "$repo" commit -qm change
    [ "$status" -eq 0 ]
}

@test "outside a session: the owner's commit is allowed" {
    as_owner git -C "$repo" commit -qm change
    [ "$status" -eq 0 ]
}

@test "the agent's commit as the owner: refused, naming the command to use" {
    as_agent git -C "$repo" commit -qm change
    [ "$status" -eq 1 ]
    [[ $output == *"git -c user.name='$bot_name' -c user.email='$bot_email' commit"* ]]
}

@test "the agent's commit with the bot's email but not its name: refused" {
    as_agent git -C "$repo" -c user.email="$bot_email" commit -qm change
    [ "$status" -eq 1 ]
    [[ $output == *"authored by owner <$bot_email>"* ]]
}

@test "the agent's commit with the bot identity given to git -c: allowed, and recorded as the bot" {
    as_agent git -C "$repo" -c user.name="$bot_name" -c user.email="$bot_email" commit -qm change
    [ "$status" -eq 0 ]
    [ "$(git -C "$repo" log -1 --format='%an <%ae> %cn <%ce>')" = "$bot_name <$bot_email> $bot_name <$bot_email>" ]
}

@test "the agent amending the owner's commit as the bot: refused, and allowed with the printed --reset-author" {
    as_owner git -C "$repo" commit -qm change
    as_agent git -C "$repo" -c user.name="$bot_name" -c user.email="$bot_email" commit -q --amend --no-edit
    [ "$status" -eq 1 ]
    [[ $output == *"commit --amend --reset-author"* ]]
    as_agent git -C "$repo" -c user.name="$bot_name" -c user.email="$bot_email" commit -q --amend --reset-author --no-edit
    [ "$status" -eq 0 ]
}

@test "the agent's merge commit as the owner: refused by pre-merge-commit, and completed by the printed commit" {
    as_owner git -C "$repo" commit -qm base
    git -C "$repo" switch -q -c side
    echo b > "$repo/b.txt"
    git -C "$repo" add b.txt
    as_owner git -C "$repo" commit -qm side
    git -C "$repo" switch -q -
    as_agent git -C "$repo" merge --no-ff --no-edit side
    [ "$status" -eq 1 ]
    [[ $output == *"not by the bot"* ]]
    as_agent git -C "$repo" -c user.name="$bot_name" -c user.email="$bot_email" commit -q --no-edit
    [ "$status" -eq 0 ]
    [ "$(git -C "$repo" rev-parse HEAD^2)" = "$(git -C "$repo" rev-parse side)" ]
    [ "$(git -C "$repo" log -1 --format=%ae)" = "$bot_email" ]
}

@test "claude.botEmail without claude.botName: refused" {
    git -C "$repo" config --unset claude.botName
    as_agent git -C "$repo" -c user.name="$bot_name" -c user.email="$bot_email" commit -qm change
    [ "$status" -eq 1 ]
    [[ $output == *"claude.botName is not"* ]]
}
