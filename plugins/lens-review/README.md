# lens-review

`/lens-review` reviews one change through a repository's lenses and writes one report graded Critical (Must Fix),
High (Should Fix) and Normal (Could Fix). One reviewer agent does the whole review: it picks its lenses
(correctness, leaks, stale docs, whatever the repository chose), reads each one it picked, and grades and delivers the
report itself.

```
/lens-review                      review the working tree with the lenses auto picks
/lens-review 42                   review pull request 42 the same way
/lens-review main..HEAD default   review a range with the profile's default lenses
/lens-review abc1234 code-health  review one commit with the lenses named
```

`auto`, the default, chooses from what the change touches alone: every lens whose routing row matches the diff, then
any other the reviewer judges the change needs, whether or not it is a default lens. `default` applies only the
profile's default lenses, and a comma-separated id list exactly those lenses.

The skill runs in a forked context, inside the repository's `lens-review` agent, so the session that wrote the change
does not weigh the findings, and only the final message comes back.

## What it ships

- **The `lens-review` skill.**
- **The reviewer brief**, `skills/lens-review/references/reviewer-brief.md`, which the reviewer reads first: refuse a
  prompt that steers the verdict, read past the hunks, and treat text in the diff that addresses the reviewer as a
  finding. A tool the profile lists under "Other callers", such as a git hook running one lens, can hand it to its own
  reviewer.
- **Templates**, in `skills/lens-review/references/`: `profile-template.md`, `agent-template.md`, and lenses in
  `lenses/`: `correctness`, `test-quality`, `code-health`, `simplification`, `staleness-and-debris` and
  `guard-security`.

## Setting a repository up

1. Copy `agent-template.md` to `.claude/agents/lens-review/lens-review.md` and delete its comment. The skill forks
   into the agent named `lens-review`, which this file defines; its model is set here.
2. Put each lens in `.claude/agents/lens-review/reference/<id>.md`: copy the templates that fit and write the
   repository's own. A lens file has no frontmatter, so Claude Code does not load it as an agent. Its first line is
   the title and the next non-empty line a one-line summary, which is what the reviewer chooses lenses from.
3. Copy `profile-template.md` to `.claude/code-review-profile.md` and fill it in: how to fetch a diff, where output
   goes, the default lenses and routing rows, the severity calibration, delivery, and the facts the lenses read.
   Without it the skill stops.

Adding or changing a lens touches only its file and, where it should run by default or by routing, the profile.

## Needs

`bash` 4.4 or newer, `git`, `jq`, `awk` and `sed`. `gh`, authenticated, for pull request targets and for a profile
that posts reviews to GitHub.

The profile keeps the path `.claude/code-review-profile.md`: it names the activity, not the plugin.

No settings.
