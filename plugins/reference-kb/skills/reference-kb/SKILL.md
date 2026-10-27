---
name: reference-kb
description: How to read, search, write and validate a repository's reference knowledge base in `.claude/reference/` (notes under domains/, entities/ and projects/, indexed by Basic Memory). Use before answering a question the knowledge base might cover, before writing or updating a note, when running or reading `validate.py`, `--stale` or `--stale-in`, when setting a knowledge base up in a new repository, or when the user says "check the KB", "write this up in the KB", "update the KB", "the KB is stale" or "add a note for X".
---

# Reference knowledge base

A repository's `.claude/reference/` holds notes written for an agent to read before the code, so it arrives knowing
the traps. The format is `references/format.md`; this file says how to use it. A repository's
`.claude/reference/README.md` lists its entry points and conventions of its own, and its `kb.toml` what it adds to
the shared vocabularies.

## Reading

**Silence is not an answer.** Notes record what someone investigated, not what exists, so a question the knowledge
base does not answer is still open. Never conclude that something does not exist, or works the obvious way, from
the knowledge base alone. A note that covers an area covers part of it; its Scope line says which part.

- **A note you were pointed at:** `Read` it. It returns line numbers, which Basic Memory's `read_note` does not.
- **A question in words:** Basic Memory's `search_notes`. It matches meaning, so it finds a note that never uses the
  question's words. Pass `search_all_projects: true` to cover every knowledge base on the machine.
- **Keep `output_format: text`.** `json` returns each note's whole body.
- **Results do not name their project,** and two knowledge bases can hold the same permalink (`readme`). Pass
  `project` when reading one.
- **`build_context` follows relations.** Raise `max_related` above the default 10 on a hub note, or its inbound links
  crowd out its outbound ones.
- **An empty or off-target search is not proof of absence.** Fall back to the README's entry points, the hub note
  for the area, or a text search scoped to `.claude/reference/`.
- **Check the date.** `verified` says when the claims were last read against the code; `--stale` below says whether
  the code has moved since.

Basic Memory indexes the directory registered for a project, which is usually the main checkout. A session in a
worktree or on another branch searches that checkout's notes, not its own branch's.

## Writing

Read `references/format.md` first, every time: it changes, and the validator holds you to the current version. Then
copy the matching template from `${CLAUDE_PLUGIN_ROOT}/skills/reference-kb/templates/` rather than writing
frontmatter from memory:

| Writing | Template |
|---|---|
| a `domains/` note | `domain.md` |
| an `entities/` note | `entity.md` |
| a `projects/<slug>/` directory | `project-overview.md`, `project-checklist.md`, `project-decisions.md` |
| a new knowledge base's `kb.toml` | `kb.toml` |

Before creating a note, `search_notes` for one on the same topic: a second note on one subject splits its readers
and its backlinks.

**Write with `Edit` and `Write` in your own working tree,** so the change lands on your branch and reaches review.
Basic Memory's `write_note` and `edit_note` write into the registered checkout, which is not your branch when you
work in a worktree.

**When your working tree is the registered checkout,** write notes there with Basic Memory's tools instead: its
watcher drops changes that arrive while it is indexing, so direct writes can leave search answering from the old
text, and the tools index as part of the write.

- **Edit** with `edit_note`, passing the project and the note's permalink as the identifier.
- **Create** with `write_note`: the template's frontmatter in `content`, and as `title` the filename without `.md`
  (`release-notes` gives `release-notes.md`, with Basic Memory's `kebab_filenames` on or off). The tool's title overwrites the
  frontmatter one, so follow with an `edit_note` `find_replace` on the `title:` line.
- **The MCP server is down:** say so and ask for a reconnect before writing there.

A note that takes reading many files is worth delegating to the `reference-kb:kb-writer` agent, which returns a
trace of what it read so its sources can be spot-checked.

## Validating

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reference-kb/scripts/validate.py --root .claude/reference --stale
```

Run it from the repository root before finishing any knowledge base work. It needs PyYAML (a dependency the user
installs; never install it yourself).

- **Exit 0 means no errors, nothing more.** Warnings, including everything `--stale` reports, never change it. Read
  the `warn` lines.
- **It checks format, never truth.** Never report "validation passed" as though the note were verified.
- **`--stale` has three outcomes:** stale, clean, and UNKNOWN (an untracked source or a failing git call). Never read
  UNKNOWN as clean.
- **`--stale-in BASE..HEAD`** is the pull request gate: a note whose sources the range changed fails until its
  `verified:` line moves in the range, which means re-reading the note against the change first.

**A stale note:** find which sources moved and what changed, re-read those files, re-check only the claims that
depend on them, and move `verified` only for what you re-verified. A partial re-verify says so in the Scope line.
Touching only the frontmatter never moves `verified`.

## Setting up a knowledge base in a repository

1. Create `.claude/reference/` with the trees it needs and a `README.md` listing its entry points. Copy
   `templates/kb.toml` beside it when the repository holds fewer than three trees or adds to a vocabulary.
2. Add a line to the repository's `CLAUDE.md` saying the knowledge base exists, that it is read before the code it
   covers, and that silence is not an answer. A knowledge base nothing points at is not read.
3. Have CI run the validator with `--stale-in` over each pull request's range, from a checkout of this plugin's
   repository pinned to a commit.
4. Registering it with Basic Memory is the user's step, not yours: `bm project add <name> <path>`, a reconnect of
   the MCP server (`/mcp`), then `bm reindex`, since files that appear in a new project can be missed until the next
   reindex.

Two more things go stale in Basic Memory's index outside the tools: a branch switch in the registered checkout, and
a `bm config set` on a running server. Run `bm reindex` after the first and reconnect the server after the second.
