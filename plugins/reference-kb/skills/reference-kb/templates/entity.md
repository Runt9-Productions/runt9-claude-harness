---
title: Human Readable Name
type: note
permalink: entities/area/slug
tags: [kind, classification]
verified: YYYY-MM-DD
coverage: partial
branch: the-branch-you-read-the-code-on
sources:
  - path/to/the-definition-that-implements-this.ext
id: stable-external-identifier
---

# Human Readable Name

> **Scope.** REPLACE THIS SENTENCE with what *this* note covers and, specifically, what it does not. When the evidence is not code, name the evidence that is missing rather than the code that was not read.

One paragraph on what this entity is and why it has a note. An entity note earns its place by holding what its
definition does not say: how the thing is used and what goes wrong with it, not a restatement of the definition.

## Observations

- [fact] A single indexable fact, citing `symbolName` plus `TheFile.ext:123`.
- [decision] A ruling about this entity, with who made it, where and when, and the reason.
- [question] Genuinely open. Say what would answer it.

## Relations

- part_of [[Parent Hub Note]]
- see_also [[Some Other Note]]

<!--
CHECKLIST: delete this block before saving.

  [ ] Is this an entity? One note per member of an enumerable set. If the set is "however many investigations we
      do", it is a topic and belongs in domains/.
  [ ] permalink = the path under the knowledge base minus .md, keeping the leading entities/.
  [ ] Required: title, type, permalink, tags, verified, coverage and the Scope line. Optional: branch, sources, id.
      Delete the optional keys that do not apply rather than leaving them blank.
  [ ] tags carry the kind and any classification, instead of a per-kind frontmatter key that every note in the tree
      would then have to carry.
  [ ] sources = the files whose change would make something here wrong. Omit it when the evidence is not a repo file.
  [ ] id = a stable external identifier. Once other notes cite it, it never changes, is never reused and is never
      renumbered.
  [ ] Relations declare part_of the domains/ note that indexes this kind, and that note links back.
  [ ] The title matches the [[wikilinks]] other notes will use, and is unique in the knowledge base.
-->
