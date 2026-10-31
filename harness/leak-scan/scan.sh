#!/usr/bin/env bash
# Scans what a range of commits would publish with betterleaks: the shape rules beside this script, then betterleaks'
# default secret rules. It reads added lines of text files (for a merge, what it adds beyond git's own merge of its
# parents), commit messages, author and committer identities, annotated tags, file names, and the ref names given with
# --ref. Binary content is not read.
#
#   scan.sh [--ref <ref name>]... [--export <dir>] [--allow-message-hex] <repo> <trusted-ref|none>
#           <git log revisions...>
#   scan.sh --ref refs/heads/topic . origin/main origin/main..topic
#   scan.sh --text <file> <repo> <trusted-ref|none>
#
# The allowlist is the repo's .leak-scan.toml as committed on <trusted-ref>, never the working tree, so a change
# cannot allowlist itself. `none` scans with no allowlist. --export writes what was scanned to <dir>; see the README.
# --allow-message-hex drops hex-identifier findings in commit messages, for a caller that knows who wrote them.
# --text scans one file instead of commits, such as an issue or pull request body before it is posted.
#
# Exit 0 clean, 1 findings, 2 the scan did not run. Treat 2 as a failure, never as clean.
set -Eeuo pipefail
trap 'echo "leak-scan: failed at line $LINENO" >&2; exit 2' ERR

usage() {
    echo "usage: scan.sh [--ref <ref name>]... [--export <dir>] [--allow-message-hex] <repo> <trusted-ref|none>" \
        "<git log revisions...>" >&2
    echo "       scan.sh --text <file> <repo> <trusted-ref|none>" >&2
    exit 2
}

ref_names=()
export_dir=
text_file=
allow_message_hex=false
while (( $# )); do
    case $1 in
        --allow-message-hex)
            allow_message_hex=true
            shift
            ;;
        --ref | --export | --text)
            (( $# >= 2 )) || usage
            case $1 in
                --ref) ref_names+=("$2") ;;
                --export) export_dir=$2 ;;
                --text) text_file=$2 ;;
            esac
            shift 2
            ;;
        *)
            break
            ;;
    esac
