# runt9-claude-harness

A public Claude Code plugin marketplace (`runt9`) plus the harness pieces that cannot be plugins. Public and MIT:
nothing from an employer, a private project or a specific machine goes in, in code, comments, docs or tests.

## Layout

- `plugins/<name>/`: one self-contained plugin each, listed in `.claude-plugin/marketplace.json`.
- `harness/`: what a plugin cannot carry (status line, settings fragments, git hooks, `CLAUDE.md` template and
  fragments, style-guide skills). So far it holds `githooks/` (the pre-push review) and `leak-scan/` (the scan
  that hook and CI run, with its allowlist in `.leak-scan.toml`). A `bootstrap.py` at the root will copy the parts a
  user picks into `~/.claude`; it does not exist yet.
- `.github/scripts/`: the scripts CI runs, with their bats tests in `tests/`.
- `.claude/`: this repo's own `/code-review` and `/test-review` skills, their reviewer agents and profiles.

## Releasing

Merging is not releasing. Every plugin sets `version` in its `.claude-plugin/plugin.json`, and a user gets a
change only when they update and that version has risen; auto-update is off for this marketplace by default. So
every PR that changes what a plugin ships raises its version, and CI fails it otherwise. Plugins with a contract
between them bump together. Marketplace entries hold only a name, a description and `./plugins/<name>`.

## Machine-local layers

A plugin reads machine-local data from `~/.claude/local/<plugin>/` and treats a missing file as empty. Examples,
with synthetic content only, live in `plugins/<name>/local.example/`, or beside the file in `harness/`.

## Trying a change

Start a separate session with `claude --plugin-dir plugins/<name>`. It replaces the installed copy of that plugin
for that session only.

## Writing here

- Comments state the mechanism, never the incident that motivated it.
- Docs and skills give the rule and a one-line reason, not the story behind it.
- Tests are few, at the boundaries, with obviously synthetic fixtures.
- Changes to `.github/`, this file and tool configs need the owner's review.
