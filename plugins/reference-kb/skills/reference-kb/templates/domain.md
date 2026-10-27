---
title: "{{Title, unique across the knowledge base}}"
type: note
permalink: "{{path from the root without .md, minus the leading domains/}}"
tags: ["{{subject}}", "{{subject}}"]
verified: "{{YYYY-MM-DD, the day the claims were checked}}"
coverage: partial
sources:
  - "{{repository path of a file a claim rests on}}"
---

<!--
{{Delete this checklist before saving.}}
- permalink: the path from the root without .md, with domains/ dropped.
- verified: today only if every claim was checked today; a claim carried forward keeps the old date and the Scope
  line says it was carried.
- sources: every file a claim rests on, and none it does not. For a platform fact, measured_on: "<tool> <version>"
  may stand in for sources.
- Scope: names specifically what was not read.
- Every [fact] was read or measured in this run; second-hand claims are [risk] or [question] and say so.
- Every count was counted.
- Tags and categories come from the format or kb.toml.
- The title is unique.
- A hub note has a line in the README.
- A new convention is applied to every note it covers, and to the format, templates or kb.toml.
-->

# {{Title}}

> **Scope.** {{What this note covers and which parts of which files were read}}. Not covered: {{the specific things left unread}}.

{{Who should read this, before doing what.}}

## Observations

- [fact] {{What was read or measured, citing the symbol and file:line}}
- [trap] {{A behaviour that makes the obvious reading or change wrong}} #silent-failure
- [invariant] {{What must stay true, and what breaks if it does not}}
- [risk] {{A failure not seen, or a claim taken second-hand, saying which}}
- [question] {{What is open, and what would settle it}}
- [decision] {{An owner's ruling and its one-line reason}} (owner, {{YYYY-MM-DD}})

## Relations

- part_of [[{{Area overview title}}]]
- see_also [[{{Related note title}}]]
