# githooks

Hooks for a repository an agent commits and pushes in under its own bot identity: an authorship check in
`pre-commit`, `pre-merge-commit` and `pre-push`, and a leak gate in `pre-push` after it. See Install below.

## Authorship

Keeps the agent from committing or pushing as its owner. Set in the repository's git config:

| Key | Meaning |
|---|---|
| `claude.botEmail` | The bot's commit email. Unset, the authorship check does nothing. |
| `claude.botName` | The bot's commit name. Required once `claude.botEmail` is set. |
| `claude.branchPrefix` | The only branches the bot may push. Default `claude/`, also when set empty. |

The hooks check only where `CLAUDE_CODE_SESSION_ID` is set, which Claude Code sets for every command a session runs.
A commit or push the owner runs in their own shell passes untouched; one run from inside a session, such as a
`! git push`, is checked like the agent's.

- `pre-commit` refuses a commit whose author or committer is not `claude.botName <claude.botEmail>` and prints the
  `git -c user.name=... -c user.email=... commit` to use instead, with `--amend --reset-author` for an amend.
  `pre-merge-commit` runs the same check for the commit `git merge` makes.
- `pre-push` refuses a push to or deletion of any ref outside `claude.branchPrefix`. It also refuses a push of any
  commit whose author or committer is not the bot and that no remote-tracking ref already has, naming each such
  commit with its wrong identity. A rebase, a cherry-pick or a fast-forward merge can bring in such a commit without
  `pre-commit` ever seeing it. Any remote's tracking refs count, so commits a merge brings in from a branch already on
  any remote, such as main, are not checked again. It runs before the leak gate, so a push it refuses spends no review.

`--no-verify` skips all three, and a remote-tracking ref left behind after its branch was deleted on the remote can
take a commit out of the push check. Branch rules on the server are the control; these hooks turn a likely mistake
into an immediate local error.

## pre-push: leak gate

Refuses a push that would publish private information. It checks what the push publishes: every commit the pushed
refs reach that no branch or tag on the remote already has, the annotated tags it pushes, and the pushed ref names.

1. `../leak-scan/scan.sh` checks added lines, commit messages, author and committer identities, tags, file names and
   ref names for shapes and secrets.
2. If the scan passes, the `public-leak` agent reviews exactly what the scan read (`scan.sh --export`) through
   `claude -p`. Any finding not rated Normal refuses the push, and so does any open question, or a review that does
   not report reading every input to its last line. Normal findings are only printed.

Neither the scan nor the review reads binary content. The review raises an open question for every binary file the
push adds or changes, so such a push is always refused, and binaries go out only over the SSH override below.

Any error refuses the push, including a missing tool, a failed `claude` run or a remote whose default branch cannot be
fetched.

**What it trusts.** At push time the hook fetches the remote's default branch and its branch and tag tips from the
push URL into a temporary mirror. The agent definition, reviewer brief, review profile, `CLAUDE.md` and leak-scan
allowlist come from that default branch, never from the branch being pushed or from the clone's remote-tracking refs.
A repository whose default branch has no `.claude/agents/code-review/public-leak.md` cannot be pushed through this
hook. The scan reads the mirror, so the repository's config and attributes cannot change what it reads. The review
runs under `--restricted`, so it reads only its own inputs and loads no `CLAUDE.md`.

The review also runs with a fixed environment: `PATH`, `HOME`, `USER`, `LOGNAME`, the locale, and
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` where set. Nothing else reaches it, so the
session the push runs in (its plugin directories, `NODE_OPTIONS`, a proxy) does not change it. A login stored under
`~/.claude` works as is. Bedrock, Vertex, a custom endpoint or `CLAUDE_CONFIG_DIR` do not, and such a setting would belong in a config
file under the install directory, which does not exist yet. Lines longer than 4000 characters reach the review split
into overlapping pieces, because Read refuses a single line past its token cap.

**What it stops.** The mistakes of an agent pushing as a bot, including the common wrong fixes for a refused push:
allowlisting its own leak, setting `LEAK_SCAN_SKIP` on the bot's remote. It cannot stop a process running as the
same user. `git push --no-verify`, a `core.hooksPath`
override, editing the installed copy or its state, pushing from a clone without the hook, pushing a ref that names a
blob or a tree rather than a commit, and setting `BASH_ENV`, `PATH`, `HOME` or git's own environment
(`GIT_CONFIG_GLOBAL`, `GIT_SSH_COMMAND`, a proxy) for the push all skip or subvert it, so the agent's harness has to
refuse those. An agent set on defeating it also holds the bot's key and can push without git at all; review before
merge is the control there. CI on the public repository is the backstop, and it runs only after a pushed branch is
already public.

A passing review is cached in `<dir>/state/passed/`, keyed by the hash of what the agent read and of every file in the
installed copy. Pushing the same commits again costs nothing; updating the installed copy reviews them again.

**Override:** `LEAK_SCAN_SKIP=1 git push` skips the scan and the review, but only on an SSH remote, and never the
authorship check. On any other remote it refuses the push instead. It is for the owner, for example to push a binary
file. An agent that can reach an SSH key can use it too, so the agent's harness has to keep it on HTTPS.

Needs whatever `leak-scan` needs, plus `claude`, logged in. A review costs about $0.10 to $0.50, depending on the size
of the diff.

## Install

**Install a copy, not the checkout.** From your own shell, in a clone of this repository:

```
python3 bootstrap.py githooks hooks-path --repo <path> [--repo <path> ...]
```

`githooks` copies `githooks/` and `leak-scan/` from the commit checked out into `~/.claude/harness/` and records the
commit in `~/.claude/harness/SOURCE_COMMIT`; `hooks-path` sets `core.hooksPath` to `~/.claude/harness/githooks` in
each repository named. By hand, copy the two directories side by side into one directory outside the repository and
run `git config core.hooksPath <dir>/githooks` in each repository the agent works in.

Each `bootstrap.py githooks` run replaces `githooks/` and `leak-scan/` whole, so no other file belongs in them. The
leak gate keeps its pass cache and working files in `<dir>/state/`, which a reinstall keeps, so whatever keeps the
agent from writing to the installed copy has to cover all of `<dir>`. Nothing in this repository does that; it is
your harness's job.

`core.hooksPath` replaces `.git/hooks/`, so git runs only these hooks: a repository's own other hooks do not run with
this install. Set the authorship keys above in the same repository; without them only the leak gate runs.
