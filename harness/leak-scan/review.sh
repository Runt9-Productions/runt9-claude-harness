#!/usr/bin/env bash
# Runs the public-leak lens as an agent over text about to be published and fails unless every finding is rated Normal.
#
#   review.sh [--cache <dir>] <bundle-dir> <git-dir> <trusted-commit> <request> <input>...
#
# Each input is copied into <bundle-dir>, an empty directory the caller made, under its own name; an empty input is
# left out. The lens, the lens-review agent that names its model, the lens-review plugin's reviewer brief, the review
# profile and CLAUDE.md come from <trusted-commit> in <git-dir>, never the working tree, so the change under review
# cannot rewrite its own review; the profile and CLAUDE.md may be absent. <request> tells the agent what the inputs
# are. With --cache, a pass is recorded in <dir> under a hash of the bundle, the model and every file in the installed
# githooks/ and leak-scan/, and the same review is not run twice; it needs githooks/ beside leak-scan/.
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

# A repository that carries the lens-review plugin has the brief inside it; any other keeps its own copy beside its
# agent definitions.
for path in .claude/agents/lens-review/reference/public-leak.md \
    plugins/lens-review/skills/lens-review/references/reviewer-brief.md .claude/agents/references/reviewer-brief.md \
    .claude/code-review-profile.md CLAUDE.md; do
    if git --git-dir="$git_dir" cat-file -e "$trusted:$path" 2> /dev/null; then
        git --git-dir="$git_dir" cat-file blob "$trusted:$path" > "$bundle/${path##*/}"
    fi
done
lens=$bundle/public-leak.md
if [[ ! -f $lens ]]; then
    echo "leak-review: $trusted has no .claude/agents/lens-review/reference/public-leak.md" >&2
    exit 2
fi
if [[ ! -f $bundle/reviewer-brief.md ]]; then
    echo "leak-review: $trusted has no reviewer brief, in plugins/lens-review or .claude/agents/references" >&2
    exit 2
fi
# Outside the bundle, since only its model is used and the review has no need to read it.
agent_file=$scratch/lens-review.md
if ! git --git-dir="$git_dir" cat-file blob "$trusted:.claude/agents/lens-review/lens-review.md" > "$agent_file" \
    2> /dev/null; then
    echo "leak-review: $trusted has no .claude/agents/lens-review/lens-review.md" >&2
    exit 2
fi
if [[ $(head -n 1 "$agent_file") != --- ]]; then
    echo "leak-review: lens-review.md in $trusted does not start with frontmatter" >&2
    exit 2
fi
# The value of `model: value` between the agent file's opening `---` and the next one. It reads one line and keeps any
# quotes, so lens-review.md must give `model` as a single unquoted line.
model=$(sed -n '2,/^---$/s/^model: //p' "$agent_file")

# A pass holds only for this content under this gate and model, so changing any installed file invalidates every pass.
if [[ -n $cache ]]; then
    key=$( { (cd "${here%/*}" && find githooks leak-scan -type f -print0 | sort -z | xargs -0 sha256sum)
             (cd "$bundle" && sha256sum -- *)
             printf '%s\n' "$model"; } | sha256sum | cut -d' ' -f1)
    mkdir -p "$cache"
    if [[ -f $cache/$key ]]; then
        echo "leak-review: this text already passed" >&2
        exit 0
    fi
fi

# Severity enum and field names are read by the jq calls below.
schema='{
  "type": "object", "additionalProperties": false, "required": ["findings", "open_questions"],
  "properties": {
    "findings": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["severity", "location", "text", "reveals"],
      "properties": {"severity": {"enum": ["Critical", "High", "Normal"]}, "location": {"type": "string"},
                     "text": {"type": "string"}, "reveals": {"type": "string"}}}},
    "open_questions": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["location", "text", "question"],
      "properties": {"location": {"type": "string"}, "text": {"type": "string"}, "question": {"type": "string"}}}}
  }
}'

