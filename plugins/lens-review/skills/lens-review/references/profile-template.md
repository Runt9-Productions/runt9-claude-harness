# Code review profile

<!-- Template for `.claude/code-review-profile.md`. Replace each placeholder and delete these comments. Sections marked
"skill" are read by `/lens-review` and must be present; the rest are read by the reviewers whose files name them, so
keep a section only while some reviewer reads it. Whether the profile is tracked is the repository's choice; a tracked
one lets CI and every clone review the same way. -->

Facts about this repository that `/lens-review` and its panel need. The skill reads every section; each reviewer
reads the sections its own file names.

## What ships, and why a defect is expensive

<!-- Reviewers. Who uses what this repository ships, and what a defect costs them. Two or three sentences. -->

## Fetching the diff

<!-- Skill. One command per target; the skill runs them as given. -->

| Target | Command |
|---|---|
| Working tree | `git diff HEAD` |
| Commit | `git show <sha>` |
| Range | `git diff <a>..<b>` |

The skill fetches a pull request itself with `gh`.

- Default branch: `<main>`.
- Paths excluded from review, or relevant only to some reviewers: `<none>`.

## Output

<!-- Skill. -->

- Root: `<.claude/output/code-review/>`. Each run writes its own directory under it. A root inside the checkout should
  be git-ignored.
- Inline threshold: a diff under `<300>` lines goes into the reviewer prompts; at that size or more, reviewers read it
  from disk.

## Panel

<!-- Skill. Every id is the `name` of a reviewer under `.claude/agents/code-review/`. -->

Always-on: `<principal-review>`, `<id>`. This is the `default` panel and the floor of `auto`: `auto` runs these
whatever the diff touches, then adds every routing match.

Routing, added when the diff matches:

| Reviewer | Matches |
|---|---|
| `<id>` | `<paths, globs, or a kind of code>` |

Deep pass: `<principal-review>`. An open question the panel could not settle goes to it, scoped to that question,
and its grade weighs most when reviewers disagree, so make it the generalist.

## Severity calibration

<!-- Skill and reviewers. What each level looks like here, a few reference points each. -->

The scale is Critical (Must Fix), High (Should Fix), Normal (Could Fix). Reference points for this repo:

- **Critical**: `<what must never merge here>`
- **High**: `<what should be fixed before merge>`
- **Normal**: `<what is worth fixing and fine to defer>`

## Fragile spots CI does not catch

<!-- Reviewers. Places where a change can be wrong while every check stays green. -->

## Contracts

<!-- Reviewers. Behaviour another component relies on. Each row names both sides, so a change to one is reviewed
against the other. -->

| Contract | Sides |
|---|---|
| `<what is relied on>` | `<the file that provides it>` and `<every file that relies on it>` |

## Living docs

<!-- Reviewers. -->

| Doc | Must change when |
|---|---|
| `README.md` | `<what it describes changes>` |

## Mirrors

<!-- Reviewers. Copies of a fact kept in more than one place. -->

| Copy | Source | Kept in step by |
|---|---|---|

## Companions

<!-- Reviewers. Files that must arrive with a kind of change, such as a version rise or a changelog line. -->

## Test-quality traps

<!-- Reviewers. Ways a test here can pass without proving anything. -->

## Debris

<!-- Reviewers. Leftovers that should never merge: debug output, focused or skipped tests, commented-out code. -->

## Rulings that are not findings

<!-- Reviewers. Decisions the owner made that reviewers must not report again, with the date of each. -->

## Other callers

<!-- Reviewers. Optional. Tools other than `/lens-review` that send a reviewer a prompt, such as a git hook, and what
each sends. The reviewer brief accepts only the prompts listed here and the skill's own. -->

## Delivery

<!-- Skill. Where the report goes. With no destination, the skill ends with the report itself. A pull request review
needs: the file the payload goes in, its fields, the length cap on its body, and what happens when the forge rejects
an inline comment. -->

## Standing instructions

<!-- Skill. Copied word for word into every reviewer's prompt, so it holds only what applies to every review: which
style guides or rules files to judge against, for example. -->
