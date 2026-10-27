# reference-kb

A reference knowledge base is a repository's `.claude/reference/` directory of notes written for an agent to read
before the code: what is surprising, which file to read, and what a note does not cover. This plugin carries what
every such knowledge base shares, so each repository declares only what differs in `.claude/reference/kb.toml`.

- **The `reference-kb` skill:** how to read, search, write and validate notes, and how to set a knowledge base up.
  Its `references/format.md` is the format: frontmatter, the three trees (`domains/`, `entities/`, `projects/`), the
  closed vocabularies of observation categories, inline tags and relation types, and the staleness rules.
- **`validate.py`** in the skill's `scripts/`: checks every note against the format, and with `--stale` or
  `--stale-in BASE..HEAD` against git history. `--root` names the knowledge base, `.claude/reference` by default.
  Needs Python 3.12 and PyYAML.
- **Templates** in the skill's `templates/`, one per kind of note plus `kb.toml`.
- **The `kb-writer` agent:** writes and re-verifies notes, and returns a trace of what it read.
[Basic Memory](https://github.com/basicmachines-co/basic-memory) is optional: without it the skill falls back to
reading files and text search. Registering a knowledge base with it is the user's step (`bm project add`).

To validate a knowledge base in another repository's CI, check this repository out at a pinned commit and run
`python3 <checkout>/plugins/reference-kb/skills/reference-kb/scripts/validate.py --root .claude/reference
--stale-in "$BASE..$HEAD"`.

No settings.
