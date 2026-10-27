"""validate.py run as a subprocess over a knowledge base built from the shipped templates in a temporary git repo."""

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "validate.py"
TEMPLATES = Path(__file__).resolve().parent.parent / "templates"
VERIFIED = "2026-01-01"
SCOPE = "This note covers the example module"
TEMPLATE_SCOPE = "REPLACE THIS SENTENCE with what *this* note covers"
CHECKLIST_COMMENT = re.compile(r"<!--.*?-->\n?", re.DOTALL)
# validate.py runs git too, so both it and the fixture git calls get this environment.
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def git(repo: Path, *args: str, date: str | None = None) -> str:
    identity = ["-c", "user.name=Example", "-c", "user.email=example@example.com"]
    env = dict(GIT_ENV)
    if date is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"{date}T12:00:00"
    result = subprocess.run(
        ["git", "-C", str(repo), *identity, *args], capture_output=True, text=True, check=True, env=env
    )
    return result.stdout.strip()


def fill(template: str, values: dict[str, str]) -> str:
    """The template with its checklist comment deleted and each placeholder replaced, as a writer would leave it."""
    text = CHECKLIST_COMMENT.sub("", (TEMPLATES / template).read_text(encoding="utf-8"))
    for placeholder, value in values.items():
        text = text.replace(placeholder, value)
    return text


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def domain_note(title: str = "Example Topic") -> str:
    return fill(
        "domain.md",
        {
            "Human Readable Name": title,
            "area/slug": "example/topic",
            "YYYY-MM-DD": VERIFIED,
            "the-branch-you-read-the-code-on": "main",
            "path/to/the-file-this-note-is-about.ext": "src/example.py",
            "path/to/the-other-one-you-actually-read.ext": "src/other.py",
            TEMPLATE_SCOPE: SCOPE,
            "Parent Hub Note": "Example Gizmo",
            "Some Other Note": "Example Project",
        },
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    write(repo / "src" / "example.py", "VALUE = 1\n")
    write(repo / "src" / "other.py", "OTHER = 2\n")
    (repo / ".claude" / "reference").mkdir(parents=True)
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "Example sources", date=VERIFIED)
    return repo


def kb(repo: Path) -> Path:
    return repo / ".claude" / "reference"


def validate(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(SCRIPT), "--root", str(kb(repo)), *args]
    return subprocess.run(command, cwd=repo, env=GIT_ENV, capture_output=True, text=True, check=False)


def write_full_kb(repo: Path) -> None:
    write(kb(repo) / "domains" / "example" / "topic.md", domain_note())
    entity = {
        "Human Readable Name": "Example Gizmo",
        "area/slug": "widgets/gizmo",
        "YYYY-MM-DD": VERIFIED,
        "the-branch-you-read-the-code-on": "main",
        "path/to/the-definition-that-implements-this.ext": "src/example.py",
        "stable-external-identifier": "gizmo-1",
        TEMPLATE_SCOPE: SCOPE,
        "Parent Hub Note": "Example Topic",
        "Some Other Note": "Example Topic",
    }
    write(kb(repo) / "entities" / "widgets" / "gizmo.md", fill("entity.md", entity))
    project = {
        "<Project Name>": "Example Project",
        "<slug>": "example",
        "YYYY-MM-DD": VERIFIED,
        "Some Other Note": "Example Topic",
    }
    for document in ("overview", "checklist", "decisions"):
        write(kb(repo) / "projects" / "example" / f"{document}.md", fill(f"project-{document}.md", project))


def test_notes_filled_in_from_every_template_validate(repo: Path) -> None:
    write_full_kb(repo)

    result = validate(repo)

    assert result.returncode == 0, result.stdout
    assert "5 notes, 0 errors" in result.stdout


def test_an_unedited_copy_of_each_template_fails_on_its_placeholders(repo: Path) -> None:
    copies = {
        "domain.md": "domains/area/slug.md",
        "entity.md": "entities/area/slug.md",
        "project-overview.md": "projects/slug/overview.md",
        "project-checklist.md": "projects/slug/checklist.md",
        "project-decisions.md": "projects/slug/decisions.md",
    }
    for template, destination in copies.items():
        write(kb(repo) / destination, (TEMPLATES / template).read_text(encoding="utf-8"))

    result = validate(repo)

    assert result.returncode == 1
    for destination in copies.values():
        assert re.search(rf"ERROR \S*{re.escape(destination)}:\d+: leftover template placeholder", result.stdout)
    # Every copy also has placeholders in its frontmatter, so only this line shows the body is checked.
    domain_lines = (TEMPLATES / "domain.md").read_text(encoding="utf-8").splitlines()
    scope_line = next(number for number, line in enumerate(domain_lines, start=1) if TEMPLATE_SCOPE in line)
    assert f"domains/area/slug.md:{scope_line}: leftover template placeholder 'REPLACE THIS'" in result.stdout


