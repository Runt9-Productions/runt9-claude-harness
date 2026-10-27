#!/usr/bin/env python3
"""Check a reference knowledge base against the reference-kb format.

Run it from the repository root:

    python3 validate.py [--root DIR] [--warnings] [--stale] [--stale-in A..B]

Every *.md file under the root is a note, except the root's README.md and anything under a name starting with "_".
The frontmatter keys of each tree and the closed vocabularies come from the marked tables in ../references/format.md.
The root's kb.toml may narrow the trees and add categories, tags and statuses; the rest is fixed. Paths in `sources`
resolve against the git top level holding the root, or the current directory outside git.

Both staleness modes leave merge commits out: a merge's changes are counted in the commits that made them. A source
commit is re-verified when it, or a commit descending from it, edits the note and leaves `verified` on or after the
source commit's date, which is always the committer's own date. `verified` need not move. Edits under the note's
earlier paths count; a commit that only moves the note, changing at most its `permalink`, does not.

--stale warns about each note whose sources changed in commits dated after its `verified` date and not re-verified.
A commit on the same day as `verified` counts as covered, so an uncommitted re-verify still clears the warning.
A source git does not track, or a git call that fails or times out, is reported as UNKNOWN.

--stale-in A..B is the merge gate, and implies --stale. A note fails when a commit in A..B changes one of its
sources and is not re-verified, so a source change after the note's last edit fails even on the same day. UNKNOWN
fails, and staleness from before A never does.

Exit status: 0 no errors, whatever the warnings; 1 at least one error; 2 nothing could be checked, because the root
is missing or holds no notes, kb.toml is unreadable or invalid, the format file cannot be read, or the range does
not resolve.

Needs Python 3.12 and PyYAML.
"""

import argparse
import datetime
import re
import subprocess
import sys
import tomllib
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from pathlib import Path
from typing import TypeGuard

import yaml

FORMAT_FILE = Path(__file__).resolve().parent.parent / "references" / "format.md"
CONFIG_FILE = "kb.toml"
README = Path("README.md")
DEFAULT_ROOT = Path(".claude") / "reference"

TREES = ("domains", "entities", "projects")
DURABLE_TREES = ("domains", "entities")
DOMAINS_TREE = "domains"
PROJECTS_TREE = "projects"
RESEARCH_DIR = "research"
STARTED_STATUSES = ("research", "implementation")
CHECKLIST_STATUS = "implementation"
BASE_KEYS = ("title", "type", "permalink", "tags")
NOTE_TYPE = "note"

VOCABULARY_TABLES = ("categories", "tags", "relations", "statuses", "coverage")
KEYS_TABLE = "keys"
CONFIG_TABLES = ("categories", "tags", "statuses")
KEY_REQUIRED = "required"
KEY_OPTIONAL = "optional"
KEY_ABSENT = "no"

RELATIONS_HEADING = "Relations"
SCOPE_OPENER = "**Scope.**"
MIN_SCOPE_WORDS = 10
GIT_TIMEOUT_SECONDS = 30
# A date one day past UTC today is still today in some timezone.
FUTURE_GRACE = datetime.timedelta(days=1)

PLACEHOLDER = re.compile(r"\{\{[^{}\n]*\}\}")
TICKET_TAG = re.compile(r"[A-Z][A-Z0-9]*-[0-9]+")
CONFIG_NAME = re.compile(r"[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*")
TABLE_MARKER = re.compile(r"\s*<!-- table: ([a-z]+) -->")
TABLE_SEPARATOR = re.compile(r":?-+:?")
BACKTICKED = re.compile(r"`([^`]+)`")
FRONTMATTER_KEY = re.compile(r"([A-Za-z_][\w-]*)\s*:")
ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
FENCE = re.compile(r"\s*(?:```|~~~)")
CODE_SPAN = re.compile(r"`[^`\n]*`")
HEADING = re.compile(r"(#{1,6})\s+(.*)")
LIST_ITEM = re.compile(r"\s*[-*+]\s")
# "]" followed by "(" or "[" is a Markdown link, so a category must be followed by whitespace or the line's end.
OBSERVATION = re.compile(r"\s*[-*+]\s+\[([^\[\]\n]+)\](?=\s|$)")
TASK_BOXES = frozenset({" ", "x", "X"})
# The "#" must start the line or follow whitespace, so a URL fragment is not a tag.
INLINE_TAG = re.compile(r"(?:^|(?<=\s))#([A-Za-z][\w-]*)")
RELATION = re.compile(r"\s*[-*+]\s+([A-Za-z_]+)\s+\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]")
WIKILINK = re.compile(r"\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]")


