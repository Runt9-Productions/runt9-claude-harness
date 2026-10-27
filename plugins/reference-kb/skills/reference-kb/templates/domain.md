---
title: Human Readable Name
type: note
permalink: area/slug
tags: [area, subsystem]
verified: YYYY-MM-DD
branch: the-branch-you-read-the-code-on
coverage: partial
sources:
  - path/to/the-file-this-note-is-about.ext
  - path/to/the-other-one-you-actually-read.ext
---

# Human Readable Name

> **Scope.** REPLACE THIS SENTENCE with what *this* note covers and, specifically, what it does not: the class, module, vendor or path that was not read, and anything carried forward unverified from an earlier pass.

One paragraph on what this note is for and when to read it. Say what the reader is about to get wrong if they skip it.

## Observations

- [fact] A single indexable fact, citing `symbolName` plus `TheFile.ext:123`.
- [trap] A fact that belongs to a cross-cutting class, tagged so it is findable from outside this note #silent-failure (and a trailing parenthetical for the qualifier).
- [fact] A fact tied to a ticket #PROJ-123
- [invariant] Holds today, and code elsewhere depends on it holding.
- [risk] A hazard believed but not demonstrated. Say what would confirm it.
- [question] Genuinely open. Say what would answer it.
- [decision] A ruling by whoever owns the decision, with who, where and when, and the reason.
- [history] Why it is this way: ticket, commit, date.

## Relations

- part_of [[Parent Hub Note]]
- see_also [[Some Other Note]]

<!--
CHECKLIST: delete this block before saving.

  [ ] permalink = the path under domains/ minus .md, with no "domains/" prefix:
      domains/<area>/overview.md -> <area>/overview
  [ ] verified = the date you read the code; branch = the branch you read it on. Never carry either forward from
      another note, and never move them without re-reading.
  [ ] sources = the repo-relative files this note's claims depend on: if the file changed, would something here
      become wrong? Padding the list produces false staleness; trimming it produces false confidence.
  [ ] A measured platform fact with no such file: replace sources with measured_on, naming the tool and version.
  [ ] coverage: partial, and the Scope line names something specific. Scope only: no boilerplate, and no fact about
      the subject, which belongs in the body.
  [ ] Every [fact] cites a symbol you opened and read in full this run. A second-hand claim is a [risk] or a
      [question] that says it is unverified.
  [ ] Counted things were counted. One fact per observation line.
  [ ] Inline tags come from the format's table or kb.toml, plus the ticket pattern. Tag what someone would look for
      from outside this note, not every line.
  [ ] The title matches the [[wikilinks]] other notes will use, and is unique in the knowledge base.
  [ ] A hub note is listed in the knowledge base README's entry points.
  [ ] A convention you invented while writing this is written into the format or kb.toml and applied to every
      existing note in the same change, or dropped.
-->
