"""validate.py run as a subprocess over a synthetic knowledge base in a temporary git repository.

Needs pytest and PyYAML.
"""

import datetime
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
from validate import PLACEHOLDER

SCRIPTS = Path(__file__).resolve().parent
VALIDATOR = SCRIPTS / "validate.py"
TEMPLATES = SCRIPTS.parent / "templates"
ROOT = Path(".claude") / "reference"
CHECKLIST_COMMENT = re.compile(r"<!--.*?-->\n\n", re.DOTALL)
SOURCE_PLACEHOLDER = re.compile(r'^  - "\{\{.*\}\}"$', re.MULTILINE)
FILLER = "an example phrase standing in for real text"
VERIFIED = "2026-01-10"
SCOPE = "> **Scope.** The example file was read in full. Not covered: anything outside the example directory.\n"
# The test's own git calls get this too: a machine's commit.gpgsign or core.hooksPath would otherwise reach them.
GIT_ISOLATION = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


@dataclass(frozen=True)
class Repo:
    path: Path

    def write(self, rel: str, text: str) -> None:
        target = self.path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def write_note(self, rel: str, text: str) -> None:
        self.write(f"{ROOT}/{rel}", text)

    def git(self, *args: str, date: str | None = None) -> str:
        env = {**os.environ, **GIT_ISOLATION}
        if date:
            env |= {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
        identity = ["-c", "user.name=Example", "-c", "user.email=example@example.com"]
        command = ["git", "-C", str(self.path), *identity, *args]
        return subprocess.run(command, env=env, capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, date: str) -> str:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "Example change", date=date)
        return self.git("rev-parse", "HEAD")

    def validate(self, *args: str) -> subprocess.CompletedProcess[str]:
        command = [sys.executable, str(VALIDATOR), "--root", str(ROOT), *args]
        env = {**os.environ, **GIT_ISOLATION}
        return subprocess.run(command, cwd=self.path, env=env, capture_output=True, text=True, check=False)


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    made = Repo(tmp_path / "repo")
    made.path.mkdir()
    made.git("init", "-q", "-b", "main")
    made.write("src/example.txt", "one\n")
    return made


def domain_note(frontmatter: str, observations: str = "- [fact] The example file holds one line.\n") -> str:
    return f"""---
title: Example Topic
type: note
permalink: example/topic
tags: [example]
coverage: partial
{frontmatter}---

# Example Topic

{SCOPE}
Read this before changing the example file.

## Observations

{observations}"""


SOURCED = f"verified: {VERIFIED}\nsources:\n  - src/example.txt\n"


def fill(template: str, **frontmatter: str) -> str:
    """The template with its checklist deleted, the given keys set, its source listed and every placeholder filled."""
    text = CHECKLIST_COMMENT.sub("", (TEMPLATES / template).read_text())
    for key, value in frontmatter.items():
        text = re.sub(rf"^{key}: .*$", f"{key}: {value}", text, count=1, flags=re.MULTILINE)
    text = SOURCE_PLACEHOLDER.sub("  - src/example.txt", text)
    return PLACEHOLDER.sub(FILLER, text)


def test_notes_filled_from_every_template_pass(repo: Repo) -> None:
    dated = {"verified": VERIFIED}
    repo.write_note(
        "domains/example/overview.md", fill("domain.md", title="Example Area", permalink="example/overview", **dated)
    )
    repo.write_note(
        "entities/example/item.md", fill("entity.md", title="Example Item", permalink="entities/example/item", **dated)
    )
    project = {"tags": "[example]"}
    repo.write_note(
        "projects/example/overview.md",
        fill(
            "project-overview.md",
            title="Example Project",
            permalink="projects/example/overview",
            status="implementation",
            opened=VERIFIED,
            **project,
        ),
    )
    repo.write_note(
        "projects/example/checklist.md",
        fill("project-checklist.md", title="Example Checklist", permalink="projects/example/checklist", **project),
    )
    repo.write_note(
        "projects/example/decisions.md",
        fill("project-decisions.md", title="Example Decisions", permalink="projects/example/decisions", **project),
    )
    config = (TEMPLATES / "kb.toml").read_text().replace('"{{name}}"', "example")
    repo.write_note("kb.toml", PLACEHOLDER.sub(FILLER, config))

    result = repo.validate()

    assert result.returncode == 0, result.stdout
    assert "5 notes, 0 errors" in result.stdout


