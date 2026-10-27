---
name: reference-kb
description: How to read, search, write, re-verify and validate a reference knowledge base, the Markdown notes under .claude/reference/ that are read before the code or platform behaviour they cover. Use before answering a question the knowledge base might cover, before writing or updating a note, when running or reading the validator or its --stale and --stale-in modes, and when setting a knowledge base up in a repository. Triggers on "check the KB", "update the KB", "the KB is stale", "add a note for X", "is there a note on", "what does the reference say", "validate the notes".
---

# Reference knowledge base

The format, `${CLAUDE_PLUGIN_ROOT}/skills/reference-kb/references/format.md`, holds every rule about what a note is.
The templates are in `${CLAUDE_PLUGIN_ROOT}/skills/reference-kb/templates/`. This skill says how to use them. The
root is `.claude/reference/` unless a repository says otherwise, and its README may add local conventions.

## Reading

- **Silence is no information.** A subject the knowledge base does not mention is not "no" and not "it works the
  obvious way". Answer it from the code.
- **Pointed at a note, read the file** with `Read`: it gives line numbers, and `read_note` does not.
- **A question in words:** search by meaning with Basic Memory, below.
- **A search that comes back empty or off target** is not an answer. Go to the root README's entry points, then the
  area's `overview.md`, then a text search scoped to the root.
- **Before trusting a note**, look at `verified` and run the validator with `--stale`. A stale or UNKNOWN note is a
  list of files to read, not an answer. A `measured_on` fact holds for the version it names.

## Basic Memory

Optional: without it, read the files and search the text.

- `search_notes` with `query` and `search_all_projects: true` covers every registered knowledge base; `project` pins
  one. Keep `output_format: "text"`, the default, for compact results.
- Permalinks come from paths, so two knowledge bases can share one. Before relying on a hit from an all-projects
  search, confirm which knowledge base it came from.
- `build_context` on `memory://<permalink>` follows relations. Raise `max_related` (default 10) on a hub note, or
  inbound links crowd out its outbound ones.
- `write_note` takes `title`, `content` and `directory`; `edit_note` takes `identifier` (the exact title or
  permalink), `operation` and `content`.
- **Its index covers one registered path per project**, normally the main checkout. A session on another branch or
  in a worktree gets results from that path, never from its own branch, so a hit can disagree with the file in front
  of it. The file wins.

## Writing

1. Read the format before every write.
2. Search for a note on the topic before creating one, and extend it if it exists.
3. Start a new note from its template, and go through the template's checklist before deleting it.
4. Write with `Write` and `Edit` inside the tree the session works in, so the change is on its branch. When that
   tree is itself the registered path, write with `write_note` and `edit_note` instead: Basic Memory's file watcher
   can miss a change made while it is indexing, and its own tools index as they write.
5. If Basic Memory's server is unreachable when a write needs it, say so and ask for a reconnect. Do not write around
   it.
6. Delegate a note that needs a lot of reading to the `reference-kb:kb-writer` agent.

Claude Code asks before every `Write` or `Edit` under `.claude/` in default and `acceptEdits` modes, and an allow
rule does not lift it (measured on Claude Code 2.1.311). Expect one prompt per write.

## Validating

From the repository root, before finishing any knowledge base work:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/reference-kb/scripts/validate.py" --root .claude/reference --stale
```

- Exit 0 says only that no error was found. Warnings leave it unchanged, so read them.
- It checks format, not truth. Never report a clean run as verification.
- Staleness has three outcomes: clean, stale (the commits are counted), and UNKNOWN (an untracked source or a failed
  git call). UNKNOWN is never clean.
- `--stale-in A..B` is the merge gate, which CI runs over a pull request's own commits.
- It needs PyYAML. If the import fails, tell the user to install it; never install it yourself.

## Re-verifying a stale note

1. Find which sources changed since `verified`: `git log --format='%h %cs %s' -- <source>` for each.
2. Re-read the changed parts.
3. Re-check only the claims resting on them, and correct the ones that are now wrong.
4. Move `verified` to today, and say in the Scope line which claims were carried forward without a re-check.

A frontmatter-only edit, such as rebuilding `sources`, never moves `verified`.

## Starting a knowledge base

1. Create the root with the trees it will use, and a README naming the entry points. The README has no frontmatter.
2. Copy `templates/kb.toml` to the root when the repository uses fewer than all three trees or adds vocabulary.
3. Point the repository's `CLAUDE.md` at the root: that it exists, that the note covering an area is read before the
   area's code, and that a question it does not answer is still open.
4. Run the validator in CI with `--stale-in` over each pull request's commits; the plugin's README has the recipe.
5. Registering with Basic Memory is the user's step, not the agent's: `bm project add <name> <path>`, a reconnect of
   the MCP server, then `bm reindex`. After checking out another branch in the registered checkout, the user runs
   `bm reindex`; after `bm config set`, the user reconnects the server.
