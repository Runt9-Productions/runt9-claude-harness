# Reference knowledge base format

The single authority on what a note is. Read it before every write. The validator reads the tables marked
`<!-- table: ... -->` below, so editing one changes what it accepts; change the rest of this file to match in the same
edit.

## What a note is for

A note tells a reader which files matter and what in them is unexpected, so the reader opens the right files and
does not trip on what is surprising there. It never replaces reading them.

**A note is written only from what was read or measured in the run that wrote it.** A note written from search hits,
another note, a design document or memory is false, not merely incomplete, because a reader acts on it as if it had
been checked.

- Every file in `sources` was opened and the parts the claims rest on were read.
- Every `[fact]` was read in a source or measured in this run.
- A claim taken second-hand is a `[risk]` or a `[question]` that says where it came from and that it was not checked.
- Every count was counted.

## What absence means

Notes record what was investigated, not what exists. A knowledge base's silence on a subject is no information: not
"no", and not "it works the obvious way". No question of the form "is there anything that does X?" is answered from
the knowledge base alone; it is answered by searching the code, and a note can at most say where to start.

## Layout

```
.claude/reference/
  README.md                    entry points: the hub notes, and the repository's local conventions
  kb.toml                      optional: what this knowledge base adds to the format
  domains/<area>/overview.md   an area's hub note
  domains/<area>/<topic>.md    one investigation
  entities/<set>/<item>.md     one item of an enumerable set
  projects/<slug>/overview.md  a project's hub note, with checklist.md, decisions.md and an optional spec.md
  projects/<slug>/research/    working notes, held only to the four base keys
```

The README is not a note and is never validated. It names the hub notes, which are how a reader finds a way in, so a
new hub note gets a README line in the same change. A file or directory whose name starts with `_` is never a note.
A small evidence file (a captured output, a fixture) may sit beside the note that explains it.

## Trees

- **`domains/`** holds durable knowledge, one note per investigation. Knowledge that holds across an area's topics
  goes one level up, in the area's `overview.md`.
- **`entities/`** holds one note per item of a set that could be listed in full, such as each command of a CLI or
  each service in a deployment, and a `domains/` note indexes the set. Tell an entity from a topic by asking whether
  the complete list could be written down and every item would carry the same kinds of fact. If so, each item is an
  entity; a mechanism, a question or a behaviour is a topic.
- **`projects/`** holds time-bound work. A fact that will outlive the project moves to `domains/` and the project
  links to it.

## Note shape

1. Frontmatter (below).
2. An H1, as the first line after the frontmatter.
3. In `domains/` and `entities/`, a blockquote directly after the H1 that opens `**Scope.**`. It says what the note
   covers and names specifically what was not read or not covered. Only the first quoted paragraph counts.
4. A short paragraph saying who should read the note, before doing what.
5. `## Observations`, then `## Relations`.

Start every note from its template in `../templates/`. Templates mark each placeholder `{{like this}}`; the validator
rejects any left in the frontmatter or in text outside code.

## Frontmatter

<!-- table: keys -->
| Key | domains | entities | projects | Meaning |
|---|---|---|---|---|
| `title` | required | required | required | Unique across the knowledge base, since links resolve by title |
| `type` | required | required | required | Always `note` |
| `permalink` | required | required | required | Derived from the path, below |
| `tags` | required | required | required | A list of subject words for search |
| `verified` | required | required | optional | The date the claims were last checked against their sources |
| `coverage` | required | required | no | One of the coverage values below |
| `sources` | required | optional | optional | The files the claims rest on |
| `measured_on` | optional | no | no | The tool and version a platform fact was measured on |
| `id` | no | optional | no | The item's identifier within its set |
| `status` | no | no | optional | A project's status, on its overview |
| `opened` | no | no | optional | The date a project started |
| `release` | no | no | optional | The release a project ships in |

- **Unknown keys are errors on purpose.** A misspelt key would otherwise be ignored silently, and a note whose
  `verifed` is never read reports clean forever.
- **`verified`** is a bare ISO date (`2026-01-31`; quoted also passes). It moves only when the claims it covers were
  re-checked, and only for those. It is never later than one day past today in UTC, so a writer anywhere may use
  their local date.
- **`sources` without `verified`** is an error in every tree: nothing could tell when the note went stale.
- **`coverage`**: `partial` unless the note's Scope line says how completeness was shown, for example by listing the
  directory or counting the matches.

<!-- table: coverage -->
| Value | Meaning |
|---|---|
| `partial` | Covers what the Scope line names; anything else may exist. The default. |
| `complete` | Every item or case was enumerated, and the Scope line says how that was shown. |

