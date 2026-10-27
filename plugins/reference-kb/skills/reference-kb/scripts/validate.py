#!/usr/bin/env python3
"""Validate a reference knowledge base against references/format.md.

    python3 validate.py [--root DIR] [--warnings] [--stale] [--stale-in BASE..HEAD]

--root is the knowledge base directory, `.claude/reference` under the current directory by default. A `kb.toml`
there declares which trees the knowledge base holds and what it adds to the shared vocabularies; without one it
holds all three trees and adds nothing. `sources` paths resolve against the git checkout holding the root.

Exit 0 when no note has an error, 1 when one does, 2 when format.md, templates/domain.md, kb.toml or the root's
README.md cannot be read. Warnings never change the exit status.

Nothing here holds an opinion a file can hold instead: categories, inline tags and relation types are parsed out of
format.md's tables, the keys a domains/ note carries out of templates/domain.md's frontmatter, and kb.toml adds to
the vocabularies. An unknown frontmatter key is an error, so a key used in one note fails until the format and the
template carry it.

Needs PyYAML, because Basic Memory rewrites frontmatter with yaml.dump and the two parsers must agree.
"""

import argparse
import datetime as dt
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
FORMAT = SKILL_DIR / "references" / "format.md"
DOMAIN_TEMPLATE = SKILL_DIR / "templates" / "domain.md"
DEFAULT_ROOT = Path(".claude") / "reference"
CONFIG_FILE = "kb.toml"
INDEX_FILE = "README.md"
GIT_TIMEOUT_SECONDS = 60


class Tree(StrEnum):
    DOMAINS = "domains"
    ENTITIES = "entities"
    PROJECTS = "projects"


SCOPE_OPENER = "**Scope.**"
# Rules out a stub, not a terse note. An unedited template copy clears it; PLACEHOLDERS is what catches that copy.
MIN_SCOPE_CHARS = 100

# Every placeholder the templates carry. A template that gains one without it being added here validates unedited.
PLACEHOLDERS = (
    "YYYY-MM-DD",
    "REPLACE THIS",
    "the-branch-you-read-the-code-on",
    "area/slug",
    "Human Readable Name",
    "Parent Hub Note",
    "Some Other Note",
    "path/to/",
    "<Project Name>",
    "<slug>",
    "stable-external-identifier",
)

# The entities/ and projects/ key sets have a required and an optional tier, which one frontmatter block cannot
# express, so they live here rather than in a template.
ENTITY_REQUIRED = frozenset({"title", "type", "permalink", "tags", "verified", "coverage"})
ENTITY_OPTIONAL = frozenset({"branch", "sources", "id"})
PROJECT_REQUIRED = frozenset({"title", "type", "permalink", "tags"})
PROJECT_OPTIONAL = frozenset({"verified", "branch", "status", "release", "opened", "sources"})

SOURCES = "sources"
# Optional on domains/ notes, and makes `sources` optional: a measured platform fact has no repo file whose change
# would make it wrong.
MEASURED_ON = "measured_on"

# The document set check branches on these, so kb.toml may add statuses but never remove one.
PROJECT_STATUSES = frozenset({"research", "implementation", "complete", "tabled", "blocked"})
STARTED_STATUSES = frozenset({"research", "implementation"})
IMPLEMENTATION = "implementation"

# Flow (`[a, b]`) and block (`- a`) lists are the same YAML and both pass.
LIST_KEYS = frozenset({SOURCES, "tags"})

# Accepted by pattern rather than listed, so a project's own ticket prefix needs no edit here.
TICKET_TAG = re.compile(r"[A-Z][A-Z0-9]*-\d+")
CATEGORY_NAME = re.compile(r"\w+")
TAG_NAME = re.compile(r"[\w-]+")

CONFIG_KEYS = frozenset({"trees", "categories", "tags", "statuses"})
RELATIONS_HEADING = "## Relations"


class SpecError(Exception):
    pass


@dataclass(frozen=True)
class Spec:
    categories: frozenset[str]
    tags: frozenset[str]
    relations: frozenset[str]
    statuses: frozenset[str]
    domain_keys: frozenset[str]
    trees: frozenset[Tree]


