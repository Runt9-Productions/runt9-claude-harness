# leak-scan

Scans what a range of commits would publish: added lines of text files, commit messages, author and committer names
and emails, annotated tags, file names and ref names. Two passes of [betterleaks](https://github.com/betterleaks/betterleaks):

- `shapes.toml`: text shaped like private information (email addresses, home directories, IP and MAC addresses,
  internal host names, unknown URL hosts, ticket keys, UUIDs, long hex ids). Paranoid on purpose: a false positive
  costs an allowlist entry, a miss is public for good.
- betterleaks' default rules, which find secrets. Their matches are redacted in the output.

Names, customers and project vocabulary have no shape; the `public-leak` review agent covers those. `review.sh` runs
it, with its instructions taken from a trusted commit, over the files a caller gives it: pre-push gives it what a push
publishes, and `review-text.sh <file> <repo> <trusted-ref>` runs this scan's `--text` mode and then the review over an
issue or pull request body before it is posted. Both exit 0 clean, 1 on a finding not rated Normal, 2 when a check
did not run.

**Binary content is not scanned.** A file git's own detection calls binary (a NUL byte near its start) is skipped,
whatever its name, so a text file with a NUL in it is skipped too. `--export` lists the binary files a range adds,
for the review to look at instead. A merge is scanned for what it adds beyond git's own merge of its parents (its
remerge diff), since the merged commits are scanned on their own; an octopus merge has no remerge diff and exits 2.
The repo's and the user's git config and attributes do not apply, so they cannot change what is read or what counts
as binary. Before scanning, the scan plants an address in each of these places in a throwaway repository and fails
if any goes unreported.

## Use

```sh
scan.sh [--ref <ref name>]... [--export <dir>] <repo> <trusted-ref|none> <git log revisions...>
scan.sh --ref refs/heads/topic . origin/main origin/main..topic
scan.sh --text <file> <repo> <trusted-ref|none>
```

- `--text <file>`: scans one file instead of commits, with the same rules and the allowlist from `<trusted-ref>`. It
  is for text published outside git, such as an issue or pull request body before it is posted. It takes no
  `--ref`, `--export` or revisions.

- `--ref`: a ref name the push creates or updates on the remote, such as `refs/heads/topic` or `refs/tags/v1`. A
  push publishes the name, so it is scanned too. Repeat it for each ref.
- `--export <dir>`: writes what the scan read, so a review can read exactly the same thing. `<dir>` must be missing
  or empty. It is written on exit 0 and 1; after exit 2 it may be partial.
  - `patch`: the `git log -p -U0 --diff-merges=remerge` output betterleaks scanned, in git's default format.
  - `text/<sha>.message`: a commit's raw message.
  - `text/<sha>.identity`: `author <email>` on line 1, `committer <email>` on line 2.
  - `text/<sha>.tag`: an annotated tag object without its `object` line: type, tag name, tagger, message.
  - `text/file-names`: every path added or changed, sorted, unquoted.
  - `text/ref-names`: the `--ref` values.
  - `binary-files`: `<commit> <path>` for each binary file added or changed. Its content was not scanned.
- Revisions are anything `git rev-parse` resolves: `A..B`, `<sha> --not --remotes=origin`. Pass an annotated tag
  itself, not the commit it points at, so its message and tagger are scanned.

Exit 0 clean, 1 findings, 2 the scan did not run. A caller treats 2 as a failure, never as clean. A shallow or
partial clone that lacks an object the revisions reach exits 2.

Needs `betterleaks` (tuned on 1.9.0), `git` 2.36 or later (for `--remerge-diff`) and `jq` on `PATH`.

A gate runs an installed copy of this directory, never the copy in the checkout it scans, so a branch cannot
change its own scan.

## Allowlist

A repo allowlists findings in `.leak-scan.toml` at its root: one top-level `filter`, an
[Expr](https://expr-lang.org/) expression that returns true for a finding to drop. Put nothing else in it: rules,
an `[extend]` or a legacy `[allowlist]` would change what is scanned. A filter betterleaks cannot compile is ignored,
so every finding is reported.

```toml
filter = '''
(attributes["path"] == "docs/hosts.md" && finding["rule_id"] == "internal-hostname") ||
filter.matchesAny(finding["match"], [`^ABC-123$`])
'''
```

`attributes["path"]` is the file's path in the repo for added lines, and for everything else the absolute path of a
temporary file named as in the `text/` layout above, so `attributes["path"] matches "/[0-9a-f]{40,64}\\.identity$"` scopes an
entry to commit identities. `finding["line"]` ends with the line's newline.

The scan reads it from `<trusted-ref>`, the reviewed default branch, so a new entry takes effect only once it has
merged. The repo's own `.betterleaks.toml`, `.betterleaksignore` and inline `betterleaks:allow` comments are ignored.

Never run betterleaks with `--validation` on these findings: it sends them to live APIs.
