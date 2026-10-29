#!/usr/bin/env bash
# Runs the public-leak agent over text about to be published and fails unless every finding is rated Normal.
#
#   review.sh [--cache <dir>] <bundle-dir> <git-dir> <trusted-commit> <request> <input>...
#
# Each input is copied into <bundle-dir>, an empty directory the caller made, under its own name; an empty input is
# left out. The agent's definition, the lens-review plugin's reviewer brief, the review profile and CLAUDE.md come from
# <trusted-commit> in <git-dir>, never the working tree, so the change under review cannot rewrite its own review; any
# but the agent's definition may be absent. <request> tells the agent what the inputs are. With --cache, a pass is
# recorded in <dir> under a hash of the bundle and of every file in the installed githooks/ and leak-scan/, and the
# same review is not run twice; it needs githooks/ beside leak-scan/.
#
# Exit 0 passed, 1 a finding not rated Normal or an open question, 2 the review did not run. Treat 2 as a failure.
set -Eeuo pipefail
trap 'echo "leak-review: failed at line $LINENO" >&2; exit 2' ERR

usage() {
    echo "usage: review.sh [--cache <dir>] <bundle-dir> <git-dir> <trusted-commit> <request> <input>..." >&2
    exit 2
}

cache=
if [[ ${1:-} == --cache ]]; then
    (( $# >= 2 )) || usage
    cache=$2
    shift 2
fi
(( $# >= 5 )) || usage
bundle=$1
git_dir=$2
trusted=$3
request=$4
shift 4
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ ! -d $bundle || -n $(ls -A "$bundle") ]]; then
    echo "leak-review: $bundle must be an empty directory" >&2
    exit 2
fi
# Beside the bundle, so the review's working files stay inside whatever location the caller guards.
scratch=$(mktemp -d "${bundle%/*}/review.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

# Read pages by whole lines and refuses a line past its 25,000-token cap. Longer lines are split into overlapping
# pieces, so the review can read all of one, and text cut at a split is still whole in the next piece.
split_long_lines() {
    awk -v width=4000 -v overlap=200 '
        length($0) <= width { print; next }
        {
            for (start = 1; ; start += width - overlap) {
                print substr($0, start, width)
                if (start + width > length($0)) break
            }
        }'
}

inputs=()
for input in "$@"; do
    name=${input##*/}
    split_long_lines < "$input" > "$bundle/$name"
    if [[ -s $bundle/$name ]]; then
        inputs+=("$name")
    else
        rm "$bundle/$name"
    fi
done

for path in .claude/agents/code-review/public-leak.md \
    plugins/lens-review/skills/lens-review/references/reviewer-brief.md .claude/code-review-profile.md CLAUDE.md; do
    if git --git-dir="$git_dir" cat-file -e "$trusted:$path" 2> /dev/null; then
        git --git-dir="$git_dir" cat-file blob "$trusted:$path" > "$bundle/${path##*/}"
    fi
done
agent_file=$bundle/public-leak.md
if [[ ! -f $agent_file ]]; then
    echo "leak-review: $trusted has no .claude/agents/code-review/public-leak.md" >&2
    exit 2
fi

# A pass holds only for this content under this gate, so changing any installed file invalidates every pass.
if [[ -n $cache ]]; then
    key=$( { (cd "${here%/*}" && find githooks leak-scan -type f -print0 | sort -z | xargs -0 sha256sum)
             (cd "$bundle" && sha256sum -- *); } | sha256sum | cut -d' ' -f1)
    mkdir -p "$cache"
    if [[ -f $cache/$key ]]; then
        echo "leak-review: this text already passed" >&2
        exit 0
    fi
fi

# Severity enum and field names are read by the jq calls below.
schema='{
  "type": "object", "additionalProperties": false, "required": ["findings", "open_questions", "read"],
  "properties": {
    "findings": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["severity", "location", "text", "reveals"],
      "properties": {"severity": {"enum": ["Critical", "High", "Normal"]}, "location": {"type": "string"},
                     "text": {"type": "string"}, "reveals": {"type": "string"}}}},
    "open_questions": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["location", "text", "question"],
      "properties": {"location": {"type": "string"}, "text": {"type": "string"}, "question": {"type": "string"}}}},
    "read": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["file", "lines"],
      "properties": {"file": {"type": "string"}, "lines": {"type": "integer"}}}}
  }
}'