@dataclass(frozen=True)
class Kb:
    root: Path
    repo: Path
    spec: Spec


@dataclass(frozen=True)
class Problem:
    path: Path
    line: int
    message: str
    warning: bool = False

    def render(self, repo: Path) -> str:
        where = self.path.relative_to(repo) if self.path.is_relative_to(repo) else self.path
        level = "warn " if self.warning else "ERROR"
        return f"{level} {where}:{self.line}: {self.message}"


def parse_frontmatter(lines: list[str]) -> tuple[dict[str, object], int]:
    """(mapping, index of the closing ---), or ({}, -1) without a delimited block.

    Raises yaml.YAMLError when the block is not a mapping. Values arrive YAML-typed: a bare date is a
    `datetime.date`, a quoted one a `str`, so checks compare meaning, never layout.
    """
    if not lines or lines[0].strip() != "---":
        return {}, -1
    for index, raw in enumerate(lines[1:], start=1):
        if raw.strip() != "---":
            continue
        data = yaml.safe_load("\n".join(lines[1:index]))
        if data is None:
            return {}, index
        if not isinstance(data, dict):
            raise yaml.YAMLError(f"frontmatter is a {type(data).__name__}, not a mapping")
        return {str(key): value for key, value in data.items()}, index
    return {}, -1


def as_date(value: object) -> dt.date | None:
    """`value` as a date when it is an ISO YYYY-MM-DD date, bare or quoted."""
    if isinstance(value, dt.datetime):
        return None
    if isinstance(value, dt.date):
        return value
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def link_targets(text: str) -> set[str]:
    """Wikilink targets, with any `|alias` stripped: `[[Example Topic|the topic]]` targets `Example Topic`."""
    return {match.split("|", 1)[0].strip() for match in re.findall(r"\[\[([^\]]+)\]\]", text)}


def relation_lines(body: list[str]) -> list[tuple[int, str]]:
    """(index in body, stripped line) of each list item under the `## Relations` heading."""
    found = []
    in_relations = False
    for index, line in enumerate(body):
        stripped = line.strip()
        if stripped.startswith("## "):
            in_relations = stripped == RELATIONS_HEADING
        elif in_relations and stripped.startswith("- "):
            found.append((index, stripped))
    return found


def read_config(root: Path) -> dict[str, object]:
    path = root / CONFIG_FILE
    if not path.is_file():
        return {}
    try:
        with path.open("rb") as handle:
            config = tomllib.load(handle)
    except tomllib.TOMLDecodeError as error:
        raise SpecError(f"{path}: {error}") from error
    unknown = sorted(set(config) - CONFIG_KEYS)
    if unknown:
        raise SpecError(f"{path}: unknown key {', '.join(unknown)}; expected {', '.join(sorted(CONFIG_KEYS))}")
    return config


def config_trees(config: dict[str, object], path: Path) -> frozenset[Tree]:
    names = config.get("trees", list(Tree))
    if not isinstance(names, list) or not names:
        raise SpecError(f"{path}: trees must be a non-empty list drawn from {', '.join(Tree)}")
    trees = set()
    for name in names:
        try:
            trees.add(Tree(name))
        except ValueError as error:
            raise SpecError(f"{path}: unknown tree {name!r}; expected one of {', '.join(Tree)}") from error
    return frozenset(trees)


def config_names(config: dict[str, object], key: str, pattern: re.Pattern[str], path: Path) -> frozenset[str]:
    """The names a `[key]` table of `name = "what it means"` adds to a vocabulary."""
    table = config.get(key, {})
    if not isinstance(table, dict):
        raise SpecError(f'{path}: [{key}] must be a table of name = "what it means"')
    for name, meaning in table.items():
        if not pattern.fullmatch(name):
            raise SpecError(f"{path}: {key}.{name} is not a valid name (want {pattern.pattern})")
        if not isinstance(meaning, str) or not meaning.strip():
            raise SpecError(f"{path}: {key}.{name} needs a string saying what it means")
    return frozenset(table)


