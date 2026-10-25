#!/usr/bin/env bash
# Fails when a file the PR adds or changes holds a character that renders as nothing: zero-width, bidirectional and
# variation-selector characters, the soft hyphen, the byte-order mark and Unicode tag characters. Text an agent reads
# can hide in a file that reviews clean, and any changed file can reach an agent (skills, hook commands, settings
# fragments, scripts), so all are scanned. Run in GitHub's merge checkout, where HEAD^1 is the base.
set -Eeuo pipefail

# Through a file, not a process substitution, whose failure bash would ignore and read as no files changed.
list=$(mktemp)
trap 'rm -f "$list"' EXIT
git diff -z --name-only --diff-filter=d HEAD^1 HEAD > "$list"
mapfile -d '' files < "$list"
if (( ${#files[@]} == 0 )); then
    echo "No file added or changed."
    exit 0
fi

# -a because one NUL byte makes grep skip a file as binary while GitHub still shows it as text; `--` because a
# changed file can be named like an option. grep exits 2 on an error, which must fail the check.
status=0
LC_ALL=C.UTF-8 grep -nHaP \
    '[\x{00AD}\x{061C}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FE00}-\x{FE0F}\x{FEFF}\x{E0000}-\x{E007F}\x{E0100}-\x{E01EF}]' \
    -- "${files[@]}" || status=$?
case $status in
    0) echo "::error::The lines above hold an invisible character."; exit 1 ;;
    1) echo "${#files[@]} changed file(s) checked, none holds an invisible character." ;;
    *) echo "::error::grep failed (exit $status), so the files were not checked."; exit 1 ;;
esac