class SetupError(Exception):
    """Nothing can be checked, so the run exits 2; the message names the file or option at fault."""


class GitError(Exception):
    pass


class Level(StrEnum):
    ERROR = "ERROR"
    WARN = "warn"


@dataclass(frozen=True)
class Problem:
    level: Level
    path: str
    line: int
    message: str

    def __str__(self) -> str:
        return f"{self.level} {self.path}:{self.line}: {self.message}"


@dataclass(frozen=True)
class KeySet:
    required: frozenset[str]
    allowed: frozenset[str]


@dataclass(frozen=True)
class Format:
    vocabularies: dict[str, frozenset[str]]
    keys: dict[str, KeySet]


@dataclass(frozen=True)
class Config:
    trees: tuple[str, ...]
    categories: frozenset[str]
    tags: frozenset[str]
    relations: frozenset[str]
    statuses: frozenset[str]
    coverage: frozenset[str]


@dataclass
class Note:
    path: Path
    rel: Path
    shown: str
    tree: str
    frontmatter: dict
    frontmatter_lines: list[tuple[int, str]]
    key_lines: dict[str, int]
    body: list[tuple[int, str]]
    prose: list[tuple[int, str]]

    @property
    def is_research(self) -> bool:
        return self.tree == PROJECTS_TREE and len(self.rel.parts) > 3 and self.rel.parts[2] == RESEARCH_DIR

    @property
    def title(self) -> str | None:
        title = self.frontmatter.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
        return None

    def line_of(self, key: str) -> int:
        return self.key_lines.get(key, 1)

    def error(self, line: int, message: str) -> Problem:
        return Problem(Level.ERROR, self.shown, line, message)

    def warn(self, line: int, message: str) -> Problem:
        return Problem(Level.WARN, self.shown, line, message)