def load_spec(root: Path) -> Spec:
    text = FORMAT.read_text(encoding="utf-8")
    categories = set(re.findall(r"^\|\s*`\[(\w+)\]`\s*\|", text, re.MULTILINE))
    tags = set()
    for tag in re.findall(r"^\|\s*`#([\w-]+)`\s*\|", text, re.MULTILINE):
        # The ticket row documents the pattern; it is not a literal tag.
        if not TICKET_TAG.fullmatch(tag):
            tags.add(tag)
    relations = set()
    relation_list = re.search(r"^## Relation types\s*\n+(.+?)\n", text, re.MULTILINE)
    if relation_list:
        relations = set(re.findall(r"`(\w+)`", relation_list.group(1)))
    template_lines = DOMAIN_TEMPLATE.read_text(encoding="utf-8").splitlines()
    try:
        template, _ = parse_frontmatter(template_lines)
    except yaml.YAMLError as error:
        raise SpecError(f"{DOMAIN_TEMPLATE}: frontmatter is not valid YAML: {error}") from error
    if not all((categories, tags, relations, template)):
        raise SpecError(f"could not parse the vocabularies out of {FORMAT} and {DOMAIN_TEMPLATE}")

    config_path = root / CONFIG_FILE
    config = read_config(root)
    return Spec(
        categories=frozenset(categories) | config_names(config, "categories", CATEGORY_NAME, config_path),
        tags=frozenset(tags) | config_names(config, "tags", TAG_NAME, config_path),
        relations=frozenset(relations),
        statuses=PROJECT_STATUSES | config_names(config, "statuses", TAG_NAME, config_path),
        domain_keys=frozenset(template),
        trees=config_trees(config, config_path),
    )


def repo_root(root: Path) -> Path:
    """The checkout `sources` resolve against: git's top level, else two levels up (`<repo>/.claude/reference`)."""
    fallback = root.parents[1] if len(root.parents) > 1 else root
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return fallback
    top = result.stdout.strip()
    if result.returncode != 0 or not top:
        return fallback
    top_path = Path(top).resolve()
    return top_path if top_path in root.parents else fallback


def tree_of(relative: Path, trees: frozenset[Tree]) -> Tree | None:
    if len(relative.parts) < 2:
        return None
    for tree in trees:
        if relative.parts[0] == tree:
            return tree
    return None


@dataclass(frozen=True)
class Note:
    path: Path
    relative: Path
    tree: Tree | None
    lines: list[str]
    fm: dict[str, object]
    # Index of the closing ---, or -1 when there is no frontmatter block or it is not valid YAML.
    fm_end: int
    fm_error: yaml.YAMLError | None
    links: set[str]
    # Wikilink targets under `## Relations` only.
    relations: set[str]

    @classmethod
    def read(cls, kb: Kb, path: Path) -> "Note":
        relative = path.relative_to(kb.root)
        lines = path.read_text(encoding="utf-8").splitlines()
        fm_error = None
        try:
            fm, fm_end = parse_frontmatter(lines)
        except yaml.YAMLError as error:
            fm, fm_end, fm_error = {}, -1, error
        relations = set()
        for _, line in relation_lines(lines[fm_end + 1 :]):
            relations.update(link_targets(line))
        links = link_targets("\n".join(lines))
        return cls(path, relative, tree_of(relative, kb.spec.trees), lines, fm, fm_end, fm_error, links, relations)

    @property
    def title(self) -> str | None:
        title = self.fm.get("title")
        return None if title is None else str(title)

    @property
    def durable(self) -> bool:
        return self.tree in (Tree.DOMAINS, Tree.ENTITIES)

    def sources(self) -> list[str]:
        value = self.fm.get(SOURCES)
        if not isinstance(value, list):
            return []
        return [source for source in value if isinstance(source, str)]


def note_paths(root: Path) -> list[Path]:
    """Every note under the root. A `_`-prefixed file or directory (`_legacy/`) is never a note."""
    paths = []
    for path in sorted(root.rglob("*.md")):
        relative = path.relative_to(root)
        if relative == Path(INDEX_FILE):
            continue
        if any(part.startswith("_") for part in relative.parts):
            continue
        paths.append(path)
    return paths


