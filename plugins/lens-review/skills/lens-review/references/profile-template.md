# Code review profile

<!-- Template for `.claude/code-review-profile.md`. Replace each placeholder and delete these comments. Sections marked
"skill" are read by `/lens-review` and must be present; the rest are read by the lenses whose files name them, so
keep a section only while some lens reads it. Whether the profile is tracked is the repository's choice; a tracked
one lets CI and every clone review the same way. -->

Facts about this repository that `/lens-review` needs. The reviewer reads every section; each lens names the sections
it judges against.

## What ships, and why a defect is expensive

<!-- Lenses. Who uses what this repository ships, and what a defect costs them. Two or three sentences. -->

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

## Lenses

<!-- Skill. Every id is the file name, without `.md`, of a lens in `.claude/agents/lens-review/reference/`. -->

Default: `correctness`, `<id>`. These are the lenses `default` applies. `auto` does not read this list: it applies
every lens whose routing row matches, then any other the reviewer judges the change needs.

Routing, binding under `auto` when the diff matches:

| Lens | Matches |
|---|---|
| `test-quality` | any test file added or changed |
| `<id>` | `<paths, globs, or a kind of code>` |

## Severity calibration

<!-- Skill and lenses. What each level looks like here, a few reference points each. -->

The scale is Critical (Must Fix), High (Should Fix), Normal (Could Fix). Reference points for this repo:

- **Critical**: `<what must never merge here>`
- **High**: `<what should be fixed before merge>`
- **Normal**: `<what is worth fixing and fine to defer>`

## Fragile spots CI does not catch

<!-- Lenses. Places where a change can be wrong while every check stays green. -->

## Contracts

<!-- Lenses. Behaviour another component relies on. Each row names both sides, so a change to one is reviewed
against the other. -->

| Contract | Sides |
|---|---|
| `<what is relied on>` | `<the file that provides it>` and `<every file that relies on it>` |

## Living docs

<!-- Lenses. -->

| Doc | Must change when |
|---|---|
| `README.md` | `<what it describes changes>` |

## Mirrors

<!-- Lenses. Copies of a fact kept in more than one place. -->

| Copy | Source | Kept in step by |
|---|---|---|

## Companions

<!-- Lenses. Files that must arrive with a kind of change, such as a version rise or a changelog line. -->

## Test-quality traps

<!-- Lenses. Ways a test here can pass without proving anything. -->

## Debris

<!-- Lenses. Leftovers that should never merge: debug output, focused or skipped tests, commented-out code. -->

## Rulings that are not findings

<!-- Lenses. Decisions the owner made that reviewers must not report again, with the date of each. -->

## Other callers

<!-- Reviewer brief. Optional. Tools other than `/lens-review` that run a lens as a reviewer of its own, such as a git hook, and what
each sends. The reviewer brief accepts only the prompts listed here and the skill's own. -->

## Delivery

<!-- Skill. Where the report goes. With no destination, the skill ends with the report itself. A pull request review
needs: the file the payload goes in, its fields, the length cap on its body, and what happens when the forge rejects
an inline comment. -->

## Standing instructions

<!-- Lenses. What applies to every review, such as which style guides or rules files to judge against. The
`code-health` and `simplification` lenses read the standards it names. -->
