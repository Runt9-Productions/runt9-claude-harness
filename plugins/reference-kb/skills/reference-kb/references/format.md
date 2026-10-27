# Reference knowledge base format

The format every reference knowledge base follows. `scripts/validate.py` parses its vocabularies out of the tables
below, so a row added here is enforced in every note on the next run. A repository declares only what differs, in
`.claude/reference/kb.toml`.

Contents: [Read the code first](#read-the-code-first) · [What absence means](#what-absence-means) ·
[Note format](#note-format) · [Trees](#trees) · [The projects/ document set](#the-projects-document-set) ·
[Conventions](#conventions) · [Spec changes carry a sweep](#spec-changes-carry-a-sweep) ·
[Validating](#validating) · [kb.toml](#kbtoml) · [Observation categories](#observation-categories) ·
[Inline tags](#inline-tags) · [Relation types](#relation-types) · [Layout](#layout)

A note is a map that says which code to read and what is surprising about it, written so an agent reads it before
the code and arrives knowing the traps. It never replaces reading the code.

## Read the code first

A note written from a search result, a grep hit, a design document, another note or memory is not incomplete. It is
false, and worse than no note, because a reader trusts what is written: a gap sends them to the source, and a wrong
fact stops them reading it.

- **Every file in `sources` is one you opened and read.** Not searched, not grepped, not seen a few lines of in a tool
  result. If you cannot say you read it, read it now or remove the claim that depends on it.
- **A `[fact]` is something you read in the code or measured, this run.** What `CLAUDE.md`, another note, a design
  document or your memory says decides what to go and read; it does not become a `[fact]` without the read.
- **Record second-hand claims, marked.** `[risk]` for a hazard believed but unproven, `[question]` for one that is
  open. "The README claims X; not verified against source" is useful. The same sentence as a `[fact]` is a false
  citation.
- **Cite what you opened and count what you list.** A claim about a symbol means you opened that symbol; a number
  means you counted.
- **Speed buys nothing here.** The knowledge base is worth having only because a reader can skip the code, so a note
  written without reading it moves the cost onto every later reader without their knowing.

## What absence means

Notes record what has been investigated, not what exists, in whatever order investigations happened. **When the
knowledge base says nothing about something, the likely reason is that nobody has needed it yet.**

- A missing subsystem, class, flag or failure mode is no evidence about the code. Read the code.
- A note covering an area does not cover all of it. Most notes hold the traps found while chasing something else.
- **Never answer "is there anything that does X?" from the knowledge base alone.** It can confirm a thing exists,
  never that one does not.
- Code no note warns about has usually not been read closely, which is not the same as being correct.

A trusted source that is silent reads as one that says "no", which ends a search that should have continued. Treat
silence as having been told nothing. This section is the one place the principle is stated; a note's Scope line
carries only what is true of that note.

## Note format

Shaped for [Basic Memory](https://github.com/basicmachines-co/basic-memory), which indexes the knowledge base for
search over MCP. Copy a template from `templates/` rather than writing frontmatter from memory: each carries a
checklist to delete before saving.

```markdown
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
---

# Human Readable Name

> **Scope.** <what this note covers, and specifically what it does not>

One paragraph on what this note is for.

## Observations

- [category] A single indexable fact #tag (optional context)

## Relations

- relation_type [[Other Note]]
```

`templates/domain.md`'s frontmatter is the exact key set of a `domains/` note: the validator reads it from there.

### `sources` makes staleness measurable

`verified` says how old a note is, not whether the code moved underneath it. `sources` lists, repo-relative, **the
files the note's claims depend on**: the test is whether a change to the file would make something in the note
wrong. Writing a fresh note, that is the set you opened.

`--stale` runs `git log` over each note's sources and reports commits dated after `verified`. A commit on the same day
counts as covered.

- **Padding the list** with a file the note makes no claim about produces false staleness, and a check that cries
  wolf is ignored.
- **Trimming the list** leaves a note that reports clean forever. This is the worse failure.
- **Three outcomes, not two.** A note is stale, clean, or UNKNOWN: an untracked source (`git log` on one prints
  nothing and exits 0) or a failing git call cannot be measured, and the validator reports either rather than
  calling it clean. Stage or commit a new source to get an answer.
- **A note with no `sources` is invisible to `--stale`**, so absence from its output is silence, not a clean bill.
  That is no reason to pad a `projects/` note, which is usually about a decision rather than a file.
- A source that no longer exists is an error: the note's subject moved.

Line numbers in a note drift and are hints. The symbol name is the durable part of a citation.

### `measured_on` for platform facts

A `domains/` note may carry `measured_on`, a quoted string naming the tool and version the claims were measured on
(`"Example CLI 2.1.0"`). With it, `sources` becomes optional, because a measured platform fact has no repo file whose
change would make it wrong. Staleness then means re-measuring on a newer version, which the validator does not check.
Tag the observations `#measured`.

### Reconstructing `sources` for an older note

Resolve each symbol the note already cites to its file. That re-verifies nothing, so leave `verified` alone, and say
in the Scope line that the list is a floor: a note can depend on a file it never names. Then run `--stale`.

### Permalinks

`permalink` is the path under the knowledge base, without `.md`, with a leading `domains/` dropped. `domains/` is the
default namespace; the other trees keep their prefix, so a permalink says what kind of note it is.

| File | Permalink |
|---|---|
| `domains/<area>/overview.md` | `<area>/overview` |
| `domains/<area>/<subarea>/<topic>.md` | `<area>/<subarea>/<topic>` |
| `entities/<kind>/<slug>.md` | `entities/<kind>/<slug>` |
| `projects/<slug>/overview.md` | `projects/<slug>/overview` |

Prefer renaming the file over changing a permalink: links and search results use it.

## Trees

Every note sits in one of three trees, and `kb.toml` declares which ones a knowledge base holds. A note anywhere else
is an error. A file or directory whose name starts with `_` (`_legacy/`) is never a note; use one for a document
kept only until its content is extracted, opening it with what supersedes it.

- **`domains/`** is durable knowledge, one note per investigation. Exactly the template's keys, plus the Scope line,
  plus optionally `measured_on`. Durable notes are trusted, so a reader needs their staleness and scope.
- **`entities/`** is one note per member of an enumerable set. Requires `title`, `type`, `permalink`, `tags`,
  `verified`, `coverage` and the Scope line; may carry `branch`, `sources` and `id`. `sources` is optional because an
  entity's evidence is not always a repo file.
- **`projects/`** is time-bound work: a ticket, an investigation, a release. Requires `title`, `type`, `permalink`
  and `tags`; may carry `verified`, `branch`, `sources`, `status`, `release` and `opened`. Exempt from
  `coverage` and the Scope line, because a record of one piece of work is scoped by its subject.

A fact that stays true after the work closes belongs in `domains/`; a `projects/` note links out to it rather than
restating it. Within `domains/`, general knowledge goes in `domains/<area>/` and narrower specifics one level down; a
fact true of two narrower cases belongs one level up.

**Entity or topic.** If you could write down the complete list of things that need a note, they are entities; if the
list is "however many investigations we do", they are topics. An entity's index is a `domains/` note, which keeps
each tree uniform and is where backlinks gather.

Small non-markdown evidence (a screenshot) may sit beside the note that indexes it, when the evidence itself is the
durable thing. That note says what each file is worth looking at for. Large or disposable evidence stays out.

## The projects/ document set

A project is a directory, so whoever resumes it after a compaction or a week away finds its state in a known place.

```
projects/<slug>/
├── overview.md     the hub: what this is, where it stands, links out
├── checklist.md    the units of work, and which one is live
├── decisions.md    decisions made and questions raised while building
├── research/       ad-hoc investigation, one file per investigation
└── spec.md         optional: the settled design, archived
```

**Which documents are required follows `status`, not the directory existing.** An overview alone is an honest
project that has not started, and a checklist written after the work records planning that never happened.

- `decisions.md` is required once the project has started (`research` or `implementation`).
- `checklist.md` is required to enter `implementation`.

`status` is closed: `research`, `implementation`, `complete`, `tabled`, `blocked`, plus any `kb.toml` adds. The
validator branches on it, and an open set drifts into synonyms. The two working phases are split because the
checklist is the gate between them: one demanded during research is invented, and then anchors the design it should
have followed.

- **`checklist.md` has three sections and no fourth:** `## Status` (rewritten in place: what is live, how far along,
  what blocks it), `## Build Order` (dependency order, which list order is not), `## Checklist` (a flat list of
  numbered items). A fourth section turns it into a log that cannot be read at a glance. An item is one unit of
  deliverable work: one commit, builds on its own, ideally verifiable on its own.
- **No item gets a spec document of its own.** The checklist entry plus `decisions.md` is the agreement, because a
  second document per item drifts from both as the work changes.
- **`decisions.md` is appended to, never rewritten.** An overturned decision is tagged `#superseded` and kept beside
  what replaced it. A question for the owner goes under `## Open questions`, never only in conversation, where it is
  gone at the next compaction.
- **`research/` is exempt from the ceremony:** the four required keys and nothing else. Dead ends and measurements
  belong here. A finding still true after the project closes moves to `domains/`.
- **`spec.md` is an archive.** Draft wherever the work happens and copy the settled version in.

## Conventions

These are this format's, on top of Basic Memory's.

- **One fact per observation line.** A line that needs "and" is two observations.
- **Cite the symbol plus `file:line`.** The symbol is durable; the line is a hint.
- **Record the trap, not the happy path.** "This method does X" is what reading code is for. "This is not the method
  that runs" is what a note is for.
- **Mark confidence.** `[fact]` was read or measured; `[risk]` and `[question]` were not. Never dress either as a
  `[fact]`.
- **Say what a note does not cover, specifically.** Every `domains/` and `entities/` note carries `coverage` and a
  blockquote right after the H1 opening with `> **Scope.**`, naming the class, module, vendor or path that was not
  read and what was carried forward unverified. "Some things are not covered" is noise. A fact about the subject
  belongs in the body, where a reader looks for facts.
- **`coverage: partial` is the default.** `complete` claims the subject was read exhaustively; say in the note how
  that was established.
- **Link freely, including to notes that do not exist yet.** A dangling link is a note worth writing.
- **Keep `## Observations` and `## Relations`.** Basic Memory indexes each observation and relation on its own.

## Spec changes carry a sweep

Introducing or changing a convention means applying it, in the same change, to the note at hand, to **every existing
note it now applies to**, and to this format, the templates or `kb.toml`. If that is too expensive now, do not make
the change: an inconsistent corpus is worse than an unimproved one, because an inconsistency reads as a deliberate
exception. The unknown-key error makes this mechanical for frontmatter.

## Validating

```
python3 <skill>/scripts/validate.py --root .claude/reference [--warnings] [--stale] [--stale-in BASE..HEAD]
```

Run it before finishing any knowledge base work. It needs PyYAML.

- **Exit 0 means no errors.** Warnings, including everything `--stale` reports, never change the exit status, so a
  clean exit is no evidence that nothing is stale. Read the `warn` lines.
- **It proves format, never truth.** A note can be wrong throughout and validate cleanly.
- **`--stale-in BASE..HEAD` is a merge gate, and its findings are errors.** A note fails when a commit in the range
  changes one of its sources, is dated after `verified`, and is not followed in the range by a commit that moves the
  note's `verified:` line (the same commit counts). Inherited staleness does not count. Ordering by commit rather
  than date keeps a rebase from failing a note already re-verified; a note re-verified on the day of the change and
  then rebased onto a later day still fails, so move its line again. Moving the date without re-reading defeats the
  check. UNKNOWN is an error here too: a gate that cannot measure must not pass.
- **Unknown frontmatter keys are errors**, so a key added in one note fails until the format and every note carry
  it. That friction is what keeps the format settled; do not soften it.

## kb.toml

`<root>/kb.toml` declares what a knowledge base adds to this format. Without it a knowledge base holds all three
trees and adds nothing. `templates/kb.toml` is a starting copy.

```toml
trees = ["domains", "projects"]

[categories]
vendor = "Stated in a vendor's documentation and not verified here."

[tags]
example-tag = "What class of problem it marks, and why a reader would search for it from outside one note."

[statuses]
shipped = "Released, with follow-up still tracked here."
```

Each entry is a name and what it means, so the declaration is its own documentation. A status added here carries no
document requirement. An unknown key, tree or malformed name stops the validator with exit 2.

## Observation categories

The category says how far to trust an observation.

| Category | Means |
|---|---|
| `[fact]` | Verified by reading code, or measured. Safe to act on. |
| `[trap]` | True and counter-intuitive: the thing that costs an hour if unknown. |
| `[invariant]` | Holds today, and distant code depends on it holding. |
| `[risk]` | A plausible hazard, not demonstrated. |
| `[question]` | Genuinely open. |
| `[decision]` | A ruling by whoever owns the decision, with who, where and when. Never an agent's own choice. |
| `[proposal]` | A choice an agent made, or its guess at the owner's wish, with the reasoning and a status: `open`, `approved` or `rejected`. It becomes a `[decision]` only when approved. |
| `[history]` | Why it is this way, usually a ticket or a commit. |
| `[status]` | Where time-bound work stands. `projects/` notes only. |

## Inline tags

The full grammar is `- [category] content #tag (optional context)`. The tag says what class of problem an observation
belongs to, across areas, which note-level `tags:` cannot. The trailing `(context)` is free text for the qualifier
that would otherwise bloat the sentence.

| Tag | Means | Why it exists |
|---|---|---|
| `#silent-failure` | Something is discarded, swallowed or short-circuited without an error surfacing. | The costliest class of behaviour and the least likely to be found by reading one file: a wrong answer arrives looking finished. |
| `#irreversible` | If this goes wrong, it cannot be fixed forward. | Search it before proposing a change: data destroyed on upgrade, a merge that cannot be undone, a counter that cannot be recomputed. |
| `#order-dependent` | Sequence is load-bearing, and reordering breaks something distant. | The dependency is invisible at the call site, so it survives refactoring only if written down. |
| `#measured` | Established by measuring, not by reading code. | Code reading rots when the code changes, a measurement when the data or the tool version does. |
| `#superseded` | This observation no longer holds; a later one replaced it. | An append-only log must tell "decided" from "decided and later stopped" without deleting the reasoning. The same word as the `supersedes` relation. |
| `#PROJ-123` | A ticket cross-reference. | Accepted by pattern, any `<UPPERCASE>-<digits>`, so "what do we know about PROJ-123" is a query. |

- **The vocabulary is closed.** A new tag is a row here or in `kb.toml`, and the sweep obligation applies:
  `#silent-failure`, `#silentfailure` and `#silent_failure` would otherwise become three synonyms.
- **Tags go on observation lines only,** where Basic Memory indexes them.
- **Earn a tag across at least three notes, or two areas.** A tag in one note is a section heading.
- **Do not tag everything.** Tag what someone would look for from outside the note.

A project-specific tag belongs in `kb.toml` once it has earned its notes, with its meaning written for the local
reason, so the next reader can tell whether their case belongs to it.

## Relation types

`part_of`, `depends_on`, `implements`, `contradicts`, `supersedes`, `measured_in`, `causes`, `caused_by`, `see_also`

Basic Memory treats relation types as free text; this list is closed so that "everything that `causes` a data loss
path" stays answerable. Adding a type is an edit to the line above.

- `causes` and `caused_by` are a pair, declared from both ends, so the edge is visible from either side.
- **Relations between notes are two-way.** When a note declares a relation, the target acknowledges it with any
  relation back. The validator warns on a one-way relation.
- **`projects/` to `domains/` is one way.** A durable note must not collect backlinks to every ticket that cited it,
  because those rot as tickets close. `entities/` to `domains/` is not exempt, so an entity its index omits warns.

## Layout

```
.claude/reference/
├── README.md        entry points and local conventions; not validated as a note, but a link target
├── kb.toml          what this knowledge base adds to the format
├── domains/
│   └── <area>/
│       ├── overview.md    hub
│       └── <subarea>/     narrower specifics
├── entities/
│   └── <kind>/<slug>.md   indexed by a domains/ note
└── projects/
    └── <slug>/
        ├── overview.md
        ├── checklist.md
        ├── decisions.md
        └── research/
```

The README lists the hub notes as entry points, since a knowledge base with no hub is not discoverable, and holds
conventions that belong to this repository only.