def expected_permalink(note: Note) -> str:
    """The path under the root without `.md`, with a leading `domains/` dropped."""
    parts = note.relative.with_suffix("").parts
    if parts[0] == Tree.DOMAINS:
        parts = parts[1:]
    return "/".join(parts)


def key_sets(kb: Kb, note: Note) -> tuple[frozenset[str], frozenset[str]]:
    """(required, allowed) frontmatter keys for the note's tree."""
    match note.tree:
        case Tree.DOMAINS:
            required = kb.spec.domain_keys
            if MEASURED_ON in note.fm:
                required = required - {SOURCES}
            return required, kb.spec.domain_keys | {MEASURED_ON}
        case Tree.ENTITIES:
            return ENTITY_REQUIRED, ENTITY_REQUIRED | ENTITY_OPTIONAL
        case _:
            return PROJECT_REQUIRED, PROJECT_REQUIRED | PROJECT_OPTIONAL


def check_frontmatter(kb: Kb, note: Note) -> list[str]:
    """Messages for the frontmatter, all reported on line 1."""
    messages = []
    fm = note.fm

    required, allowed = key_sets(kb, note)
    for key in sorted(required - set(fm)):
        messages.append(f"frontmatter is missing required key '{key}'")
    for key in sorted(set(fm) - allowed):
        messages.append(f"frontmatter has unknown key '{key}': add it to the format and every note, or remove it")

    for key in sorted(set(fm) & LIST_KEYS):
        value = fm[key]
        if value is None or value == []:
            messages.append(f"'{key}' is present but empty")
        elif not isinstance(value, list):
            messages.append(f"'{key}' must be a list, got {value!r}")
        elif not all(isinstance(item, str) and item.strip() for item in value):
            messages.append(f"'{key}' must hold only non-empty strings, got {value!r}")

    if MEASURED_ON in fm:
        measured_on = fm[MEASURED_ON]
        if not isinstance(measured_on, str) or not measured_on.strip():
            messages.append(f"'{MEASURED_ON}' must be a quoted string naming what was measured, got {measured_on!r}")

    if fm.get("type") not in (None, "note"):
        messages.append(f"type is '{fm['type']}', expected 'note'")

    if "permalink" in fm:
        want = expected_permalink(note)
        if fm["permalink"] != want:
            messages.append(f"permalink is '{fm['permalink']}', expected '{want}'")

    if "verified" in fm:
        verified = as_date(fm["verified"])
        if verified is None:
            messages.append(f"verified '{fm['verified']}' is not an ISO YYYY-MM-DD date")
        elif verified > dt.date.today():
            messages.append(f"verified '{verified}' is in the future")

    if "coverage" in fm and fm["coverage"] not in ("partial", "complete"):
        messages.append(f"coverage is '{fm['coverage']}', expected 'partial' or 'complete'")

    if "status" in fm and fm["status"] not in kb.spec.statuses:
        messages.append(f"status is '{fm['status']}', expected one of {', '.join(sorted(kb.spec.statuses))}")

    for source in note.sources():
        if not (kb.repo / source).exists():
            messages.append(f"sources lists '{source}', which does not exist; its subject moved, so re-verify the note")

    for key, value in fm.items():
        for text in value if isinstance(value, list) else [value]:
            if not isinstance(text, str):
                continue
            for placeholder in PLACEHOLDERS:
                if placeholder in text:
                    messages.append(f"leftover template placeholder {placeholder!r} in frontmatter key '{key}'")
    return messages