request="$request In the input files, a line longer than 4000 characters is split into pieces of 4000 that overlap \
by 200. The reviewer brief, the repository's review profile and CLAUDE.md, where it has them, are reviewer-brief.md, \
code-review-profile.md and CLAUDE.md, all here. Read every input file to its last line, in pages where it \
is long, and give each one's name and the last line number you read of it in read. Report every finding and open \
question in the structured output."

if [[ $(head -n 1 "$agent_file") != --- ]]; then
    echo "leak-review: public-leak.md in $trusted does not start with frontmatter" >&2
    exit 2
fi
# frontmatter_field <key>: the value of `key: value` between the agent file's opening `---` and the next one. It reads
# one line and keeps any quotes, so public-leak.md must give `description`, `model` and `effort` as single unquoted lines.
frontmatter_field() {
    sed -n "2,/^---\$/s/^$1: //p" "$agent_file"
}
model=$(frontmatter_field model)
effort=$(frontmatter_field effort)
jq -n --arg description "$(frontmatter_field description)" --arg prompt "$(sed '1,/^---$/d' "$agent_file")" \
    '{"public-leak": {description: $description, prompt: $prompt}}' > "$scratch/agents.json"

# The review gets only these variables, so nothing the caller sets can redirect or alter it: not ANTHROPIC_BASE_URL, a
# proxy, NODE_OPTIONS or a plugin directory. The auth variables name a credential, never where it is sent.
review_env=(PATH="$PATH" HOME="$HOME")
for name in USER LOGNAME LANG LC_ALL LC_CTYPE ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN; do
    if [[ -n ${!name:-} ]]; then
        review_env+=("$name=${!name}")
    fi
done

# --restricted confines Read to the bundle and loads no CLAUDE.md, so the review reads only what was put there.
# MCP servers and every tool but Read stay out.
status=0
(cd "$bundle" && env -i "${review_env[@]}" timeout 900 claude -p --restricted --agent public-leak \
    --agents "$scratch/agents.json" --setting-sources project --strict-mcp-config --tools Read \
    --model "${model:-opus}" --effort "${effort:-high}" --no-session-persistence --output-format json --json-schema "$schema" \
    "$request" < /dev/null > "$scratch/result.json" 2> "$scratch/claude.stderr") || status=$?
if (( status != 0 )) || ! jq -e '.structured_output | objects' "$scratch/result.json" > /dev/null; then
    echo "leak-review: did not run (claude exited $status)" >&2
    cat "$scratch/claude.stderr" >&2
    exit 2
fi

jq -r '.structured_output
    | (.findings[] | "\(.severity)  \(.location)\n  \(.text)\n  \(.reveals)"),
      (.open_questions[] | "Question  \(.location)\n  \(.text)\n  \(.question)")' "$scratch/result.json" >&2

for input in "${inputs[@]}"; do
    lines=$(wc -l < "$bundle/$input")
    read_lines=$(jq --arg file "$input" '[.structured_output.read[] | select(.file == $file) | .lines] | max // 0' \
        "$scratch/result.json")
    if (( read_lines < lines )); then
        echo "leak-review: read $read_lines of the $lines lines in $input" >&2
        exit 2
    fi
done

blocking=$(jq '.structured_output
    | ([.findings[] | select(.severity != "Normal")] | length) + (.open_questions | length)' "$scratch/result.json")
if (( blocking > 0 )); then
    echo "leak-review: raised $blocking question(s) or finding(s) not rated Normal" >&2
    exit 1
fi
if [[ -n $cache ]]; then
    touch "$cache/$key"
fi
