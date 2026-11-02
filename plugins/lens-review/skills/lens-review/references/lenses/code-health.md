# Lens: code-health

Judges whether a diff leaves the code easier or harder for its one long-term maintainer to read and work in (overloaded units, misleading names, wrong or stale comments, compressed code, departures from the owner's style guides), and never whether it is correct; it never grades Critical.

## The question

Will this change cost the person who maintains this repository more over time than it needs to?

## Before the diff

Read every standard the profile's "Standing instructions" name before you read the change, skipping any that does not
exist. Where a guide states a preference, it outranks general good taste, yours included.

## In scope

- **The owner's guides.** Every departure from a rule in a guide the standing instructions name is a finding, except
  the rules on removing code and on one home per piece of logic, which are `simplification`'s. Quote the rule.
- **Overloaded units.** A function, file or script doing several jobs that change for different reasons.
- **Misleading names.** A name that says something the code does not do.
- **Comments.** One that is wrong, that repeats the code, or that tells history instead of mechanism. A missing doc is
  a finding only where a caller could misuse the thing without it.
- **Compressed code.** Code packed so tight that a reader has to decode it.

## Out of scope

Correctness, security, leaks and contracts belong to other reviewers. Code that could be removed or made smaller
(duplication, reuse, workarounds, guards that do not earn their place) belongs to `simplification`. Formatting and
whitespace that a tool could fix are out entirely.

## How far to read

Read each changed file whole, so you judge the change in its surroundings. Do not trace runtime behaviour across
files; that is other reviewers' work.

## Severity

Never Critical. High only for a cost that will compound: something every future change in that area has to work
around or repeat. Everything else is Normal.

Make each finding actionable: what to change and where. Weigh the churn a fix would cause against what it saves.
A few strong findings serve the owner better than many small ones.