def scope_problem(note: Note, body: list[str], h1: int, offset: int) -> Problem | None:
    """The blockquote after the H1 must open with SCOPE_OPENER and say what the note does not cover."""
    after = [index for index, line in enumerate(body[h1 + 1 :], start=h1 + 1) if line.strip()]
    if not after or not body[after[0]].lstrip().startswith(">"):
        return Problem(note.path, offset + h1, f"{note.tree}/ note has no scope blockquote right after the H1")
    # Only the first paragraph is the scope; a later `>` paragraph is a callout and must not pad a stub past the floor.
    paragraph = []
    for line in body[after[0] :]:
        quoted = line.strip()
        if not quoted.startswith(">") or not quoted[1:].strip():
            break
        paragraph.append(quoted[1:].strip())
    scope = " ".join(paragraph)
    line = offset + after[0]
    if not scope.startswith(SCOPE_OPENER):
        return Problem(note.path, line, f"scope blockquote does not open with {SCOPE_OPENER!r}")
    length = len(scope) - len(SCOPE_OPENER)
    if length < MIN_SCOPE_CHARS:
        message = f"scope is {length} chars after {SCOPE_OPENER!r}, too short to say what the note leaves out"
        return Problem(note.path, line, f"{message} (want {MIN_SCOPE_CHARS} or more)")
    return None


def line_problems(kb: Kb, stripped: str) -> list[str]:
    """Messages for one body line: placeholders, observation categories and inline tags."""
    messages = []
    for placeholder in PLACEHOLDERS:
        if placeholder in stripped:
            messages.append(f"leftover template placeholder {placeholder!r}")

    category = re.match(r"-\s*\[(\w+)\]", stripped)
    # `- [x]` is a task-list checkbox, not a category.
    if category is None or category.group(1).lower() == "x":
        return messages
    if category.group(1) not in kb.spec.categories:
        known = ", ".join(sorted(kb.spec.categories))
        messages.append(f"unknown category '[{category.group(1)}]'; add it to the format or kb.toml, or use {known}")

    # Tags count on observation lines only, which is where Basic Memory indexes them; a space before the `#` keeps
    # URL fragments out.
    for tag in re.findall(r"(?:^|\s)#([\w-]+)", stripped):
        if TICKET_TAG.fullmatch(tag) or tag in kb.spec.tags:
            continue
        known = ", ".join(f"#{known_tag}" for known_tag in sorted(kb.spec.tags))
        messages.append(f"unknown inline tag '#{tag}'; add it to the format or kb.toml, or use {known} or #PROJ-123")
    return messages


def check_body(kb: Kb, note: Note) -> list[Problem]:
    problems = []
    body = note.lines[note.fm_end + 1 :]
    # 1-based line numbers for messages.
    offset = note.fm_end + 2

    h1 = next((index for index, line in enumerate(body) if line.startswith("# ")), None)
    if h1 is None:
        problems.append(Problem(note.path, offset, "no H1 heading"))
    elif note.durable:
        scope = scope_problem(note, body, h1, offset)
        if scope is not None:
            problems.append(scope)

    for index, line in enumerate(body):
        for message in line_problems(kb, line.strip()):
            problems.append(Problem(note.path, offset + index, message))
    for index, stripped in relation_lines(body):
        relation = stripped[2:].split(" ", 1)[0]
        if relation and relation not in kb.spec.relations:
            known = ", ".join(sorted(kb.spec.relations))
            problems.append(Problem(note.path, offset + index, f"unknown relation type '{relation}'; use {known}"))
    return problems


def check(kb: Kb, note: Note) -> list[Problem]:
    if note.tree is None:
        trees = ", ".join(sorted(f"{tree}/" for tree in kb.spec.trees))
        message = f"outside the trees this knowledge base holds ({trees}); move it, or declare its tree in kb.toml"
        return [Problem(note.path, 1, message)]
    if note.fm_error is not None:
        mark = getattr(note.fm_error, "problem_mark", None)
        line = mark.line + 2 if mark else 1
        first_line = str(note.fm_error).splitlines()[0]
        return [Problem(note.path, line, f"frontmatter is not valid YAML: {first_line}")]
    if note.fm_end == -1:
        return [Problem(note.path, 1, "no frontmatter block, or no closing ---")]
    frontmatter = [Problem(note.path, 1, message) for message in check_frontmatter(kb, note)]
    return frontmatter + check_body(kb, note)