done
if [[ -n $text_file ]]; then
    (( $# == 2 )) || usage
    [[ -z $export_dir ]] || usage
    (( ${#ref_names[@]} == 0 )) || usage
    [[ $allow_message_hex == false ]] || usage
else
    (( $# >= 3 )) || usage
fi
if [[ -n $export_dir ]]; then
    mkdir -p "$export_dir"
    if [[ -n $(ls -A "$export_dir") ]]; then
        echo "leak-scan: export directory $export_dir is not empty" >&2
        exit 2
    fi
fi
repo=$1
trusted=$2
shift 2
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/no-ignore-file"

# Git and betterleaks run without the caller's environment or user and system git config. Config changes what
# `git log` prints (color, pretty formats, whether a root commit shows its diff) until betterleaks reads nothing.
clean() {
    env -i PATH="$PATH" HOME="$work" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 "$@"
}

# Only refs are read from the repo itself. Everything else reads a bare mirror that borrows the repo's objects and has
# none of its config, attributes or ignore files, which would otherwise hide content.
resolved=$(clean git -C "$repo" rev-parse "$@")
mapfile -t revisions <<< "$resolved"
common_dir=$(clean git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
object_format=$(clean git -C "$repo" rev-parse --show-object-format)
mirror=$work/mirror
clean git init -q --bare --object-format="$object_format" "$mirror"
echo "$common_dir/objects" > "$mirror/objects/info/alternates"

allowlist=$work/allowlist.toml
: > "$allowlist"
if [[ $trusted != none ]]; then
    if ! trusted_commit=$(clean git -C "$repo" rev-parse --verify --quiet "$trusted^{commit}"); then
        echo "leak-scan: trusted ref '$trusted' does not exist in $repo" >&2
        exit 2
    fi
    if clean git -C "$mirror" cat-file -e "$trusted_commit:.leak-scan.toml" 2> /dev/null; then
        clean git -C "$mirror" cat-file blob "$trusted_commit:.leak-scan.toml" > "$allowlist"
    fi
fi

# The filter must come before [extend]: after it, TOML files the filter under that table and betterleaks ignores it.
{
    cat "$allowlist"
    printf '\n[extend]\npath = "%s"\n' "$here/shapes.toml"
} > "$work/shapes.toml"
printf '[extend]\npath = "%s"\n' "$here/shapes.toml" > "$work/shapes-unfiltered.toml"
printf '[extend]\nuseDefault = true\n' > "$work/secrets.toml"

# -c, -i and --ignore-gitleaks-allow stop the scanned repo's own .betterleaks.toml, a .betterleaksignore and inline
# allow comments from silencing findings. Never add --validation: it sends findings to live APIs.
betterleaks_scan() {
    local config=$1 report=$2
    shift 2
    local status=0
    clean betterleaks "$@" -c "$config" -i "$work/no-ignore-file" --ignore-gitleaks-allow \
        --no-banner --no-color -l error --exit-code 3 -f json -r "$report" || status=$?
    if (( status != 0 && status != 3 )); then
        echo "leak-scan: betterleaks exited $status" >&2
        exit 2
    fi
}

# betterleaks runs `git log -p -U0` with these options. A merge's commits are scanned on their own, so only what the
# merge itself adds (an evil merge, a conflict resolution) needs scanning, and the remerge diff is exactly that.
patch_opts=(--diff-merges=remerge)

# scan <out> <git-dir> <shapes-config> <revision>...: writes <out>/{shapes,secrets}-{git,text}.json. Text the caller
# put in <out>/text beforehand, such as ref names, is scanned with the rest.
scan() {
    local out=$1 git_dir=$2 shapes=$3
    shift 3
    local git=(clean git -C "$git_dir")
    mkdir -p "$out/text"

    # Git prints no remerge diff for a merge of three or more parents, so what one adds would go unscanned.
    if [[ -n $("${git[@]}" log --min-parents=3 --format=%H "$@") ]]; then
        echo "leak-scan: the revisions include an octopus merge, which cannot be scanned" >&2
        exit 2
    fi

    "${git[@]}" log --format=%H "$@" | while read -r sha; do
        "${git[@]}" log -1 --format=%B "$sha" > "$out/text/$sha.message"
        "${git[@]}" log -1 --format='%an <%ae>%n%cn <%ce>' "$sha" > "$out/text/$sha.identity"
    done
    "${git[@]}" -c core.quotePath=false log --format= --name-only --diff-merges=remerge "$@" | sort -u > "$out/text/file-names"

    local revision object tag
    for revision in "$@"; do
        [[ $revision == [-^]* ]] && continue
        object=$revision
        while [[ $("${git[@]}" cat-file -t "$object") == tag ]]; do
            tag=$("${git[@]}" cat-file tag "$object")
            # The first line names the tagged object, whose hash would be a hex-identifier finding on every tag.
            printf '%s\n' "${tag#*$'\n'}" > "$out/text/$object.tag"
            object=${tag%%$'\n'*}
            object=${object#object }
        done
    done

    local log_opts="${patch_opts[*]} $*"
    betterleaks_scan "$shapes" "$out/shapes-git.json" git "$git_dir" --log-opts="$log_opts"
    betterleaks_scan "$work/secrets.toml" "$out/secrets-git.json" --redact=100 git "$git_dir" --log-opts="$log_opts"
    scan_text "$out" "$shapes"
}

# scan_text <out> <shapes-config>: writes <out>/{shapes,secrets}-text.json for the files in <out>/text.
scan_text() {
    betterleaks_scan "$2" "$1/shapes-text.json" dir "$1/text"
    betterleaks_scan "$work/secrets.toml" "$1/secrets-text.json" --redact=100 dir "$1/text"
}

# Plants an email address in every place the scan reads and stops if any goes unreported, so a betterleaks or git
# upgrade that changes what either reads fails the scan instead of passing everything.
self_check() {
    local dir=$work/self-check at=@
    # Assembled at run time so this line does not match the pattern scan.
    local email=leak-scan-canary${at}canary.dev
    local git=(clean git -C "$dir/repo" -c user.name=canary -c user.email="$email")
    clean git init -q --bare "$dir/repo"

    local leak empty tree root side merge tag
    leak=$(printf 'mail %s\n' "$email" | "${git[@]}" hash-object -w --stdin)
    empty=$(printf '' | "${git[@]}" hash-object -w --stdin)
    tree=$(printf '100644 blob %s\tcontent\n100644 blob %s\t%s\n' "$leak" "$empty" "$email" | "${git[@]}" mktree)
    root=$("${git[@]}" commit-tree -m "mail $email" "$tree")
    side=$("${git[@]}" commit-tree -p "$root" -m side "$tree")
    tree=$( ("${git[@]}" ls-tree "$tree"; printf '100644 blob %s\tmerged\n' "$leak") | "${git[@]}" mktree)
    merge=$("${git[@]}" commit-tree -p "$root" -p "$side" -m merge "$tree")
    tag=$(printf 'object %s\ntype commit\ntag canary\ntagger canary <%s> 0 +0000\n\nmail %s\n' "$merge" "$email" "$email" | "${git[@]}" mktag)

    mkdir -p "$dir/out/text"
    printf '%s\n' "$email" > "$dir/out/text/ref-names"
    scan "$dir/out" "$dir/repo" "$work/shapes-unfiltered.toml" "$tag"

    local found
    found=$(jq -r -s --arg text "$dir/out/text/" '
        [.[0][], .[1][] | select(.RuleID == "email-address") | .File | ltrimstr($text) | sub("^[0-9a-f]+\\."; "")]
        | unique | join(" ")
    ' "$dir/out/shapes-git.json" "$dir/out/shapes-text.json")
    if [[ $found != "content file-names identity merged message ref-names tag" ]]; then
        echo "leak-scan: self-check found its planted address only in: $found" >&2
        exit 2
    fi
}

self_check
mkdir -p "$work/push/text"
if [[ -n $text_file ]]; then
    cp "$text_file" "$work/push/text/body"
    scan_text "$work/push" "$work/shapes.toml"
    echo '[]' > "$work/push/shapes-git.json"
    echo '[]' > "$work/push/secrets-git.json"
else
    printf '%s\n' "${ref_names[@]}" > "$work/push/text/ref-names"
    scan "$work/push" "$mirror" "$work/shapes.toml" "${revisions[@]}"
    if [[ $allow_message_hex == true ]]; then
        jq 'map(select((.RuleID == "hex-identifier" and (.File | endswith(".message"))) | not))' \
            "$work/push/shapes-text.json" > "$work/push/shapes-text.kept.json"
        mv "$work/push/shapes-text.kept.json" "$work/push/shapes-text.json"
    fi
fi

if [[ -n $export_dir ]]; then
    cp -R "$work/push/text" "$export_dir/text"
    clean git -C "$mirror" log -p -U0 "${patch_opts[@]}" "${revisions[@]}" > "$export_dir/patch"
    # numstat gives a binary file `-` for both line counts; deletions and renames are left out, since neither publishes
    # new binary content.
    clean git -C "$mirror" -c core.quotePath=false log --format=%H --numstat --no-renames --diff-filter=d \
        "${patch_opts[@]}" "${revisions[@]}" \
        | awk -F '\t' 'NF == 1 && $1 != "" { commit = $1 } $1 == "-" && $2 == "-" { print commit " " $3 }' \
        > "$export_dir/binary-files"
fi

# One line per finding:
#   email-address  1a2b3c4d5e6f docs/setup.md:12  someone@example.com
#   ticket-key  1a2b3c4d5e6f (message):3  ABC-123
#   email-address  1a2b3c4d5e6f (identity):1  someone@example.com
#   home-directory  (file names):7  /home/user
#   email-address  (body):4  someone@example.com
# Secret findings omit the match.
report() {
    jq -r --arg text "$work/push/text/" --arg pass "$2" --argjson show_match "$3" '
        .[]
        | (.File | ltrimstr($text)) as $file
        | (if $pass == "git" then "\(.Commit[0:12]) \($file)"
           elif $file == "file-names" then "(file names)"
           elif $file == "ref-names" then "(ref names)"
           elif $file == "body" then "(body)"
           else ($file | capture("^(?<sha>[0-9a-f]+)\\.(?<kind>.*)$") | "\(.sha[0:12]) (\(.kind))") end) as $where
        | "\(.RuleID)  \($where):\(.StartLine)" + (if $show_match then "  \(.Match)" else "" end)
    ' "$1"
}

findings=0
for name in shapes-git shapes-text secrets-git secrets-text; do
    count=$(jq length "$work/push/$name.json")
    findings=$(( findings + count ))
    show_match=false
    [[ $name == shapes-* ]] && show_match=true
    report "$work/push/$name.json" "${name#*-}" "$show_match"
done

if (( findings > 0 )); then
    echo "leak-scan: $findings finding(s)" >&2
    exit 1
fi