@pytest.mark.parametrize(
    ("template", "rel"),
    [
        ("domain.md", "domains/example/topic.md"),
        ("entity.md", "entities/example/item.md"),
        ("project-overview.md", "projects/example/overview.md"),
        ("project-checklist.md", "projects/example/checklist.md"),
        ("project-decisions.md", "projects/example/decisions.md"),
    ],
)
def test_an_unedited_template_fails_on_placeholders_in_frontmatter_and_body(
    repo: Repo, template: str, rel: str
) -> None:
    text = (TEMPLATES / template).read_text()
    frontmatter_end = text.splitlines().index("---", 1) + 1
    repo.write_note(rel, text)

    result = repo.validate()

    shown = re.escape(f"{ROOT.as_posix()}/{rel}")
    lines = [
        int(line) for line in re.findall(rf"^ERROR {shown}:(\d+): template placeholder", result.stdout, re.MULTILINE)
    ]
    assert result.returncode == 1
    assert any(line <= frontmatter_end for line in lines), result.stdout
    assert any(line > frontmatter_end for line in lines), result.stdout


def test_an_unknown_frontmatter_key_fails(repo: Repo) -> None:
    repo.write_note("domains/example/topic.md", domain_note(SOURCED + "owner: example\n"))

    result = repo.validate()

    assert result.returncode == 1
    assert "unknown key `owner`" in result.stdout


def test_config_additions_make_an_unknown_category_and_tag_pass(repo: Repo) -> None:
    repo.write_note("domains/example/topic.md", domain_note(SOURCED, "- [vendor] The manual says so. #hardware\n"))

    without = repo.validate()
    repo.write_note(
        "kb.toml",
        '[categories]\nvendor = "From the manual, not measured."\n\n[tags]\nhardware = "Needs the device."\n',
    )
    with_config = repo.validate()

    assert without.returncode == 1
    assert "unknown category [vendor]" in without.stdout
    assert "unknown tag #hardware" in without.stdout
    assert with_config.returncode == 0, with_config.stdout


@pytest.mark.parametrize(
    ("frontmatter", "status"),
    [
        (f'verified: {VERIFIED}\nmeasured_on: "ExampleTool 1.0"\n', 0),
        (f'measured_on: "ExampleTool 1.0"\n{SOURCED}', 0),
        (f"verified: {VERIFIED}\n", 1),
    ],
    ids=["measured_on alone", "both", "neither"],
)
def test_measured_on_stands_in_for_sources(repo: Repo, frontmatter: str, status: int) -> None:
    repo.write_note("domains/example/topic.md", domain_note(frontmatter))

    result = repo.validate()

    assert result.returncode == status, result.stdout


def test_a_note_outside_the_declared_trees_fails(repo: Repo) -> None:
    repo.write_note("kb.toml", 'trees = ["domains"]\n')
    repo.write_note("domains/example/topic.md", domain_note(SOURCED))
    repo.write_note("entities/example/item.md", "Any text.\n")

    result = repo.validate()

    assert result.returncode == 1
    assert "entities/example/item.md:1: outside the declared trees (domains)" in result.stdout


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        ("# Example Topic\n\n", "", "no H1"),
        (SCOPE, "", "no Scope blockquote"),
        ("**Scope.**", "**Covers.**", "must open with `**Scope.**`"),
        (SCOPE, "> **Scope.** The example file.\n", "too short"),
        ("## Observations", "## Relations\n\n- mentions [[Example Topic]]\n\n## Observations", "unknown relation type"),
        ("## Observations", "## Relations\n\n- see also [[Example Topic]]\n\n## Observations", "must read `- <type>"),
    ],
    ids=["no H1", "no Scope", "Scope opener", "short Scope", "relation type", "relation shape"],
)
def test_a_malformed_body_fails(repo: Repo, old: str, new: str, message: str) -> None:
    repo.write_note("domains/example/topic.md", domain_note(SOURCED).replace(old, new))

    result = repo.validate()

    assert result.returncode == 1
    assert message in result.stdout


