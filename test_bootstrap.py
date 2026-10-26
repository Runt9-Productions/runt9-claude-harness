"""bootstrap.py run as a subprocess from a synthetic clone, with HOME in a temp dir and a stub claude on PATH.

Needs pytest.
"""

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "bootstrap.py"
MARKETPLACE = """{
  "name": "example",
  "plugins": [{"name": "example-plugin", "source": "./plugins/example-plugin", "description": "An example plugin"}]
}
"""
STUB_CLAUDE = """#!/bin/sh
echo "$*" >> "$CLAUDE_STUB_LOG"
"""
SKILL = "---\nname: example-skill\n---\nExample rule.\n"
ANOTHER_SKILL = "---\nname: another-skill\n---\nAnother rule.\n"
# The test's own git calls get this too: a machine's commit.gpgsign or core.hooksPath would otherwise reach them.
GIT_ISOLATION = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
GIT_ENV = {**os.environ, **GIT_ISOLATION}


@dataclass(frozen=True)
class Sandbox:
    clone: Path
    home: Path
    claude_log: Path
    env: dict[str, str]

    @property
    def install_dir(self) -> Path:
        return self.home / ".claude" / "harness"

    @property
    def skills_dir(self) -> Path:
        return self.home / ".claude" / "skills"

    def run(self, *args: str, stdin: str = "", env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        command = [sys.executable, str(self.clone / "bootstrap.py"), *args]
        return subprocess.run(command, input=stdin, env=env or self.env, capture_output=True, text=True, check=False)


def git(repo: Path, *args: str) -> str:
    identity = ["-c", "user.name=Example", "-c", "user.email=example@example.com"]
    command = ["git", "-C", str(repo), *identity, *args]
    result = subprocess.run(command, env=GIT_ENV, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def write(path: Path, text: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    clone = tmp_path / "clone"
    clone.mkdir()
    shutil.copy2(SCRIPT, clone / "bootstrap.py")
    write(clone / "harness" / "githooks" / "pre-push", "#!/bin/sh\n", 0o755)
    write(clone / "harness" / "leak-scan" / "rules" / "shapes.toml", "# example\n")
    write(clone / "harness" / "skills" / "README.md", "# example\n")
    write(clone / "harness" / "skills" / "example-skill" / "SKILL.md", SKILL)
    write(clone / "harness" / "skills" / "another-skill" / "SKILL.md", ANOTHER_SKILL)
    write(clone / ".claude-plugin" / "marketplace.json", MARKETPLACE)
    git(clone, "init", "-q", "-b", "main")
    git(clone, "add", ".")
    git(clone, "commit", "-q", "-m", "Example commit")
    git(clone, "update-ref", "refs/remotes/origin/main", "HEAD")

    bin_dir = tmp_path / "bin"
    write(bin_dir / "claude", STUB_CLAUDE, 0o755)
    home = tmp_path / "home"
    home.mkdir()
    claude_log = tmp_path / "claude.log"
    env = {
        "HOME": str(home),
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "CLAUDE_STUB_LOG": str(claude_log),
        **GIT_ISOLATION,
    }
    return Sandbox(clone, home, claude_log, env)


def test_githooks_installs_only_the_tracked_files_and_keeps_state(sandbox: Sandbox) -> None:
    stale = sandbox.install_dir / "githooks" / "removed-from-repo"
    write(stale, "old\n")
    write(sandbox.install_dir / "state" / "passed" / "kept", "")
    write(sandbox.clone / "harness" / "githooks" / "untracked", "not committed\n")

    result = sandbox.run("githooks")

    assert result.returncode == 0, result.stderr
    pre_push = sandbox.install_dir / "githooks" / "pre-push"
    assert os.access(pre_push, os.X_OK)
    assert (sandbox.install_dir / "leak-scan" / "rules" / "shapes.toml").read_text() == "# example\n"
    assert not stale.exists()
    assert not (sandbox.install_dir / "githooks" / "untracked").exists()
    assert (sandbox.install_dir / "state" / "passed" / "kept").exists()
    assert "warning" not in result.stderr


def test_refuses_uncommitted_changes(sandbox: Sandbox) -> None:
    write(sandbox.clone / "harness" / "githooks" / "pre-push", "#!/bin/sh\nexit 0\n", 0o755)

    result = sandbox.run("githooks")

    assert result.returncode != 0
    assert "uncommitted changes" in result.stderr
    assert not sandbox.install_dir.exists()


def test_refuses_inside_a_session(sandbox: Sandbox) -> None:
    result = sandbox.run("githooks", env={**sandbox.env, "CLAUDE_CODE_SESSION_ID": "example-session"})

    assert result.returncode != 0
    assert "inside a Claude Code session" in result.stderr
    assert not sandbox.install_dir.exists()


def test_installs_head_with_a_warning_when_it_is_not_on_main(sandbox: Sandbox) -> None:
    git(sandbox.clone, "commit", "-q", "--allow-empty", "-m", "Unmerged commit")
    head = git(sandbox.clone, "rev-parse", "HEAD")

    result = sandbox.run("githooks")

    assert result.returncode == 0, result.stderr
    assert "not on origin/main" in result.stderr
    assert (sandbox.install_dir / "SOURCE_COMMIT").read_text() == f"{head}\n"


def test_hooks_path_points_each_repo_at_the_installed_hooks(sandbox: Sandbox, tmp_path: Path) -> None:
    unconfigured = tmp_path / "unconfigured"
    configured = tmp_path / "configured"
    for project in (unconfigured, configured):
        project.mkdir()
        git(project, "init", "-q")
    git(configured, "config", "claude.botEmail", "bot@example.com")

    result = sandbox.run("githooks", "hooks-path", "--repo", str(unconfigured), "--repo", str(configured))

    assert result.returncode == 0, result.stderr
    for project in (unconfigured, configured):
        assert git(project, "config", "core.hooksPath") == str(sandbox.install_dir / "githooks")
    assert f"{unconfigured} sets no claude.botEmail" in result.stderr
    assert f"{configured} sets no claude.botEmail" not in result.stderr


def test_hooks_path_refuses_before_githooks_is_installed(sandbox: Sandbox, tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    git(project, "init", "-q")

    result = sandbox.run("hooks-path", "--repo", str(project))

    assert result.returncode != 0
    assert "install the githooks component first" in result.stderr
    unset = subprocess.run(
        ["git", "-C", str(project), "config", "core.hooksPath"], env=GIT_ENV, capture_output=True, check=False
    )
    assert unset.returncode == 1


def test_skills_installs_each_skill_and_leaves_a_matching_copy_alone(sandbox: Sandbox) -> None:
    first = sandbox.run("skills")
    second = sandbox.run("skills")

    assert first.returncode == 0, first.stderr
    assert not (sandbox.skills_dir / "README.md").exists()
    assert second.returncode == 0, second.stderr
    for name, text in (("example-skill", SKILL), ("another-skill", ANOTHER_SKILL)):
        assert (sandbox.skills_dir / name / "SKILL.md").read_text() == text
        assert f"{sandbox.skills_dir / name} is up to date" in second.stderr


def test_skills_shows_an_edited_copy_and_replaces_it_only_on_yes(sandbox: Sandbox) -> None:
    sandbox.run("skills")
    installed = sandbox.skills_dir / "example-skill" / "SKILL.md"
    edited = "---\nname: example-skill\n---\nEdited rule.\n"
    write(installed, edited)
    added = sandbox.skills_dir / "example-skill" / "notes.md"
    write(added, "added by hand\n")

    kept = sandbox.run("skills", stdin="\n")

    assert kept.returncode == 0, kept.stderr
    assert "-Edited rule.\n+Example rule." in kept.stderr
    assert "-added by hand" in kept.stderr
    assert installed.read_text() == edited

    replaced = sandbox.run("skills", stdin="y\n")

    assert replaced.returncode == 0, replaced.stderr
    assert installed.read_text() == SKILL
    assert not added.exists()


def test_skills_keeps_an_edited_copy_when_stdin_has_no_answer(sandbox: Sandbox) -> None:
    sandbox.run("skills")
    installed = sandbox.skills_dir / "example-skill" / "SKILL.md"
    edited = "---\nname: example-skill\n---\nEdited rule.\n"
    write(installed, edited)

    result = sandbox.run("skills", stdin="")

    assert result.returncode == 1
    assert "no answer on stdin; rerun it in a terminal to answer" in result.stderr
    assert installed.read_text() == edited


def test_skills_refuses_a_skills_directory_linked_outside_claude(sandbox: Sandbox, tmp_path: Path) -> None:
    elsewhere = tmp_path / "other-repo" / "skills"
    elsewhere.mkdir(parents=True)
    sandbox.skills_dir.parent.mkdir()
    sandbox.skills_dir.symlink_to(elsewhere)

    result = sandbox.run("skills")

    assert result.returncode != 0
    assert f"outside {sandbox.home / '.claude'}; refusing to write there" in result.stderr
    assert list(elsewhere.iterdir()) == []


def test_skills_refuses_a_linked_skill_before_writing_any(sandbox: Sandbox, tmp_path: Path) -> None:
    elsewhere = tmp_path / "other-repo" / "example-skill"
    elsewhere.mkdir(parents=True)
    sandbox.skills_dir.mkdir(parents=True)
    # Sorted after another-skill, so a check made skill by skill would install another-skill first.
    (sandbox.skills_dir / "example-skill").symlink_to(elsewhere)

    result = sandbox.run("skills")

    assert result.returncode != 0
    assert f"outside {sandbox.home / '.claude'}; refusing to write there" in result.stderr
    assert list(elsewhere.iterdir()) == []
    assert not (sandbox.skills_dir / "another-skill").exists()


def test_plugin_installs_and_warns_of_a_plugin_dir_loading_it(sandbox: Sandbox, tmp_path: Path) -> None:
    unnamed = tmp_path / "unnamed" / "example-plugin"
    unnamed.mkdir(parents=True)
    # A plugin.json name wins over the directory name, so this directory loads a different plugin.
    renamed = tmp_path / "renamed" / "example-plugin"
    write(renamed / ".claude-plugin" / "plugin.json", '{"name": "another-plugin"}\n')
    env = {**sandbox.env, "CLAUDE_CODE_PLUGIN_DIRS": f"{renamed}{os.pathsep}{unnamed}"}

    result = sandbox.run("plugin:example-plugin", env=env)

    assert result.returncode == 0, result.stderr
    assert sandbox.claude_log.read_text().splitlines() == [
        "plugin marketplace add Runt9-Productions/runt9-claude-harness",
        "plugin install example-plugin@example",
    ]
    assert f"also loads from {unnamed}" in result.stderr
    assert f"also loads from {renamed}" not in result.stderr


def test_plugin_refuses_an_unreadable_plugin_dir_manifest_before_installing(sandbox: Sandbox, tmp_path: Path) -> None:
    broken = tmp_path / "broken" / "example-plugin"
    write(broken / ".claude-plugin" / "plugin.json", "{not json\n")
    env = {**sandbox.env, "CLAUDE_CODE_PLUGIN_DIRS": str(broken)}

    result = sandbox.run("plugin:example-plugin", env=env)

    assert result.returncode == 1
    assert f"bootstrap: cannot read {broken / '.claude-plugin' / 'plugin.json'}" in result.stderr
    assert not sandbox.claude_log.exists()


def test_with_no_components_named_asks_about_each(sandbox: Sandbox) -> None:
    # In install order: githooks, hooks-path (no --repo, so a yes would fail), skills, plugin:example-plugin.
    result = sandbox.run(stdin="y\nn\nn\ny\n")

    assert result.returncode == 0, result.stderr
    assert (sandbox.install_dir / "githooks" / "pre-push").exists()
    assert sandbox.claude_log.exists(), "plugin:example-plugin was not installed"


def test_unknown_component_installs_nothing(sandbox: Sandbox) -> None:
    result = sandbox.run("githooks", "no-such-component")

    assert result.returncode != 0
    assert "unknown component no-such-component" in result.stderr
    assert not sandbox.install_dir.exists()
