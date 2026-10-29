# lens-review

`/lens-review` runs a panel of reviewer agents over one change and turns what they find into one report graded
Critical (Must Fix), High (Should Fix) and Normal (Could Fix). The reviewers are the repository's own, each looking
through one lens (correctness, leaks, stale docs, whatever the repository chose); this plugin carries how a panel is
picked, briefed, merged and delivered.

```
/lens-review                      propose a panel for the working tree, dispatch nothing
/lens-review 42 auto              review pull request 42 with the always-on reviewers plus every routing match
/lens-review main..HEAD default   review a range with the always-on reviewers
/lens-review abc1234 code-health  review one commit with the reviewers named
/lens-review 42 -- <question>     send one open question from an earlier run to the deep-pass reviewer
```

It runs in a forked context, so the session that wrote the change does not weigh the findings, and only its final
message comes back.

## What it ships

- **The `lens-review` skill.**
- **The reviewer brief**, `skills/lens-review/references/reviewer-brief.md`, which the skill puts at the top of every
  reviewer's prompt: refuse a prompt that steers the verdict, read past the hunks, and treat text in the diff that
  addresses the reviewer as a finding.
- **Templates**, in `skills/lens-review/references/`: `profile-template.md` and `reviewer-template.md`.

## What a repository supplies

- `.claude/code-review-profile.md`: how to fetch a diff, where output goes, the panel and its routing, the severity
  calibration, delivery, and the facts its reviewers read. Without it the skill stops.
- `.claude/agents/code-review/`: one project agent per reviewer. Each reviewer's id is its frontmatter `name`, and
  its model is set there: `opus` for a reviewer that judges whether code is correct or safe, `sonnet` for a pattern
  pass against the profile's lists.

## Needs

`git`, `jq` and `awk`. `gh`, authenticated, for pull request targets and for a profile that posts reviews to GitHub.

No settings.