### `sources` and staleness

`sources` lists the files whose change would make a claim in the note wrong, as paths from the repository's top.

- **Padding** (listing files the claims do not rest on) produces stale warnings for changes that break nothing, and
  readers learn to ignore them.
- **Trimming** (leaving out a file a claim rests on) produces a note that reports clean forever while it goes wrong,
  which is worse.
- A listed file that was deleted or moved is an error: update the path, or re-check the claims that rested on it.
- Cite a line as the symbol plus `file:line`. The line number is a hint for the next reader and drifts; the symbol is
  the durable citation.
- **Rebuilding `sources` for an old note:** read each claim, find the files it rests on, and list them. Do not move
  `verified`, since no claim was re-checked. Then run `--stale`: commits it reports since `verified` are the claims to
  re-verify next.

### `measured_on`

A platform fact (how a tool behaves, measured by running it) rests on a tool version rather than on a file.

- `measured_on` is a quoted string naming each tool and version, such as `"ExampleTool 4.2, Python 3.12"`.
- It makes `sources` optional on a `domains/` note. A note may carry both when some claims rest on files.
- Such a note goes stale when a newer version of the tool is in use, and nothing checks that: re-measure before
  depending on a fact measured on an older version.
- Tag the measured lines `#measured`.

### Permalinks

The permalink is the path relative to the root without `.md`, with a leading `domains/` dropped and any other tree
kept: `domains/storage/overview.md` is `storage/overview`, and `projects/example/overview.md` is
`projects/example/overview`. To move a note, rename the file and update its permalink to match, rather than keeping
an old permalink on a new path.

## Observations

One fact per line, in the shape `- [category] text #tag (context)`. The context in parentheses is optional and says
how the fact was established or where it applies.

<!-- table: categories -->
| Category | Meaning |
|---|---|
| `fact` | Read in a source or measured in this run. |
| `trap` | Behaviour that makes the obvious reading or the obvious change wrong. |
| `invariant` | Something that must stay true, and what breaks if it does not. |
| `risk` | A failure that could happen but was not seen, or a claim taken second-hand; it says which. |
| `question` | Open, with what would settle it. |
| `decision` | An owner's ruling, with who and when: `(owner, 2026-01-31)`. An agent never records its own choice as one. |
| `proposal` | What an agent chose or thinks the owner wants, with its status: open, approved or rejected. |
| `history` | How something came to be, kept only where the current shape is surprising without it. |
| `status` | Where a project stands, rewritten in place. Projects only. |

Task boxes, `- [ ]` and `- [x]`, are not categories; they belong in a project's checklist.

<!-- table: tags -->
| Tag | Meaning |
|---|---|
| `silent-failure` | Fails with no error and no visible symptom. |
| `irreversible` | Cannot be undone once done. |
| `order-dependent` | Correct only in a particular order. |
| `measured` | Established by running something, not by reading. |
| `superseded` | Overturned. The line stays, and says what replaced it. |

A ticket reference such as `#PROJ-123` (uppercase letters, a hyphen, digits) is accepted as a tag by pattern.

- **The lists are closed** because synonyms split search: a reader searching `#silent-failure` misses a line tagged
  `#silent`. Add a word to `kb.toml` rather than inventing one in a note.
- **A tag earns a place** when readers will search for it across subjects. A word that only describes one note's
  subject belongs in that note's frontmatter `tags`.
- **Tags go on observation lines**, after the text. A `#` counts as a tag only at the start of a line or after
  whitespace, so a URL fragment is not one.

## Relations

`## Relations` holds one relation per line: `- <type> [[Title]]`. A wikilink may also appear anywhere in prose, and an
alias `[[Title|shown text]]` links to `Title`.

<!-- table: relations -->
| Type | Meaning |
|---|---|
| `part_of` | This note is a piece of the target: a topic of an area, an entity of its set. |
| `depends_on` | This note's subject needs the target's to work. |
| `implements` | This note's subject carries out the target's design or contract. |
| `contradicts` | The two notes disagree, and one of them needs re-checking. |
| `supersedes` | This note replaces the target. |
| `measured_in` | The measurements here were taken in the target, such as a project or a research note. |
| `causes` | This note's subject brings about the target's. |
| `caused_by` | The target's subject brings about this note's. |
| `see_also` | Related, with no stronger relation. |

- **Relations are two-way**: a note that relates to another gets a relation back from it, of any type. The exception
  is `projects/` to `domains/`, which is one way, so durable notes never point at time-bound work. `entities/` to
  `domains/` is not exempt.
