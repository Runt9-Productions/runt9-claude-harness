# runt9-claude-harness

A public Claude Code plugin marketplace (`runt9`) plus the harness pieces that cannot be plugins. Public and MIT:
nothing from an employer, a private project or a specific machine goes in, in code, comments, docs or tests.

## Layout

- `plugins/<name>/`: one self-contained plugin each, listed in `.claude-plugin/marketplace.json`.
- `harness/`: what a plugin cannot carry (status line, settings fragments, git hooks, `CLAUDE.md` template and
  fragments, style-guide skills). So far it holds `githooks/` (the bot authorship check in `pre-commit`,
  `pre-merge-commit` and `pre-push`, and the leak gate in `pre-push`), `leak-scan/` (the scan that gate and CI
  run, with its allowlist in `.leak-scan.toml`, and the `public-leak` review the gate and `review-text.sh` run),
  `fragments/` (always-on `CLAUDE.md` rules a user imports from `~/.claude/harness/current/fragments/`, so far
  `delegation.md`), `settings/` (fragments `bootstrap.py` merges into `~/.claude/settings.json`) and `skills/` (the
  `code-style`, `python-style`, `kotlin-style`, `typescript-style` and `comment-style` skills). Its version is in
  `harness/harness.json`.
- `bootstrap.py`: installs `harness/` as a version under `~/.claude/harness/versions/` behind the
  `~/.claude/harness/current` link, links the skills into `~/.claude/skills/`, sets `core.hooksPath` in the
  repositories named, adds the import line of each fragment picked to a marked block in `~/.claude/CLAUDE.md`, merges
  each settings fragment picked into `~/.claude/settings.json`, and installs plugins from the marketplace. A new part
  under `harness/` that must be wired into `~/.claude` or a repository registers a component in its
  `HARNESS_COMPONENTS`; a new file in `harness/fragments/` or `harness/settings/` is a component without one. Its
  tests are `test_bootstrap.py` beside it.
- `requirements-dev.txt`: the pinned Python tools CI runs (ruff, with `ruff.toml`, and pytest with every package it
  needs, since CI installs with `--no-deps`). Python that ships here uses the standard library only, except PyYAML
  in the reference-kb validator, which must parse frontmatter as Basic Memory writes it.
- `.github/scripts/`: the scripts CI runs, with their bats and pytest tests in `tests/`. `.github/actions/`: the
  composite actions the workflows share.
- `.claude/`: the profiles, reviewer pool and test references that the `lens-review` and `test-review` plugins read
  to review this repo. CI loads both plugins from the pull request's own `plugins/`.
- `.claude/reference/`: this repo's knowledge base, in the reference-kb plugin's format. Read the note covering an
  area before its code or platform behaviour; a question it does not answer is still open.
- `package.json` at the root: the pinned tools CI and local checks run (TypeScript and oxlint, with
  `.oxlintrc.json`).

## Releasing

Merging is not releasing. Every plugin sets `version` in its `.claude-plugin/plugin.json`, and a user gets a
change only when they update and that version has risen; auto-update is off for this marketplace by default. So
every PR that changes what a plugin ships raises its version, and CI fails it otherwise. Plugins with a contract
between them bump together. Marketplace entries hold only a name, a description and `./plugins/<name>`. The harness
works the same way with one version for all of `harness/`, in `harness/harness.json`: its rise is what tells a user
to run `bootstrap.py harness` again.

## Issues and pull request text

Changes to this repository, fixes and new features alike, are tracked as GitHub issues in the shape of
`.github/ISSUE_TEMPLATE/change.md`: Objective, Technical details, Out of scope, Acceptance criteria.

- Acceptance criteria are plain bullets stating outcomes, a few at most. Meeting them is necessary, not sufficient:
  review still judges the change against the objective.
- An issue stands on its own. It never points at `.claude/output`, a session, or anything outside this repository,
  and its examples are synthetic.
- Labels: `bug` or `enhancement`, one `area:` label, and `from-review` for a review finding deferred from its pull
  request.
- Issues, pull request descriptions and review replies are public the moment they post, and no CI scan reads them.
  Write each to a file, with an issue's or pull request's title on the first line, and check it from the installed
  harness (`~/.claude/harness/current/leak-scan/`, or the checkout's `harness/leak-scan/` where none is installed):
  `review-text.sh <file> . origin/main` for an issue or pull request, which adds the `public-leak` review, and
  `scan.sh --text <file> . origin/main` for a review reply. Post the title and body from that file only when the check
  exits 0. Cite commits by their short hash: a full one matches the scan's hex-identifier rule.

## Machine-local layers

A plugin reads machine-local data from `~/.claude/local/<plugin>/` and treats a missing file as empty; a skill in
`harness/skills/` does the same from `~/.claude/local/<skill>/`. Examples,
with synthetic content only, live in `plugins/<name>/local.example/`, or beside the file in `harness/`.

## Trying a change

Start a separate session with `claude --plugin-dir plugins/<name>`. It replaces the installed copy of that plugin
for that session only.

To check a mod, run `npm ci` once at the root, then load the mod as above, which writes the types `tsc` needs into
the plugin. Then run `npx --no-install tsc -p plugins/<name>`, `npx --no-install oxlint -c .oxlintrc.json
plugins/<name>` and `claude plugin test plugins/<name>`. `--no-install` runs only what `npm ci` put in `node_modules`.

To check Python, install the pinned tools into a virtual environment once, then run the checks from the root. CI adds flags that keep a config file a PR adds from changing them.

```
python3 -m venv <venv>
<venv>/bin/pip install --no-deps --only-binary :all: -r requirements-dev.txt
<venv>/bin/ruff check . && <venv>/bin/ruff format --check . && <venv>/bin/python -m pytest -p no:cacheprovider
```

The `min-release-age` cooldown in `.npmrc` applies only when npm resolves versions (`npm install` adding or changing a
dependency, `npm update`), and only on npm 11.10 or newer. `npm ci` installs the lockfile as written and skips it.

## Writing here

- Comments state the mechanism, never the incident that motivated it.
- Docs and skills give the rule and a one-line reason, not the story behind it.
- Tests are few, at the boundaries, with obviously synthetic fixtures.
- Nothing is copied in from another project. Write from what the file has to achieve.
- Changes to `.github/`, this file and tool configs need the owner's review.