def check_project_documents(notes: list[Note]) -> list[Problem]:
    """A started project needs decisions.md, and one in implementation also checklist.md.

    Required by status, not by the directory existing: an overview alone is a project that has not started, and a
    checklist written after the work records planning that never happened.
    """
    problems = []
    for note in notes:
        if note.tree != Tree.PROJECTS:
            continue
        if note.relative.name != "overview.md" or len(note.relative.parts) != 3:
            continue
        status = note.fm.get("status")
        if status not in STARTED_STATUSES:
            continue
        project = note.path.parent
        if not (project / "decisions.md").exists():
            problems.append(Problem(note.path, 1, f"status is {status} but decisions.md is missing"))
        if status == IMPLEMENTATION and not (project / "checklist.md").exists():
            problems.append(Problem(note.path, 1, "status is implementation but checklist.md, its gate, is missing"))
    return problems


def index_titles(kb: Kb) -> dict[str, Path]:
    """The root README.md's title, if it has one: it is not a note, but notes may link to it."""
    index = kb.root / INDEX_FILE
    if not index.is_file():
        return {}
    try:
        fm, _ = parse_frontmatter(index.read_text(encoding="utf-8").splitlines())
    except yaml.YAMLError as error:
        raise SpecError(f"{index}: frontmatter is not valid YAML: {error}") from error
    if "title" not in fm:
        return {}
    return {str(fm["title"]): index}


def check_links(notes: list[Note], titles: dict[str, Path]) -> list[Problem]:
    problems = []
    by_title = {}
    for note in notes:
        if note.title:
            by_title[note.title] = note

    for note in notes:
        for target in sorted(note.links - set(titles)):
            problems.append(Problem(note.path, 1, f"dangling wikilink [[{target}]], a note worth writing", True))

        # Any relation back counts, since exact inverses would fire on legitimate asymmetries like part_of. A
        # projects/ note links out to a domains/ note one way: backlinks to every ticket would rot as tickets close.
        # entities/ to domains/ is not exempt, so an entity its index note does not list warns.
        for target in sorted(note.relations):
            other = by_title.get(target)
            if other is None or not note.title:
                continue
            if note.tree == Tree.PROJECTS and other.tree == Tree.DOMAINS:
                continue
            if note.title not in other.relations:
                message = f"relation to [[{target}]] is one way: {other.relative} does not link back"
                problems.append(Problem(note.path, 1, message, True))
    return problems


