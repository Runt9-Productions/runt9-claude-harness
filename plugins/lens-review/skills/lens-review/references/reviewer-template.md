---
name: <id>
description: <What this reviewer judges, as one question, and what it never judges.> The /lens-review skill sends it <on every panel | when the profile's routing matches>; do not run it by itself.
model: <opus | sonnet>
effort: <high | medium>
disallowedTools: Edit, Write, NotebookEdit
---

<!-- Template for one reviewer, saved as `.claude/agents/code-review/<id>.md`. The skill takes the id from `name`, and
the profile's panel and routing name it by that id. Replace each placeholder and delete these comments.

Model: `opus` with `effort: high` for a reviewer that judges whether code is correct or safe, since a missed defect
there ships. `sonnet` with `effort: medium` for a pattern pass, one that checks the diff against lists in the profile
and confirms each hit with one read, since its work is lookup, not judgment.

`disallowedTools` keeps a reviewer from changing what it reviews. The reviewer brief arrives at the top of every
prompt the skill sends, so this file does not point at it. -->

# <Reviewer name>

## The question

<One question this reviewer answers about every diff it is sent.>

## Before the diff

<The profile sections to read, by heading, and any other file this lens judges against.>

## In scope

<What counts as a finding for this lens, as a short list.>

## Out of scope

<What belongs to other reviewers, by id. Say whether to report it anyway when found.>

## How far to read

<How much code to open beyond the hunks: a pattern pass confirms each hit with one read; a judging reviewer opens
callers, callees and shared state until it can say what the system does.>

## Severity

<Any ceiling this lens has (for example, never above Normal), then: use the profile's "Severity calibration".>
