---
title: "{{Title, unique across the knowledge base}}"
type: note
permalink: "{{path from the root without .md, such as entities/set/item}}"
tags: ["{{subject}}", "{{subject}}"]
verified: "{{YYYY-MM-DD, the day the claims were checked}}"
coverage: partial
id: "{{the item's identifier within its set}}"
sources:
  - "{{repository path of a file a claim rests on}}"
---

<!--
{{Delete this checklist before saving.}}
- permalink: the path from the root without .md, entities/ kept.
- verified: today only if every claim was checked today; a claim carried forward keeps the old date and the Scope
  line says it was carried.
- sources: every file a claim rests on, and none it does not. Delete the key if no claim rests on a file.
- Scope: names specifically what was not read.
- Every [fact] was read or measured in this run; second-hand claims are [risk] or [question] and say so.
- Every count was counted.
- Tags and categories come from the format or kb.toml.
- The title is unique.
- The domains/ note indexing this set lists the item and relates back to it.
- A new convention is applied to every note it covers, and to the format, templates or kb.toml.
-->

# {{Title}}

> **Scope.** {{What this note covers about the item and which parts of which files were read}}. Not covered: {{the specific things left unread}}.

{{Who should read this, before doing what.}}

## Observations

- [fact] {{What was read or measured about this item, citing the symbol and file:line}}
- [trap] {{Where this item behaves differently from the rest of its set}}
- [question] {{What is open, and what would settle it}}

## Relations

- part_of [[{{Title of the domains/ note indexing the set}}]]