def test_dangling_links_and_one_way_relations_warn_without_failing(repo: Repo) -> None:
    linking = domain_note(SOURCED) + "\n## Relations\n\n- see_also [[Example Other]]\n- see_also [[Example Missing]]\n"
    repo.write_note("domains/example/topic.md", linking)
    other = domain_note(SOURCED).replace("Example Topic", "Example Other").replace("example/topic", "example/other")
    repo.write_note("domains/example/other.md", other)

    result = repo.validate("--warnings")

    assert result.returncode == 0, result.stdout
    assert "[[Example Missing]] matches no note" in result.stdout
    assert "one-way relation: .claude/reference/domains/example/other.md has no relation back" in result.stdout


def test_a_started_project_without_decisions_fails(repo: Repo) -> None:
    overview = "---\ntitle: Example Project\ntype: note\npermalink: projects/example/overview\ntags: [example]\n"
    repo.write_note("projects/example/overview.md", overview + "status: research\n---\n\n# Example Project\n")

    without = repo.validate()
    decisions = "---\ntitle: Example Decisions\ntype: note\npermalink: projects/example/decisions\ntags: [example]\n"
    repo.write_note("projects/example/decisions.md", decisions + "---\n\n# Example Decisions\n")
    with_decisions = repo.validate()

    assert without.returncode == 1
    assert "needs decisions.md" in without.stdout
    assert with_decisions.returncode == 0, with_decisions.stdout


@pytest.mark.parametrize(
    "config",
    [
        'colour = "red"\n',
        'trees = ["domains", "examples"]\n',
        "trees = []\n",
        '[tags]\n"Not An Identifier" = "Spaces and capitals."\n',
        '[tags]\nexample = ""\n',
        'tags = "not a table"\n',
        "trees = [\n",
        (TEMPLATES / "kb.toml").read_text(),
    ],
    ids=["unknown key", "unknown tree", "no trees", "bad name", "empty meaning", "not a table", "not TOML", "template"],
)
def test_a_bad_config_exits_2(repo: Repo, config: str) -> None:
    repo.write_note("domains/example/topic.md", domain_note(SOURCED))
    repo.write_note("kb.toml", config)

    result = repo.validate()

    assert result.returncode == 2, result.stdout
    assert "kb.toml" in result.stdout


def test_a_root_with_no_notes_exits_2(repo: Repo) -> None:
    repo.write_note("README.md", "# Example knowledge base\n")

    result = repo.validate()

    assert result.returncode == 2
    assert "holds no notes" in result.stdout


@pytest.mark.parametrize(("days_ahead", "status"), [(1, 0), (2, 1)])
def test_verified_may_be_at_most_one_day_past_utc_today(repo: Repo, days_ahead: int, status: int) -> None:
    ahead = datetime.datetime.now(datetime.UTC).date() + datetime.timedelta(days=days_ahead)
    repo.write_note("domains/example/topic.md", domain_note(f"verified: {ahead}\nsources:\n  - src/example.txt\n"))

    result = repo.validate()

    assert result.returncode == status, result.stdout


def committed_note(repo: Repo, date: str) -> str:
    repo.write_note("domains/example/topic.md", domain_note(SOURCED))
    return repo.commit(date)


def test_the_gate_fails_until_a_commit_after_the_source_change_moves_verified_forward(repo: Repo) -> None:
    base = committed_note(repo, "2026-01-10T12:00:00+00:00")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED.replace(VERIFIED, "2026-01-11")))
    repo.commit("2026-01-11T12:00:00+00:00")
    repo.write("src/example.txt", "two\n")
    repo.commit("2026-01-12T12:00:00+00:00")

    before = repo.validate("--stale-in", f"{base}..HEAD")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED.replace(VERIFIED, "2026-01-12")))
    repo.commit("2026-01-12T13:00:00+00:00")
    after = repo.validate("--stale-in", f"{base}..HEAD")

    assert before.returncode == 1
    assert "change its sources and no commit after them moves `verified` later" in before.stdout
    assert after.returncode == 0, after.stdout


def test_a_source_change_the_same_day_as_verified_fails_the_gate_but_not_stale(repo: Repo) -> None:
    base = committed_note(repo, "2026-01-10T09:00:00+00:00")
    repo.write("src/example.txt", "two\n")
    repo.commit("2026-01-10T15:00:00+00:00")

    gate = repo.validate("--stale-in", f"{base}..HEAD")
    stale = repo.validate("--stale")

    assert gate.returncode == 1, gate.stdout
    assert "0 warnings" in stale.stdout