- `causes` and `caused_by` are declared from both ends.
- **Links to notes not yet written are welcome.** They warn, and they mark the gaps a reader would want filled.
- A link resolves to a note's title or permalink. The root README is a link target only when it has a `title` in
  frontmatter.

## Projects

A project is a directory under `projects/` holding:

- **`overview.md`**: the hub, with `status` and `opened`, what the project is, a `[status]` line saying where it
  stands, and links to the other documents.
- **`checklist.md`**: the units of work, in exactly three sections. A status section rewritten in place; the build
  order; and a flat numbered list of items as task boxes. One item is one deliverable commit. No item carries its own
  spec.
- **`decisions.md`**: append-only. Each ruling is a `[decision]` line with who and when. An overturned entry is tagged
  `#superseded` and kept, saying what replaced it. Questions for the owner go under an open-questions section, never
  only in conversation.
- **`spec.md`**: optional, the settled design archived once agreed.
- **`research/`**: working notes, held only to the four base keys (`title`, `type`, `permalink`, `tags`).

Which documents are required follows `status`. A project that has started (`research` or `implementation`) needs
`decisions.md`, and one in `implementation` needs `checklist.md` as well.

<!-- table: statuses -->
| Status | Meaning |
|---|---|
| `research` | Being investigated; nothing is being built yet. |
| `implementation` | Being built from the checklist. |
| `complete` | Done, and its durable facts moved to `domains/`. |
| `tabled` | Paused by choice. |
| `blocked` | Waiting on something outside the project, which the overview names. |

## Writing conventions

- One fact per line.
- Cite the symbol and `file:line`.
- Write down what surprises: a reader who opens the file sees what it plainly says without a note.
- Mark confidence honestly. Measured, read and second-hand are different categories.
- State mechanisms, not rankings: "the cache is keyed by user" stays true longer than "the cache is the bottleneck".
- The Scope line names specifically what was not read. "Not everything was covered" says nothing.

## Changing a convention

A new or changed convention (a category, a tag, a key, a section) is applied in the same change to every note it
covers and to this file, the templates or `kb.toml`, or it is not made. A convention half applied splits search and
makes the validator's verdict mean less.

## The config file `kb.toml`

A repository declares only what it adds, in `kb.toml` at the root. With no file, all three trees are expected and the
vocabularies are the format's.

| Key | Holds |
|---|---|
| `trees` | The trees this knowledge base uses, drawn from `domains`, `entities`, `projects`; not empty. |
| `categories`, `tags`, `statuses` | Tables adding words, each name mapped to a string saying what it means. |

```toml
trees = ["domains", "projects"]

[categories]
example = "Stated in the example tool's manual and not measured here."

[tags]
needs-hardware = "Can only be checked on the physical device."
```

- Names are lowercase words joined by `-` or `_`, and every meaning is a non-empty string.
- Words can be added, never taken away; a status added here carries no document requirement.
- A bad config stops the validator before it reads any note (exit status 2).

## The validator

From the repository root:

```
python3 <skill>/scripts/validate.py --root .claude/reference [--warnings] [--stale] [--stale-in A..B]
```

- **Exit status:** 0 when no error was found; 1 when at least one note has an error; 2 when nothing could be
  checked: the root is missing or holds no notes, `kb.toml` is unreadable or invalid, this file cannot be read, or
  the range does not resolve.
- **Errors** break the format and fail the run. **Warnings** never change the exit status, so they must be read:
  links to notes that do not exist, one-way relations, and stale notes. Without `--warnings` they are only counted.
- **It checks format, not truth.** A clean run says nothing about whether the claims are right.
- **Both staleness modes leave merge commits out.** A merge's changes are counted in the commits that made them, so
  merging a branch never makes a note stale by itself, and neither does a change made only in a merge's resolution.
- **A source commit is re-verified** when that commit, or a later commit descending from it, edits the note and
  leaves `verified` on or after the source commit's date (the committer's own date, as `git log --format=%cs` shows
  it). `verified` need not move: a same-day edit that keeps the date counts. Edits under the note's earlier paths
  count, and a commit that only moves the note, changing at most its `permalink`, does not.
- **`--stale`** warns about each note whose sources changed in commits dated after `verified` and not re-verified. A
  commit on the same day as `verified` counts as covered, so an uncommitted re-verify still clears the warning. A
  source git does not track, and any git failure, is reported as UNKNOWN, never as clean.
- **`--stale-in A..B`** is the merge gate, and implies `--stale`. A note fails when a commit in the range changes one
  of its sources and is not re-verified. A source change after the note's last edit therefore fails even when its
  date matches `verified`. UNKNOWN fails here. Staleness from before the range never fails.
