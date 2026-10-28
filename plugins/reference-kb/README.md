# reference-kb

A reference knowledge base is a directory of Markdown notes in a repository, `.claude/reference/` by default, that an
agent reads before the code or platform behaviour a note covers. Each note says which files matter, what in them is
unexpected, when it was last checked against them, and what it did not cover. This plugin carries everything such
knowledge bases share; a repository declares only what it adds, in a `kb.toml` beside its notes.

What it ships:

- **The `reference-kb` skill**: how to read, search, write, re-verify and validate notes, and how to set a knowledge
  base up.
- **The format**, `skills/reference-kb/references/format.md`: the one authority on what a note is.
- **Templates**, `skills/reference-kb/templates/`: one per kind of note, and a starting `kb.toml`.
- **The validator**, `skills/reference-kb/scripts/validate.py`: checks every note against the format, warns about
  notes whose sources changed since they were verified, and gates a pull request that changes a note's sources
  without re-verifying it.
- **The `kb-writer` agent**, spawned as `reference-kb:kb-writer`: writes a note that needs a lot of reading and
  returns a trace of what it read.

## Basic Memory

Notes are written in [Basic Memory](https://github.com/basicmachines-co/basic-memory)'s Markdown syntax: YAML
frontmatter, `- [category]` observations, and `relation [[Target]]` lines. That keeps a knowledge base readable by its
tools. The rest is this plugin's own format on top of that syntax: the trees, `verified` and `sources`, staleness
against git, the Scope line and project checklists. The validator checks all of it, needs no Basic Memory, and
contains none of its code.

Basic Memory has its own optional schema validation (`bm schema validate`), which checks frontmatter, observations
and relations against schema notes. It does not check anything this format adds.

## Needs

- Python 3.12 and PyYAML for the validator. Install PyYAML yourself; the agent will not.
- Basic Memory is optional. With it, agents search notes by meaning; without it, they read the files and search the
  text. Registering a knowledge base with Basic Memory (`bm project add`) is a step for you, not the agent.

## The validator in another repository's CI

Check this repository out at a pinned commit beside your own, then run the validator over the pull request's own
commits. In GitHub's pull request checkout `HEAD` merges the pull request into its base, so `HEAD^1..HEAD^2` is
exactly the pull request's commits, and the full history is needed to walk them.

```yaml
- uses: actions/checkout@<commit sha>
  with:
    fetch-depth: 0
    persist-credentials: false
- uses: actions/checkout@<commit sha>
  with:
    repository: Runt9-Productions/runt9-claude-harness
    ref: <commit sha of this repository>
    path: .reference-kb
    persist-credentials: false
- run: python3 -m pip install pyyaml==6.0.3
- run: >-
    python3 .reference-kb/plugins/reference-kb/skills/reference-kb/scripts/validate.py
    --root .claude/reference --stale-in HEAD^1..HEAD^2
```

It exits 0 when no error was found, 1 when a note has an error, and 2 when it could check nothing, which includes a
root that is missing or holds no notes. A knowledge base that moved or emptied therefore fails the step.

No settings.