request="$request In the input files, a line longer than 4000 characters is split into pieces of 4000 that overlap \
by 200. The reviewer brief, the repository's review profile and CLAUDE.md, where it has them, are reviewer-brief.md, \
code-review-profile.md and CLAUDE.md, all here. Read every input file to its last line, in pages where it \
is long. Report every finding and open question in the structured output."

# A lens has no frontmatter: the whole file is the prompt, and the first non-empty line after its title is its summary.
jq -n --arg description "$(sed -n '2,$ { /[^[:space:]]/ { p; q; } }' "$lens")" --arg prompt "$(< "$lens")" \
    '{"public-leak": {description: $description, prompt: $prompt}}' > "$scratch/agents.json"

# The review gets only these variables, so nothing the caller sets can alter it: not ANTHROPIC_BASE_URL, NODE_OPTIONS
# or a plugin directory. The auth variables name a credential, never where it is sent. The proxy variables pass through
# because a sandboxed shell reaches the network only through its proxy; a caller able to aim them at a fake endpoint
# could as easily skip the hook, so the review guards against accidents, not against its caller.
review_env=(PATH="$PATH" HOME="$HOME")
for name in USER LOGNAME LANG LC_ALL LC_CTYPE ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN \
    HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy NO_PROXY no_proxy; do
    if [[ -n ${!name:-} ]]; then
        review_env+=("$name=${!name}")
    fi
done

# --restricted confines Read to the bundle and loads no CLAUDE.md, so the review reads only what was put there.
# MCP servers and every tool but Read stay out.
status=0
(cd "$bundle" && env -i "${review_env[@]}" timeout 900 claude -p --restricted --agent public-leak \
    --agents "$scratch/agents.json" --setting-sources project --strict-mcp-config --tools Read \
    --model "${model:-opus}" --effort high --no-session-persistence --output-format stream-json --verbose \
    --json-schema "$schema" "$request" < /dev/null > "$scratch/stream.jsonl" 2> "$scratch/claude.stderr") || status=$?
# The verdict is the last result line. Output that is not JSON lines leaves result.json empty, which reads as no verdict.
jq -n 'last(inputs | select(.type == "result"))' "$scratch/stream.jsonl" > "$scratch/result.json" \
    2>> "$scratch/claude.stderr" || true
if (( status != 0 )) || ! jq -e '.structured_output | objects' "$scratch/result.json" > /dev/null; then
    echo "leak-review: did not run (claude exited $status)" >&2
    cat "$scratch/claude.stderr" >&2
    exit 2
fi

jq -r '.structured_output
    | (.findings[] | "\(.severity)  \(.location)\n  \(.text)\n  \(.reveals)"),
      (.open_questions[] | "Question  \(.location)\n  \(.text)\n  \(.question)")' "$scratch/result.json" >&2

# What the review read is taken from Read's own results in the stream, never from the model's answer. Each result covers
# numLines lines from startLine, and names its file by the path Read was given: absolute, or the bare name relative to
# the bundle. Walking them in order of start from line 1, a range extends what was read only where it touches it and
# never shrinks it, so a skipped page ends the walk like a short last one. A result whose fields are missing or
# of another type is left out, so a changed result shape refuses rather than passes.
for input in "${inputs[@]}"; do
    lines=$(wc -l < "$bundle/$input")
    first_unread=$(jq -n --arg name "$input" '
        [inputs | select(.type == "user") | .tool_use_result | objects | .file | objects
            | select(.filePath | strings | . == $name or endswith("/" + $name))
            | [.startLine, .numLines] | select(all(type == "number"))]
        | sort
        | reduce .[] as [$start, $count] (1; if $start <= . then [., $start + $count] | max else . end)' \
        "$scratch/stream.jsonl")
    if (( first_unread <= lines )); then
        echo "leak-review: did not read line $first_unread of the $lines lines in $input" >&2
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