def test_the_gate_fails_a_source_change_merged_in_after_the_reverify(repo: Repo) -> None:
    base = committed_note(repo, "2026-01-10T12:00:00+00:00")
    repo.git("switch", "-q", "-c", "other")
    repo.write("src/example.txt", "two\n")
    repo.commit("2026-01-11T12:00:00+00:00")
    repo.git("switch", "-q", "main")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED.replace(VERIFIED, "2026-01-12")))
    repo.commit("2026-01-12T12:00:00+00:00")
    repo.git("merge", "-q", "--no-ff", "-m", "Merge the source change", "other", date="2026-01-13T12:00:00+00:00")

    result = repo.validate("--stale-in", f"{base}..HEAD")

    assert result.returncode == 1, result.stdout


@pytest.mark.parametrize(
    "verified_line",
    [f'verified: "{VERIFIED}"', f"verified:  {VERIFIED}  ", "verified: 2026-01-09"],
    ids=["re-quoted", "whitespace", "earlier"],
)
def test_the_gate_does_not_count_a_verified_that_did_not_move_later(repo: Repo, verified_line: str) -> None:
    base = committed_note(repo, "2026-01-10T12:00:00+00:00")
    repo.write("src/example.txt", "two\n")
    repo.commit("2026-01-12T12:00:00+00:00")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED.replace(f"verified: {VERIFIED}", verified_line)))
    repo.commit("2026-01-12T13:00:00+00:00")

    result = repo.validate("--stale-in", f"{base}..HEAD")

    assert result.returncode == 1, result.stdout


def test_the_gate_fails_an_untracked_source_as_unknown(repo: Repo) -> None:
    base = committed_note(repo, "2026-01-10T12:00:00+00:00")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED + "  - src/untracked.txt\n"))
    repo.commit("2026-01-10T13:00:00+00:00")
    repo.write("src/untracked.txt", "never added\n")

    result = repo.validate("--stale-in", f"{base}..HEAD")

    assert result.returncode == 1
    assert "UNKNOWN staleness: git does not track source `src/untracked.txt`" in result.stdout


def test_the_gate_passes_staleness_from_before_the_range_that_stale_still_reports(repo: Repo) -> None:
    committed_note(repo, "2026-01-10T12:00:00+00:00")
    repo.write("src/example.txt", "two\n")
    base = repo.commit("2026-01-12T12:00:00+00:00")
    repo.write("src/other.txt", "unrelated\n")
    repo.commit("2026-01-13T12:00:00+00:00")

    gate = repo.validate("--stale-in", f"{base}..HEAD")

    assert gate.returncode == 0, gate.stdout
    assert "1 commit(s) changed its sources after `verified` 2026-01-10" in gate.stdout


def test_stale_counts_a_source_change_followed_by_a_reverify_as_covered_whatever_its_date(repo: Repo) -> None:
    committed_note(repo, "2026-01-10T12:00:00+00:00")
    repo.write("src/example.txt", "two\n")
    # 11:00 UTC on 2026-01-11, dated the 12th by a committer at +14:00.
    repo.commit("2026-01-12T01:00:00+14:00")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED.replace(VERIFIED, "2026-01-11")))
    # 22:00 UTC on 2026-01-11, after the source change, by a committer at -10:00.
    repo.commit("2026-01-11T12:00:00-10:00")

    result = repo.validate("--stale")

    assert result.returncode == 0, result.stdout
    assert "0 warnings" in result.stdout


def test_a_copy_of_the_skill_without_its_format_exits_2(tmp_path: Path, repo: Repo) -> None:
    scripts = tmp_path / "skill" / "scripts"
    scripts.mkdir(parents=True)
    shutil.copy2(VALIDATOR, scripts / "validate.py")
    repo.write_note("domains/example/topic.md", domain_note(SOURCED))

    command = [sys.executable, str(scripts / "validate.py"), "--root", str(ROOT)]
    result = subprocess.run(command, cwd=repo.path, capture_output=True, text=True, check=False)

    assert result.returncode == 2
    assert "cannot read the format" in result.stdout