def test_an_unknown_frontmatter_key_fails(repo: Path) -> None:
    note = domain_note().replace("coverage: partial\n", "coverage: partial\nowner: someone\n")
    write(kb(repo) / "domains" / "example" / "topic.md", note)

    result = validate(repo)

    assert result.returncode == 1
    assert "unknown key 'owner'" in result.stdout


def test_kb_toml_adds_categories_and_tags(repo: Path) -> None:
    observation = "- [vendor] Example CLI reports the wrong exit status #flaky-exit\n\n## Relations"
    write(kb(repo) / "domains" / "example" / "topic.md", domain_note().replace("## Relations", observation))

    undeclared = validate(repo)
    config = '[categories]\nvendor = "From vendor docs."\n\n[tags]\nflaky-exit = "Exit codes lie."\n'
    write(kb(repo) / "kb.toml", config)
    declared = validate(repo)

    assert undeclared.returncode == 1
    assert "unknown category '[vendor]'" in undeclared.stdout
    assert "unknown inline tag '#flaky-exit'" in undeclared.stdout
    assert declared.returncode == 0, declared.stdout


def test_measured_on_stands_in_for_sources(repo: Path) -> None:
    sources = "sources:\n  - src/example.py\n  - src/other.py\n"
    measured = domain_note().replace(sources, 'measured_on: "Example CLI 2.1.0"\n')
    write(kb(repo) / "domains" / "example" / "topic.md", measured)
    with_measured_on = validate(repo)
    write(kb(repo) / "domains" / "example" / "topic.md", domain_note().replace(sources, ""))
    with_neither = validate(repo)

    assert with_measured_on.returncode == 0, with_measured_on.stdout
    assert with_neither.returncode == 1
    assert "missing required key 'sources'" in with_neither.stdout


def test_a_note_outside_the_declared_trees_fails(repo: Path) -> None:
    write_full_kb(repo)
    write(kb(repo) / "kb.toml", 'trees = ["domains", "entities"]\n')

    result = validate(repo)

    assert result.returncode == 1
    outside = re.findall(r"^ERROR \S*?reference/(\S+):1: outside the trees", result.stdout, re.MULTILINE)
    assert sorted(outside) == [f"projects/example/{name}.md" for name in ("checklist", "decisions", "overview")]


def test_a_started_project_without_its_decisions_fails(repo: Path) -> None:
    write_full_kb(repo)
    (kb(repo) / "projects" / "example" / "decisions.md").unlink()

    result = validate(repo)

    assert result.returncode == 1
    assert "status is research but decisions.md is missing" in result.stdout


def test_an_unknown_kb_toml_key_stops_with_exit_2(repo: Path) -> None:
    write(kb(repo) / "kb.toml", 'tree = ["domains"]\n')

    result = validate(repo)

    assert result.returncode == 2
    assert "unknown key tree" in result.stderr


def test_stale_in_fails_until_the_note_is_reverified(repo: Path) -> None:
    write(kb(repo) / "domains" / "example" / "topic.md", domain_note())
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "Example note", date=VERIFIED)
    base = git(repo, "rev-parse", "HEAD")
    write(repo / "src" / "example.py", "VALUE = 3\n")
    # Every later commit is dated after the new `verified`, as a rebase leaves them, so only commit order passes it.
    git(repo, "commit", "-q", "-am", "Example change", date="2026-01-10")
    note = kb(repo) / "domains" / "example" / "topic.md"
    # Editing the note without moving its `verified:` line is not a re-verify.
    note.write_text(note.read_text(encoding="utf-8") + "\nA later paragraph.\n", encoding="utf-8")
    git(repo, "commit", "-q", "-am", "Example edit", date="2026-01-10")

    stale = validate(repo, "--stale-in", f"{base}..HEAD")
    note.write_text(note.read_text(encoding="utf-8").replace(VERIFIED, "2026-01-05"), encoding="utf-8")
    git(repo, "commit", "-q", "-am", "Example re-verify", date="2026-01-10")
    reverified = validate(repo, "--stale-in", f"{base}..HEAD")

    assert stale.returncode == 1
    assert "changes its sources after verified=2026-01-01" in stale.stdout
    assert reverified.returncode == 0, reverified.stdout


def test_stale_in_fails_on_an_untracked_source(repo: Path) -> None:
    write(repo / "src" / "new.py", "NEW = 4\n")
    note = domain_note().replace("src/other.py", "src/new.py")
    write(kb(repo) / "domains" / "example" / "topic.md", note)
    git(repo, "add", str(kb(repo)))
    git(repo, "commit", "-q", "-m", "Example note", date=VERIFIED)

    result = validate(repo, "--stale-in", "HEAD~1..HEAD")

    assert result.returncode == 1
    assert "staleness is UNKNOWN for untracked sources" in result.stdout