def run_git(kb: Kb, args: list[str]) -> subprocess.CompletedProcess[str] | None:
    """The finished git call, or None when git could not be run at all."""
    try:
        return subprocess.run(
            ["git", *args], cwd=kb.repo, capture_output=True, text=True, timeout=GIT_TIMEOUT_SECONDS, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return None


def tracked_sources(kb: Kb, paths: list[str]) -> set[str] | None:
    """Which of `paths` git tracks, or None if git could not say.

    `git log` on an untracked file prints nothing and exits 0, which would read as "unchanged" forever.
    """
    result = run_git(kb, ["ls-files", "-z", "--", *paths])
    if result is None or result.returncode != 0:
        return None
    return {path for path in result.stdout.split("\0") if path}


def verified_moved_after(kb: Kb, source_commit: str, note: Note, rev_range: str) -> bool:
    """Whether a commit in `rev_range` that changes the note's `verified:` line is `source_commit` or follows it.

    Order, not date, because a rebase resets every committer date but keeps the order. A git failure answers
    False, so the gate fails when it cannot tell.
    """
    result = run_git(kb, ["log", rev_range, "--format=%H", "-G", "^verified:", "--", str(note.path)])
    if result is None or result.returncode != 0:
        return False
    for note_commit in result.stdout.split():
        # A commit is its own ancestor, so a source change and its re-verify in one commit pass.
        ancestor = run_git(kb, ["merge-base", "--is-ancestor", source_commit, note_commit])
        if ancestor is not None and ancestor.returncode == 0:
            return True
    return False


def git_failure(result: subprocess.CompletedProcess[str] | None) -> str:
    if result is None:
        return "git could not run"
    lines = result.stderr.strip().splitlines()
    return lines[0] if lines else f"exit {result.returncode}"


def note_staleness(kb: Kb, note: Note, rev_range: str | None) -> list[Problem]:
    """Stale (commits landed on its sources after `verified`), clean (none), or UNKNOWN (not measurable).

    UNKNOWN never collapses into clean. With `rev_range` only commits in the range count, and stale and UNKNOWN are
    both errors, so a pull request fails for the notes it made stale and not for what it inherited.
    """
    unknown_is_warning = rev_range is None
    verified = as_date(note.fm.get("verified"))
    existing = [source for source in note.sources() if (kb.repo / source).exists()]
    if verified is None or not existing:
        return []

    tracked = tracked_sources(kb, existing)
    if tracked is None:
        message = "git could not list tracked sources, so staleness is UNKNOWN"
        return [Problem(note.path, 1, message, unknown_is_warning)]
    problems = []
    untracked = sorted(set(existing) - tracked)
    if untracked:
        message = f"staleness is UNKNOWN for untracked sources, which git has no history for: {', '.join(untracked)}"
        problems.append(Problem(note.path, 1, message, unknown_is_warning))
    measurable = [source for source in existing if source in tracked]
    if not measurable:
        return problems

    # Compared here rather than with --since, which reads a bare date as that date at the current time of day and so
    # counts a same-day commit or not depending on when it runs.
    range_args = [] if rev_range is None else [rev_range]
    result = run_git(kb, ["log", *range_args, "--format=%h %cs", "--", *measurable])
    if result is None or result.returncode != 0:
        message = f"git log failed, so staleness is UNKNOWN: {git_failure(result)}"
        problems.append(Problem(note.path, 1, message, unknown_is_warning))
        return problems

    newer = []
    for line in result.stdout.splitlines():
        sha, date = line.split()
        if dt.date.fromisoformat(date) <= verified:
            continue
        if rev_range is not None and verified_moved_after(kb, sha, note, rev_range):
            continue
        newer.append(sha)
    if not newer:
        return problems
    if rev_range is None:
        message = f"{len(newer)} commit(s) touched its sources since verified={verified}; re-read before trusting it"
        problems.append(Problem(note.path, 1, message, True))
    else:
        message = f"{rev_range} changes its sources after verified={verified} ({', '.join(newer)})"
        problems.append(Problem(note.path, 1, f"{message}; re-read the note and move verified"))
    return problems


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="the knowledge base directory")
    parser.add_argument("--warnings", action="store_true", help="also list warnings")
    parser.add_argument(
        "--stale", action="store_true", help="check `sources` against git history since `verified` (implies --warnings)"
    )
    parser.add_argument(
        "--stale-in",
        metavar="BASE..HEAD",
        help="fail on notes whose sources a commit in this range changed after `verified` (implies --stale)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        print(f"{root} is not a directory", file=sys.stderr)
        return 2
    try:
        kb = Kb(root, repo_root(root), load_spec(root))
        titles = index_titles(kb)
    except SpecError as error:
        print(error, file=sys.stderr)
        return 2

    notes = [Note.read(kb, path) for path in note_paths(root)]
    problems = check_project_documents(notes)
    for note in notes:
        problems.extend(check(kb, note))
        if not note.title:
            continue
        if note.title in titles:
            other = titles[note.title].relative_to(root)
            problems.append(Problem(note.path, 1, f"title '{note.title}' is also used by {other}"))
        titles[note.title] = note.path
    problems.extend(check_links(notes, titles))
    if args.stale or args.stale_in:
        for note in notes:
            problems.extend(note_staleness(kb, note, args.stale_in))

    errors = [problem for problem in problems if not problem.warning]
    warnings = [problem for problem in problems if problem.warning]
    show_warnings = args.warnings or args.stale or args.stale_in
    for problem in errors:
        print(problem.render(kb.repo))
    if show_warnings:
        for problem in warnings:
            print(problem.render(kb.repo))
    hint = "" if show_warnings else " (--warnings to list them)"
    print(f"\n{len(notes)} notes, {len(errors)} errors, {len(warnings)} warnings{hint}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