class Git:
    def __init__(self, top: Path) -> None:
        self.top = top
        self.verified_cache: dict[tuple[str, str], datetime.date | None] = {}

    def run(self, *args: str) -> subprocess.CompletedProcess[str]:
        command = ["git", "-C", str(self.top), *args]
        try:
            return subprocess.run(command, capture_output=True, text=True, timeout=GIT_TIMEOUT_SECONDS, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GitError(f"git {args[0]} did not finish: {error}") from error

    def output(self, *args: str) -> str:
        result = self.run(*args)
        if result.returncode != 0:
            raise GitError(f"git {args[0]} failed: {result.stderr.strip()}")
        return result.stdout

    def is_tracked(self, path: str) -> bool:
        return bool(self.output("ls-files", "--", path).strip())

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        result = self.run("merge-base", "--is-ancestor", ancestor, descendant)
        if result.returncode > 1:
            raise GitError(f"git merge-base failed: {result.stderr.strip()}")
        return result.returncode == 0

    def text_at(self, commit: str, path: str) -> str | None:
        """The file's text in that commit, or None when it is absent there."""
        result = self.run("show", f"{commit}:{path}")
        return result.stdout if result.returncode == 0 else None

    def verified_at(self, commit: str, path: str) -> datetime.date | None:
        """The note's `verified` in that commit, or None when the note or the key is absent there."""
        cache_key = (commit, path)
        if cache_key not in self.verified_cache:
            text = self.text_at(commit, path)
            frontmatter = parse_frontmatter(text) if text is not None else None
            self.verified_cache[cache_key] = as_date(frontmatter.get("verified")) if frontmatter else None
        return self.verified_cache[cache_key]

    def file_history(self, revision: str, path: str) -> list[tuple[str, str, str | None]]:
        """Commits from `git log --follow` that touch the file, merges left out, each as (sha, the file's path there,
        the path it was moved from in that commit or None)."""
        found = []
        sha = ""
        output = self.output("log", "--no-merges", "--follow", "--name-status", "--format=%x01%H", revision, "--", path)
        for line in output.splitlines():
            if line.startswith("\x01"):
                sha = line[1:]
            elif line:
                status, *paths = line.split("\t")
                moved_from = paths[0] if status.startswith("R") else None
                found.append((sha, paths[-1], moved_from))
        return found

    def commits(self, *args: str) -> list[tuple[str, datetime.date]]:
        """Commits from `git log`, merges left out, each as (sha, the committer's own date)."""
        found = []
        for line in self.output("log", "--no-merges", "--format=%H%x09%cs", *args).splitlines():
            sha, date = line.split("\t")
            found.append((sha, datetime.date.fromisoformat(date)))
        return found


def parse_table(lines: list[str], start: int) -> list[list[str]]:
    rows = []
    for line in lines[start:]:
        if not line.strip().startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not all(TABLE_SEPARATOR.fullmatch(cell) for cell in cells):
            rows.append(cells)
    return rows


def load_format(path: Path) -> Format:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise SetupError(f"{path}: cannot read the format: {error.strerror}") from error
    except UnicodeDecodeError as error:
        raise SetupError(f"{path}: cannot read the format: {error}") from error
    tables = {}
    for index, line in enumerate(lines):
        marker = TABLE_MARKER.match(line)
        if marker:
            tables[marker.group(1)] = parse_table(lines, index + 1)
    for name in (*VOCABULARY_TABLES, KEYS_TABLE):
        if len(tables.get(name, [])) < 2:
            raise SetupError(f"{path}: no table marked `<!-- table: {name} -->`")

    vocabularies = {}
    for name in VOCABULARY_TABLES:
        entries = set()
        for row in tables[name][1:]:
            entry = BACKTICKED.fullmatch(row[0])
            if not entry:
                raise SetupError(f"{path}: a row of the {name} table does not open with a `name` cell: {row[0]}")
            entries.add(entry.group(1))
        vocabularies[name] = frozenset(entries)
    return Format(vocabularies, load_key_sets(path, tables[KEYS_TABLE]))


def load_key_sets(path: Path, table: list[list[str]]) -> dict[str, KeySet]:
    header = table[0]
    columns = {tree: header.index(tree) for tree in TREES if tree in header}
    if len(columns) != len(TREES):
        raise SetupError(f"{path}: the keys table needs a column for each of {', '.join(TREES)}")
    required = defaultdict(set)
    allowed = defaultdict(set)
    for row in table[1:]:
        key = BACKTICKED.fullmatch(row[0])
        if not key:
            raise SetupError(f"{path}: a row of the keys table does not open with a `key` cell: {row[0]}")
        for tree, column in columns.items():
            cell = row[column] if column < len(row) else ""
            if cell == KEY_REQUIRED:
                required[tree].add(key.group(1))
            if cell in (KEY_REQUIRED, KEY_OPTIONAL):
                allowed[tree].add(key.group(1))
            elif cell != KEY_ABSENT:
                raise SetupError(
                    f"{path}: keys table cell `{cell}` for {key.group(1)} must be required, optional or no"
                )
    return {tree: KeySet(frozenset(required[tree]), frozenset(allowed[tree])) for tree in TREES}


def config_additions(path: Path, table: str, value: object) -> frozenset[str]:
    if not isinstance(value, dict):
        raise SetupError(f"{path}: [{table}] must be a table mapping each name to what it means")
    for name, meaning in value.items():
        if PLACEHOLDER.search(name) or (isinstance(meaning, str) and PLACEHOLDER.search(meaning)):
            raise SetupError(f"{path}: [{table}] still holds a template placeholder; replace or delete {name}")
        if not CONFIG_NAME.fullmatch(name):
            raise SetupError(f"{path}: [{table}] name `{name}` must be lowercase words joined by - or _")
        if not isinstance(meaning, str) or not meaning.strip():
            raise SetupError(f"{path}: [{table}] `{name}` needs a non-empty string saying what it means")
    return frozenset(value)


def load_config(root: Path, kb_format: Format) -> Config:
    vocabularies = dict(kb_format.vocabularies)
    path = root / CONFIG_FILE
    if not path.exists():
        return Config(TREES, **vocabularies)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise SetupError(f"{path}: cannot read it: {error}") from error

    unknown = sorted(set(data) - {"trees", *CONFIG_TABLES})
    if unknown:
        raise SetupError(f"{path}: unknown key {', '.join(unknown)}; it takes trees, {', '.join(CONFIG_TABLES)}")
    trees = data.get("trees", list(TREES))
    if not isinstance(trees, list) or not trees:
        raise SetupError(f"{path}: trees must be a non-empty list drawn from {', '.join(TREES)}")
    for tree in trees:
        if tree not in TREES:
            raise SetupError(f"{path}: unknown tree {tree!r}; the trees are {', '.join(TREES)}")
    for table in CONFIG_TABLES:
        vocabularies[table] = vocabularies[table] | config_additions(path, table, data.get(table, {}))
    return Config(tuple(trees), **vocabularies)


def frontmatter_end(lines: list[str]) -> int | None:
    """Index of the closing --- line, or None when the text opens no frontmatter or never closes it."""
    if not lines or lines[0].strip() != "---":
        return None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return index
    return None


def parse_frontmatter(text: str) -> dict | None:
    lines = text.splitlines()
    end = frontmatter_end(lines)
    if end is None:
        return None
    try:
        data = yaml.safe_load("\n".join(lines[1:end]))
    except (yaml.YAMLError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def as_date(value: object) -> datetime.date | None:
    if isinstance(value, datetime.datetime):
        return None
    if isinstance(value, datetime.date):
        return value
    if isinstance(value, str) and ISO_DATE.fullmatch(value):
        try:
            return datetime.date.fromisoformat(value)
        except ValueError:
            return None
    return None


def prose_lines(body: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Body lines outside fenced code, with inline code removed."""
    prose = []
    in_fence = False
    for number, text in body:
        if FENCE.match(text):
            in_fence = not in_fence
            continue
        if not in_fence:
            prose.append((number, CODE_SPAN.sub("", text)))
    return prose


def shown_path(path: Path, top: Path) -> str:
    try:
        return path.resolve().relative_to(top.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def read_note(path: Path, root: Path, top: Path, config: Config) -> tuple[Note | None, list[Problem]]:
    rel = path.relative_to(root)
    shown = shown_path(path, top)
    tree = rel.parts[0] if len(rel.parts) > 1 else ""
    if tree not in config.trees:
        trees = ", ".join(config.trees)
        message = f"outside the declared trees ({trees}); move it into one or declare its tree in {CONFIG_FILE}"
        return None, [Problem(Level.ERROR, shown, 1, message)]
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        return None, [Problem(Level.ERROR, shown, 1, f"cannot read it: {error}")]

    if not lines or lines[0].strip() != "---":
        return None, [
            Problem(Level.ERROR, shown, 1, "no frontmatter; open the file with a --- line, as the templates do")
        ]
    end = frontmatter_end(lines)
    if end is None:
        return None, [Problem(Level.ERROR, shown, 1, "frontmatter is never closed; end it with a --- line")]
    try:
        data = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as error:
        mark = getattr(error, "problem_mark", None)
        line = mark.line + 2 if mark else 1
        problem = getattr(error, "problem", None) or str(error)
        return None, [Problem(Level.ERROR, shown, line, f"frontmatter is not valid YAML: {problem}")]
    except ValueError as error:
        # PyYAML reads an impossible date such as 2026-13-01 as a timestamp and raises ValueError, not YAMLError.
        return None, [Problem(Level.ERROR, shown, 1, f"frontmatter holds a value YAML cannot read: {error}")]
    if not isinstance(data, dict):
        return None, [Problem(Level.ERROR, shown, 2, "frontmatter must be a mapping of keys to values")]

    frontmatter_lines = [(number + 1, lines[number]) for number in range(1, end)]
    key_lines = {}
    for number, text in frontmatter_lines:
        key = FRONTMATTER_KEY.match(text)
        if key:
            key_lines.setdefault(key.group(1), number)
    body = [(number + 1, lines[number]) for number in range(end + 1, len(lines))]
    return Note(path, rel, shown, tree, data, frontmatter_lines, key_lines, body, prose_lines(body)), []


def expected_permalink(note: Note) -> str:
    parts = note.rel.with_suffix("").parts
    if parts[0] == DOMAINS_TREE:
        parts = parts[1:]
    return "/".join(parts)


def is_inside_repository(source: str) -> bool:
    relative = Path(source)
    return not relative.is_absolute() and ".." not in relative.parts


def is_string_list(value: object) -> TypeGuard[list[str]]:
    if not isinstance(value, list) or not value:
        return False
    return all(isinstance(item, str) and item.strip() for item in value)


def check_sources(note: Note, top: Path) -> list[Problem]:
    sources = note.frontmatter["sources"]
    line = note.line_of("sources")
    if not is_string_list(sources):
        return [note.error(line, "`sources` must be a non-empty list of repository paths")]
    problems = []
    if "verified" not in note.frontmatter:
        problems.append(
            note.error(line, "`sources` without `verified` is invisible to staleness checks; add `verified`")
        )
    for source in sources:
        if not is_inside_repository(source):
            problems.append(
                note.error(line, f"source `{source}` must be a path inside the repository, relative to its top")
            )
        elif not (top / source).exists():
            message = (
                f"source `{source}` does not exist; list its new path, or re-check what rested on it if it was deleted"
            )
            problems.append(note.error(line, message))
    return problems


def check_verified(note: Note, latest: datetime.date) -> list[Problem]:
    value = note.frontmatter["verified"]
    line = note.line_of("verified")
    verified = as_date(value)
    if verified is None:
        return [note.error(line, f"`verified` must be an ISO date, YYYY-MM-DD, not {value!r}")]
    if verified > latest:
        return [note.error(line, f"`verified` {verified} is in the future; use the date the claims were checked")]
    return []


def check_frontmatter(note: Note, kb_format: Format, config: Config, top: Path, latest: datetime.date) -> list[Problem]:
    data = note.frontmatter
    keys = kb_format.keys[note.tree]
    present = {str(key) for key in data}
    required = set(BASE_KEYS) if note.is_research else set(keys.required)
    if "measured_on" in present:
        required.discard("sources")

    problems = []
    for key in sorted(required - present):
        problems.append(note.error(1, f"missing `{key}`; copy the frontmatter from the template for {note.tree}/"))
    if not note.is_research:
        for key in sorted(present - keys.allowed):
            problems.append(
                note.error(
                    note.line_of(key),
                    f"unknown key `{key}` for a {note.tree}/ note; the format's key table lists the keys",
                )
            )

    if "title" in data and note.title is None:
        problems.append(note.error(note.line_of("title"), "`title` must be a non-empty string"))
    if "type" in data and data["type"] != NOTE_TYPE:
        problems.append(note.error(note.line_of("type"), f"`type` must be `{NOTE_TYPE}`"))
    if "permalink" in data and data["permalink"] != expected_permalink(note):
        problems.append(
            note.error(
                note.line_of("permalink"), f"`permalink` must be `{expected_permalink(note)}`, from the file's path"
            )
        )
    if "tags" in data and not is_string_list(data["tags"]):
        problems.append(note.error(note.line_of("tags"), "`tags` must be a non-empty list of strings"))
    if note.is_research:
        return problems

    if "sources" in data:
        problems.extend(check_sources(note, top))
    if "verified" in data:
        problems.extend(check_verified(note, latest))
    measured_on = data.get("measured_on")
    if "measured_on" in data and not (isinstance(measured_on, str) and measured_on.strip()):
        problems.append(
            note.error(
                note.line_of("measured_on"), "`measured_on` must be a quoted string naming the tool and its version"
            )
        )
    if "coverage" in data and data["coverage"] not in config.coverage:
        problems.append(
            note.error(note.line_of("coverage"), f"`coverage` must be one of {', '.join(sorted(config.coverage))}")
        )
    if "status" in data and data["status"] not in config.statuses:
        problems.append(
            note.error(note.line_of("status"), f"`status` must be one of {', '.join(sorted(config.statuses))}")
        )
    return problems


def check_placeholders(note: Note) -> list[Problem]:
    problems = []
    for number, text in [*note.frontmatter_lines, *note.prose]:
        placeholder = PLACEHOLDER.search(text)
        if placeholder:
            problems.append(
                note.error(number, f"template placeholder {placeholder.group()} left in; replace it or delete the line")
            )
    return problems


def check_heading_and_scope(note: Note) -> list[Problem]:
    content = [index for index, (_, text) in enumerate(note.body) if text.strip()]
    if not content or not note.body[content[0]][1].startswith("# "):
        line = note.body[content[0]][0] if content else note.frontmatter_lines[-1][0] + 1
        return [note.error(line, "no H1; the first line after the frontmatter must be `# <title>`")]
    if note.tree not in DURABLE_TREES:
        return []

    h1_line = note.body[content[0]][0]
    if len(content) < 2 or not note.body[content[1]][1].lstrip().startswith(">"):
        return [
            note.error(
                h1_line,
                f"no Scope blockquote directly after the H1; add `> {SCOPE_OPENER}` naming what the note leaves out",
            )
        ]
    paragraph = []
    for _, text in note.body[content[1] :]:
        quoted = text.lstrip()
        if not quoted.startswith(">") or not quoted.lstrip(">").strip():
            break
        paragraph.append(quoted.lstrip(">").strip())
    scope = " ".join(paragraph)
    scope_line = note.body[content[1]][0]
    if not scope.startswith(SCOPE_OPENER):
        return [note.error(scope_line, f"the blockquote after the H1 must open with `{SCOPE_OPENER}`")]
    if len(scope.removeprefix(SCOPE_OPENER).split()) < MIN_SCOPE_WORDS:
        return [note.error(scope_line, "the Scope line is too short to say what was covered and what was not read")]
    return []


def check_observations(note: Note, config: Config) -> list[Problem]:
    problems = []
    for number, text in note.prose:
        observation = OBSERVATION.match(text)
        if not observation or observation.group(1) in TASK_BOXES:
            continue
        category = observation.group(1)
        if category not in config.categories:
            problems.append(
                note.error(number, f"unknown category [{category}]; use one from the format or add it to {CONFIG_FILE}")
            )
        for tag in INLINE_TAG.findall(text[observation.end() :]):
            if tag not in config.tags and not TICKET_TAG.fullmatch(tag):
                problems.append(
                    note.error(number, f"unknown tag #{tag}; use one from the format or add it to {CONFIG_FILE}")
                )
    return problems


def relations_items(note: Note) -> list[tuple[int, re.Match[str] | None]]:
    """The list items under `## Relations`, each with its match against the relation shape, or None."""
    items = []
    in_relations = False
    for number, text in note.prose:
        heading = HEADING.match(text)
        if heading and len(heading.group(1)) <= 2:
            in_relations = len(heading.group(1)) == 2 and heading.group(2).strip() == RELATIONS_HEADING
            continue
        if in_relations and LIST_ITEM.match(text):
            items.append((number, RELATION.match(text)))
    return items


def check_relation_types(note: Note, config: Config) -> list[Problem]:
    problems = []
    for number, relation in relations_items(note):
        if relation is None:
            problems.append(note.error(number, "a Relations item must read `- <type> [[Title]]`"))
        elif relation.group(1) not in config.relations:
            problems.append(
                note.error(number, f"unknown relation type `{relation.group(1)}`; the format lists the types")
            )
    return problems


def check_note(note: Note, kb_format: Format, config: Config, top: Path, latest: datetime.date) -> list[Problem]:
    problems = check_frontmatter(note, kb_format, config, top, latest)
    if note.is_research:
        return problems
    problems.extend(check_placeholders(note))
    problems.extend(check_heading_and_scope(note))
    problems.extend(check_observations(note, config))
    problems.extend(check_relation_types(note, config))
    return problems


def check_titles(notes: list[Note]) -> list[Problem]:
    problems = []
    first_by_title: dict[str, Note] = {}
    for note in notes:
        if note.title is None:
            continue
        first = first_by_title.setdefault(note.title.casefold(), note)
        if first is not note:
            problems.append(
                note.error(
                    note.line_of("title"),
                    f"title `{note.title}` is also {first.shown}'s; links resolve by title, so titles are unique",
                )
            )
    return problems


def check_projects(notes: list[Note]) -> list[Problem]:
    problems = []
    for note in notes:
        if note.tree != PROJECTS_TREE or note.rel.parts[2:] != ("overview.md",):
            continue
        status = note.frontmatter.get("status")
        folder = note.path.parent
        if status in STARTED_STATUSES and not (folder / "decisions.md").is_file():
            problems.append(
                note.error(note.line_of("status"), f"a project in `{status}` needs decisions.md beside its overview")
            )
        if status == CHECKLIST_STATUS and not (folder / "checklist.md").is_file():
            problems.append(
                note.error(note.line_of("status"), f"a project in `{status}` needs checklist.md beside its overview")
            )
    return problems


def readme_title(root: Path) -> str | None:
    try:
        frontmatter = parse_frontmatter((root / README).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return None
    title = frontmatter.get("title") if frontmatter else None
    return title.strip() if isinstance(title, str) and title.strip() else None


def check_links(notes: list[Note], config: Config, readme: str | None) -> list[Problem]:
    notes_by_name: dict[str, Note] = {}
    for note in notes:
        notes_by_name[expected_permalink(note).casefold()] = note
        if note.title is not None:
            notes_by_name.setdefault(note.title.casefold(), note)
    link_names = set(notes_by_name)
    if readme is not None:
        link_names.add(readme.casefold())

    problems = []
    outgoing: dict[Path, set[Path]] = defaultdict(set)
    relations: list[tuple[Note, int, Note]] = []
    for note in notes:
        for number, text in note.prose:
            for target in WIKILINK.findall(text):
                if target.strip().casefold() not in link_names:
                    problems.append(
                        note.warn(
                            number,
                            f"[[{target}]] matches no note's title or permalink; write that note or fix the link",
                        )
                    )
        for number, relation in relations_items(note):
            if relation is None or relation.group(1) not in config.relations:
                continue
            target = notes_by_name.get(relation.group(2).strip().casefold())
            if target is not None:
                outgoing[note.path].add(target.path)
                relations.append((note, number, target))

    for note, number, target in relations:
        if note.tree == PROJECTS_TREE and target.tree == DOMAINS_TREE:
            continue
        if note.path not in outgoing[target.path]:
            problems.append(note.warn(number, f"one-way relation: {target.shown} has no relation back to this note"))
    return problems


def note_sources(note: Note, top: Path) -> list[str]:
    """The note's listed sources that exist, for the staleness checks; the others are already errors."""
    sources = note.frontmatter.get("sources")
    if not is_string_list(sources):
        return []
    return [source for source in sources if is_inside_repository(source) and (top / source).exists()]


def without_permalink(text: str | None) -> list[str]:
    if text is None:
        return []
    return [line for line in text.splitlines() if not line.startswith("permalink:")]


def is_only_moved(git: Git, sha: str, moved_from: str, path_there: str) -> bool:
    """Whether the commit moved the note without changing its text beyond the `permalink` a move has to rewrite."""
    return without_permalink(git.text_at(f"{sha}^", moved_from)) == without_permalink(git.text_at(sha, path_there))


def note_edits(git: Git, path: str, revision: str) -> list[tuple[str, datetime.date]]:
    """Commits that edit the note under its current or any earlier path and leave a `verified`, each with that date."""
    edits = []
    for sha, path_there, moved_from in git.file_history(revision, path):
        if moved_from and is_only_moved(git, sha, moved_from, path_there):
            continue
        verified = git.verified_at(sha, path_there)
        if verified is not None:
            edits.append((sha, verified))
    return edits


def is_reverified(git: Git, change: str, date: datetime.date, edits: list[tuple[str, datetime.date]]) -> bool:
    """Whether the change itself, or a commit descending from it, edits the note leaving `verified` on or after date."""
    return any(verified >= date and git.is_ancestor(change, edit) for edit, verified in edits)


def find_stale(git: Git, path: str, sources: list[str], verified: datetime.date) -> str | None:
    edits = note_edits(git, path, "HEAD")
    later = []
    for sha, date in git.commits("HEAD", "--", *sources):
        if date > verified and not is_reverified(git, sha, date, edits):
            later.append(sha)
    if not later:
        return None
    newest = later[0][:12]
    return f"{len(later)} commit(s) changed its sources after `verified` {verified}, newest {newest}; re-verify"


def find_ungated(git: Git, path: str, sources: list[str], _verified: datetime.date, span: str) -> str | None:
    edits = note_edits(git, path, span)
    uncovered = []
    for sha, date in git.commits(span, "--", *sources):
        if not is_reverified(git, sha, date, edits):
            uncovered.append(sha)
    if not uncovered:
        return None
    oldest = uncovered[-1][:12]
    return (
        f"{len(uncovered)} commit(s) in the range, oldest {oldest}, change its sources and no commit after them edits "
        "the note with `verified` on or after their date; re-read the sources, then commit the note"
    )


def split_tracked(git: Git, sources: list[str]) -> tuple[list[str], list[str]]:
    tracked = []
    untracked = []
    for source in sources:
        if git.is_tracked(source):
            tracked.append(source)
        else:
            untracked.append(source)
    return tracked, untracked


def staleness(note: Note, git: Git | None, top: Path, level: Level, find: Callable[..., str | None]) -> list[Problem]:
    """Runs one staleness finder over a note with `verified` and sources, reporting UNKNOWN at the same level."""
    verified = as_date(note.frontmatter.get("verified"))
    sources = note_sources(note, top)
    if verified is None or not sources:
        return []
    line = note.line_of("verified")
    report = note.error if level == Level.ERROR else note.warn
    if git is None:
        return [report(line, "UNKNOWN staleness: the root is not in a git repository")]
    try:
        tracked, untracked = split_tracked(git, sources)
        problems = [report(line, f"UNKNOWN staleness: git does not track source `{source}`") for source in untracked]
        finding = find(git, shown_path(note.path, top), tracked, verified) if tracked else None
    except GitError as error:
        return [report(line, f"UNKNOWN staleness: {error}")]
    if finding:
        problems.append(report(line, finding))
    return problems


def parse_range(value: str) -> tuple[str, str]:
    ends = value.split("..")
    if len(ends) != 2 or not all(ends) or ends[1].startswith("."):
        raise argparse.ArgumentTypeError(f"{value!r} is not a two-dot range A..B")
    return ends[0], ends[1]


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--root", type=Path, default=DEFAULT_ROOT, help="the knowledge base (default: .claude/reference)"
    )
    parser.add_argument("--warnings", action="store_true", help="list warnings as well as counting them")
    parser.add_argument(
        "--stale", action="store_true", help="warn about sources changed since `verified`; lists warnings"
    )
    parser.add_argument(
        "--stale-in", type=parse_range, metavar="A..B", help="the merge gate over the commits in A..B; implies --stale"
    )
    return parser.parse_args(argv)


def git_top(root: Path) -> Path | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return Path(result.stdout.strip()) if result.returncode == 0 else None


def resolve_range(git: Git | None, ends: tuple[str, str]) -> tuple[str, str]:
    if git is None:
        raise SetupError("--stale-in needs the root to be inside a git repository")
    resolved = []
    for end in ends:
        try:
            resolved.append(git.output("rev-parse", "--verify", "--quiet", f"{end}^{{commit}}").strip())
        except GitError as error:
            raise SetupError(f"--stale-in: {end} does not name a commit") from error
    return resolved[0], resolved[1]


def validate(args: argparse.Namespace) -> tuple[int, list[Problem]]:
    root = args.root
    if not root.is_dir():
        raise SetupError(f"{root}: no such directory; pass the knowledge base with --root")
    kb_format = load_format(FORMAT_FILE)
    config = load_config(root, kb_format)
    found_top = git_top(root)
    top = found_top or Path.cwd()
    git = Git(found_top) if found_top else None
    span = resolve_range(git, args.stale_in) if args.stale_in else None

    paths = []
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if rel == README or any(part.startswith("_") for part in rel.parts) or not path.is_file():
            continue
        paths.append(path)
    if not paths:
        raise SetupError(f"{root}: holds no notes, so there is nothing to check; is --root right?")

    latest = datetime.datetime.now(datetime.UTC).date() + FUTURE_GRACE
    notes = []
    problems = []
    for path in paths:
        note, found = read_note(path, root, top, config)
        problems.extend(found)
        if note is not None:
            notes.append(note)
            problems.extend(check_note(note, kb_format, config, top, latest))
    problems.extend(check_titles(notes))
    problems.extend(check_projects(notes))
    problems.extend(check_links(notes, config, readme_title(root)))
    if args.stale or span:
        for note in notes:
            problems.extend(staleness(note, git, top, Level.WARN, find_stale))
    if span:
        find = partial(find_ungated, span=f"{span[0]}..{span[1]}")
        for note in notes:
            problems.extend(staleness(note, git, top, Level.ERROR, find))
    return len(paths), problems


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        note_count, problems = validate(args)
    except SetupError as error:
        print(f"ERROR {error}")
        return 2

    errors = [problem for problem in problems if problem.level == Level.ERROR]
    warnings = [problem for problem in problems if problem.level == Level.WARN]
    list_warnings = args.warnings or args.stale or args.stale_in is not None
    listed = problems if list_warnings else errors
    for problem in sorted(listed, key=lambda problem: (problem.path, problem.line)):
        print(problem)

    summary = f"{note_count} notes, {len(errors)} errors, {len(warnings)} warnings"
    if warnings and not list_warnings:
        summary += " (--warnings lists them)"
    print(summary)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
