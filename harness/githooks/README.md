# githooks

## pre-push

Refuses a push that would publish private information. It checks what the push publishes: every commit the pushed
refs reach that no branch or tag on the remote already has, the annotated tags it pushes, and the pushed ref names.

1. `../leak-scan/scan.sh` checks added lines, commit messages, author and committer identities, tags, file names and
   ref names for shapes and secrets.
2. If the scan passes, the `public-leak` agent reviews exactly what the scan read (`scan.sh --export`) through
   `claude -p`. Any finding not rated Normal refuses the push, and so does any open question, or a review that does
   not report reading every input to its last line. Normal findings are only printed.

Neither check reads binary content. The review raises an open question for every binary file the push adds or
changes, so such a push is always refused, and binaries go out only over the SSH override below.

Any error refuses the push, including a missing tool, a failed `claude` run or a remote whose default branch cannot be
fetched.

**What it trusts.** At push time the hook fetches the remote's default branch and its branch and tag tips from the
push URL into a temporary mirror. The agent definition, reviewer brief, review profile, `CLAUDE.md` and leak-scan
allowlist come from that default branch, never from the branch being pushed or from the clone's remote-tracking refs.
A repository whose default branch has no `.claude/agents/code-review/public-leak.md` cannot be pushed through this
hook. Git runs without replace refs, grafts, or the repository's config and attributes; the user's git config applies
only to the fetch. A push URL that a global `insteadOf` rule rewrites again for that fetch is refused, since the
base would come from another repository. The review runs under `--restricted`, so it reads only its own inputs and loads no `CLAUDE.md`.

The review also runs with a fixed environment: the pinned `PATH`, `HOME`, `USER`, `LOGNAME`, the locale, and
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` where set. Nothing else reaches it, so a
caller cannot redirect it with `ANTHROPIC_BASE_URL`, a proxy or `NODE_OPTIONS`. A login stored under `~/.claude` works
as is. Bedrock, Vertex, a custom endpoint or `CLAUDE_CONFIG_DIR` do not, and such a setting would belong in a config
file under the install directory, which does not exist yet. Lines longer than 4000 characters reach the review split
into overlapping pieces, because Read refuses a single line past its token cap.

**What it stops.** Mistakes, and the walk-arounds an agent pushing as a bot would try in one command: pointing a
remote-tracking ref at its own commit, allowlisting its own leak, planting a pass marker, putting another `claude`
first on `PATH`. It cannot stop a process running as the same user. `git push --no-verify`, a `core.hooksPath`
override, editing the installed copy or its state, pushing from a clone without the hook, and setting `BASH_ENV`,
`PATH` or `HOME` for the push all skip or subvert it, so the agent's harness has to refuse those. An agent set on
defeating it also holds the bot's key and can push without git at all; review before merge is the control there. CI on the public repository is the backstop, and it runs only after a pushed
branch is already public.

**Install a copy, not the checkout.** Copy `githooks/` and `leak-scan/` side by side into one directory outside the
repository, then set `git config core.hooksPath <dir>/githooks`. The hook keeps its pass cache and working files in
`<dir>/state/`, so whatever keeps the agent from writing to the installed copy has to cover all of `<dir>`.
`core.hooksPath` replaces `.git/hooks/`, so any other hook you rely on has to move into the same directory.

The hook runs tools only from `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` and `/bin`, so
`claude`, `betterleaks`, `git` and `jq` have to be in one of them.

A passing review is cached in `<dir>/state/passed/`, keyed by the hash of what the agent read and of every file in the
installed copy. Pushing the same commits again costs nothing; updating the installed copy reviews them again.

**Override:** `LEAK_SCAN_SKIP=1 git push` skips both checks, but only on an SSH remote. On any other remote it refuses
the push instead. It is for the owner, for example to push a binary file. An agent that can reach an SSH key can use
it too, so the agent's harness has to keep it on HTTPS.

Needs whatever `leak-scan` needs, plus `claude`, logged in. A review costs about $0.10 to $0.50, depending on the size
of the diff.
