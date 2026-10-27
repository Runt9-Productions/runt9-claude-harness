"""Runs bootstrap.py as a user does: from outside a synthetic clone, with HOME in a temporary directory and a stub
claude on PATH that records each call. Every git call runs without the machine's global and system config.
Needs git and pytest.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "bootstrap.py"
GIT_ISOLATION = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
IDENTITY = ("-c", "user.name=Example", "-c", "user.email=example@example.com")
MARKETPLACE = {
    "name": "example-market",
    "plugins": [
        {"name": "example-one", "source": "./plugins/example-one", "description": "first example"},
        {"name": "example-two", "source": "./plugins/example-two", "description": "second example"},
        {"name": "example-three", "source": "./plugins/example-three", "description": "third example"},
    ],
}
MARKETPLACE_ADD = ["plugin", "marketplace", "add", "Runt9-Productions/runt9-claude-harness"]
PRE_PUSH = b"#!/bin/sh\necho example pre-push\n"
ALPHA_SKILL = b"example alpha skill\n"
EDITED_SKILL = b"example edited skill\n"
STUB = """#!{python}
import json, os, sys
with open({log!r}, "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("EXAMPLE_CLAUDE_EXIT", "0")))
"""


class Sandbox:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.home = root / "home"
        self.install = self.home / ".claude" / "harness"
        self.skills = self.home / ".claude" / "skills"
        self.clone = root / "clone"
        self.log = root / "claude.log"
        bin_dir = root / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "claude"
        stub.write_text(STUB.format(python=sys.executable, log=str(self.log)))
        stub.chmod(0o755)
        self.home.mkdir()
        # Built from nothing, so no session variable, plugin directory or git setting of the machine reaches a run.
        self.env = {"PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "HOME": str(self.home), **GIT_ISOLATION}

    def git(self, cwd: Path, *args: str) -> str:
        result = subprocess.run(["git", "-C", str(cwd), *args], env=self.env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def write(self, relative: str, content: bytes, mode: int = 0o644) -> None:
        path = self.clone / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(mode)

    def commit(self, message: str, push: bool = True) -> str:
        self.git(self.clone, "add", "--all")
        self.git(self.clone, *IDENTITY, "commit", "--quiet", "-m", message)
        if push:
            self.git(self.clone, "push", "--quiet", "origin", "main")
        return self.git(self.clone, "rev-parse", "HEAD")

    def new_repo(self, name: str) -> Path:
        repo = self.root / name
        self.git(self.root, "init", "--quiet", "-b", "main", str(repo))
        return repo

    def run(self, *args: str, stdin: str | None = None, env: dict[str, str] | None = None):
        return subprocess.run(
            [sys.executable, str(self.clone / "bootstrap.py"), *args],
            cwd=self.root,
            env={**self.env, **(env or {})},
            input=stdin,
            stdin=subprocess.DEVNULL if stdin is None else None,
            capture_output=True,
            text=True,
        )

    def claude_calls(self) -> list[list[str]]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def hooks_path(self, repo: Path) -> str | None:
        result = subprocess.run(
            ["git", "-C", str(repo), "config", "--get", "core.hooksPath"], env=self.env, capture_output=True, text=True
        )
        return result.stdout.strip() or None


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    box = Sandbox(tmp_path)
    box.git(tmp_path, "init", "--quiet", "--bare", "-b", "main", str(tmp_path / "origin.git"))
    box.git(tmp_path, "init", "--quiet", "-b", "main", str(box.clone))
    box.git(box.clone, "remote", "add", "origin", str(tmp_path / "origin.git"))
    shutil.copy(SCRIPT, box.clone / "bootstrap.py")
    box.write(".claude-plugin/marketplace.json", json.dumps(MARKETPLACE).encode())
    box.write("harness/githooks/pre-push", PRE_PUSH, 0o755)
    box.write("harness/githooks/README.md", b"example readme\n")
    box.write("harness/githooks/example-retired-hook", b"#!/bin/sh\n", 0o755)
    box.write("harness/leak-scan/scan.sh", b"#!/bin/sh\necho example scan\n", 0o755)
    box.write("harness/skills/README.md", b"example skills readme\n")
    box.write("harness/skills/example-alpha/SKILL.md", ALPHA_SKILL)
    box.write("harness/skills/example-beta/SKILL.md", b"example beta skill\n")
    box.write("harness/skills/example-beta/scripts/example.sh", b"#!/bin/sh\n", 0o755)
    box.commit("Example harness")
    return box


def installed_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def test_githooks_installs_the_commit_and_keeps_state(sandbox: Sandbox) -> None:
    assert sandbox.run("githooks").returncode == 0
    marker = sandbox.install / "state" / "passed" / "example-pass"
    marker.parent.mkdir(parents=True)
    marker.touch()
    (sandbox.clone / "harness/githooks/example-retired-hook").unlink()
    head = sandbox.commit("Drop the example hook")

    result = sandbox.run("githooks")

    assert result.returncode == 0, result.stderr
    assert "warning" not in result.stderr
    assert f"from {head} into {sandbox.install}" in result.stdout
    assert (sandbox.install / "SOURCE_COMMIT").read_text() == f"{head}\n"
    assert (sandbox.install / "githooks/pre-push").read_bytes() == PRE_PUSH
    assert installed_mode(sandbox.install / "githooks/pre-push") == 0o755
    assert installed_mode(sandbox.install / "leak-scan/scan.sh") == 0o755
    assert installed_mode(sandbox.install / "githooks/README.md") == 0o644
    assert not (sandbox.install / "githooks/example-retired-hook").exists()
    assert marker.exists()


def test_githooks_installs_the_commit_not_a_hidden_working_tree_change(sandbox: Sandbox) -> None:
    sandbox.git(sandbox.clone, "update-index", "--skip-worktree", "harness/githooks/pre-push")
    (sandbox.clone / "harness/githooks/pre-push").write_bytes(b"#!/bin/sh\necho example edit\n")
    assert sandbox.git(sandbox.clone, "status", "--porcelain") == ""

    result = sandbox.run("githooks")

    assert result.returncode == 0, result.stderr
    assert (sandbox.install / "githooks/pre-push").read_bytes() == PRE_PUSH


@pytest.mark.skipif(os.geteuid() == 0, reason="root renames a directory it cannot write")
def test_failed_reinstall_leaves_the_previous_install(sandbox: Sandbox) -> None:
    first = sandbox.git(sandbox.clone, "rev-parse", "HEAD")
    assert sandbox.run("githooks").returncode == 0
    sandbox.write("harness/githooks/pre-push", b"#!/bin/sh\necho example second\n", 0o755)
    sandbox.commit("Change the example hook")
    # Moving a directory to another parent needs write permission on it, so swapping out leak-scan fails after
    # githooks has already been swapped.
    (sandbox.install / "leak-scan").chmod(0o555)
    try:
        result = sandbox.run("githooks")
    finally:
        (sandbox.install / "leak-scan").chmod(0o755)

    assert result.returncode == 1
    assert "githooks failed: [Errno 13] Permission denied" in result.stderr
    assert (sandbox.install / "githooks/pre-push").read_bytes() == PRE_PUSH
    assert (sandbox.install / "leak-scan/scan.sh").exists()
    assert (sandbox.install / "SOURCE_COMMIT").read_text() == f"{first}\n"
    assert sorted(path.name for path in sandbox.install.iterdir()) == ["SOURCE_COMMIT", "githooks", "leak-scan"]


@pytest.mark.skipif(os.geteuid() == 0, reason="root renames a directory it cannot write")
def test_reinstall_failing_at_source_commit_puts_both_parts_back(sandbox: Sandbox) -> None:
    assert sandbox.run("githooks").returncode == 0
    sandbox.write("harness/githooks/pre-push", b"#!/bin/sh\necho example second\n", 0o755)
    sandbox.commit("Change the example hook")
    # SOURCE_COMMIT is swapped in last, and a directory without write permission cannot move to another directory.
    source_commit = sandbox.install / "SOURCE_COMMIT"
    source_commit.unlink()
    source_commit.mkdir(mode=0o555)
    try:
        result = sandbox.run("githooks")
    finally:
        source_commit.chmod(0o755)

    assert result.returncode == 1
    assert "githooks failed:" in result.stderr
    assert (sandbox.install / "githooks/pre-push").read_bytes() == PRE_PUSH
    assert (sandbox.install / "leak-scan/scan.sh").exists()
    assert source_commit.is_dir()
    assert sorted(path.name for path in sandbox.install.iterdir()) == ["SOURCE_COMMIT", "githooks", "leak-scan"]


def test_symlink_in_a_part_stops_githooks(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/leak-scan/example-link").symlink_to("scan.sh")
    head = sandbox.commit("Add an example symlink")

    result = sandbox.run("githooks")

    assert result.returncode == 1
    assert f"harness/leak-scan/example-link in {head} is not a regular file (mode 120000)" in result.stderr
    assert not (sandbox.install / "githooks").exists()


def test_uncommitted_tracked_change_refuses_githooks(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/githooks/README.md").write_text("example edit\n")

    result = sandbox.run("githooks")

    assert result.returncode == 1
    assert "has uncommitted changes to tracked files" in result.stderr
    assert not sandbox.install.exists()


def test_untracked_file_does_not_refuse_githooks(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/githooks/example-untracked").write_text("example\n")

    result = sandbox.run("githooks")

    assert result.returncode == 0, result.stderr
    assert (sandbox.install / "githooks/pre-push").exists()
    assert not (sandbox.install / "githooks/example-untracked").exists()


def test_uncommitted_tracked_change_does_not_refuse_a_plugin_only_run(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/githooks/README.md").write_text("example edit\n")

    result = sandbox.run("plugin:example-one")

    assert result.returncode == 0, result.stderr
    assert sandbox.claude_calls() == [MARKETPLACE_ADD, ["plugin", "install", "example-one@example-market"]]


def test_older_python_stops_with_one_line(sandbox: Sandbox) -> None:
    older = "import runpy, sys; sys.version_info = (3, 11, 9); runpy.run_path(sys.argv[1], run_name='__main__')"

    result = subprocess.run(
        [sys.executable, "-c", older, str(sandbox.clone / "bootstrap.py")],
        env=sandbox.env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert result.stderr == "bootstrap: needs Python 3.12 or newer, and this is 3.11.9\n"


@pytest.mark.parametrize("variable", ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE"])
def test_session_refuses(sandbox: Sandbox, variable: str) -> None:
    result = sandbox.run("githooks", "plugin:example-one", env={variable: "1"})

    assert result.returncode == 1
    assert "refusing to run inside a Claude Code session" in result.stderr
    assert not sandbox.install.exists()
    assert sandbox.claude_calls() == []


@pytest.mark.parametrize("variable", ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE"])
def test_list_works_in_a_session(sandbox: Sandbox, variable: str) -> None:
    result = sandbox.run("--list", env={variable: "1"})

    assert result.returncode == 0, result.stderr
    names = [line.split()[0] for line in result.stdout.splitlines()]
    assert names == [
        "githooks",
        "hooks-path",
        "skills",
        "plugin:example-one",
        "plugin:example-two",
        "plugin:example-three",
    ]


def test_head_off_origin_main_warns_and_installs_head(sandbox: Sandbox) -> None:
    sandbox.write("harness/githooks/README.md", b"example local change\n")
    head = sandbox.commit("Example local commit", push=False)

    result = sandbox.run("githooks")

    assert result.returncode == 0, result.stderr
    assert "warning: HEAD is not on origin/main" in result.stderr
    assert (sandbox.install / "SOURCE_COMMIT").read_text() == f"{head}\n"


def test_hooks_path_sets_each_repository_after_githooks(sandbox: Sandbox) -> None:
    with_bot = sandbox.new_repo("example-with-bot")
    sandbox.git(with_bot, "config", "claude.botEmail", "bot@example.com")
    without_bot = sandbox.new_repo("example-without-bot")

    result = sandbox.run("hooks-path", "githooks", "--repo", str(with_bot), "--repo", str(without_bot))

    assert result.returncode == 0, result.stderr
    hooks = str(sandbox.install / "githooks")
    assert sandbox.hooks_path(with_bot) == hooks
    assert sandbox.hooks_path(without_bot) == hooks
    assert f"{without_bot} sets no claude.botEmail" in result.stderr
    assert f"{with_bot} sets no claude.botEmail" not in result.stderr


def test_hooks_path_refuses_before_githooks_is_installed(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")

    result = sandbox.run("hooks-path", "--repo", str(repo))

    assert result.returncode == 1
    assert "githooks is not installed" in result.stderr
    assert sandbox.hooks_path(repo) is None


@pytest.mark.parametrize(
    ("config_file", "restore"),
    [
        ("example-repo/.git/config", "config core.hooksPath '/example/old hooks'"),
        ("example-global.gitconfig", "config --unset core.hooksPath"),
    ],
    ids=["local", "global"],
)
def test_hooks_path_prints_a_different_previous_value(sandbox: Sandbox, config_file: str, restore: str) -> None:
    repo = sandbox.new_repo("example-repo")
    global_config = sandbox.root / "example-global.gitconfig"
    global_config.touch()
    previous_in = sandbox.root / config_file
    sandbox.git(sandbox.root, "config", "--file", str(previous_in), "core.hooksPath", "/example/old hooks")
    env = {"GIT_CONFIG_GLOBAL": str(global_config)}
    assert sandbox.run("githooks", env=env).returncode == 0

    replaced = sandbox.run("hooks-path", "--repo", str(repo), env=env)
    repeated = sandbox.run("hooks-path", "--repo", str(repo), env=env)

    assert replaced.returncode == 0, replaced.stderr
    assert f"{repo} had core.hooksPath /example/old hooks" in replaced.stdout
    assert f"to restore it: git -C {repo} {restore}\n" in replaced.stdout
    assert sandbox.hooks_path(repo) == str(sandbox.install / "githooks")
    assert repeated.returncode == 0, repeated.stderr
    assert "had core.hooksPath" not in repeated.stdout


def test_hooks_path_names_the_repository_hooks_that_stop_running(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")
    hooks_dir = repo / ".git/hooks"
    hooks_dir.mkdir(exist_ok=True)
    for name in ("pre-commit", "pre-push.sample"):
        (hooks_dir / name).write_text("#!/bin/sh\n")
        (hooks_dir / name).chmod(0o755)
    assert sandbox.run("githooks").returncode == 0

    result = sandbox.run("hooks-path", "--repo", str(repo))

    assert result.returncode == 0, result.stderr
    assert f"warning: {repo} stops running pre-commit from {hooks_dir}\n" in result.stderr
    assert "pre-push.sample" not in result.stderr


def test_hooks_path_ignores_a_git_dir_in_the_environment(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")
    other = sandbox.new_repo("example-other")
    assert sandbox.run("githooks").returncode == 0

    result = sandbox.run("hooks-path", "--repo", str(repo), env={"GIT_DIR": str(other / ".git")})

    assert result.returncode == 0, result.stderr
    assert sandbox.hooks_path(repo) == str(sandbox.install / "githooks")
    assert sandbox.hooks_path(other) is None


def test_hooks_path_refuses_a_directory_inside_a_repository(sandbox: Sandbox) -> None:
    named_first = sandbox.new_repo("example-first")
    outer = sandbox.new_repo("example-outer")
    inner = outer / "example-subdirectory"
    inner.mkdir()

    result = sandbox.run("githooks", "hooks-path", "--repo", str(named_first), "--repo", str(inner))

    assert result.returncode == 1
    assert f"{inner} is inside the repository {outer}, not its top level" in result.stderr
    assert sandbox.hooks_path(named_first) is None
    assert sandbox.hooks_path(outer) is None
    assert not sandbox.install.exists()


def test_hooks_path_fails_when_git_reads_another_value(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")
    override = sandbox.root / "example-override.gitconfig"
    override.write_text("[core]\n\thooksPath = /example/override\n")
    sandbox.git(repo, "config", "include.path", str(override))

    result = sandbox.run("githooks", "hooks-path", "--repo", str(repo))

    assert result.returncode == 1
    assert "reads core.hooksPath as /example/override" in result.stderr
    assert "installed before it: githooks" in result.stderr
    assert (sandbox.install / "githooks/pre-push").exists()


def test_skills_installs_each_skill_and_leaves_other_skills(sandbox: Sandbox) -> None:
    own = sandbox.skills / "example-own/SKILL.md"
    own.parent.mkdir(parents=True)
    own.write_bytes(b"example own skill\n")

    result = sandbox.run("skills")

    assert result.returncode == 0, result.stderr
    assert sorted(path.name for path in sandbox.skills.iterdir()) == ["example-alpha", "example-beta", "example-own"]
    assert (sandbox.skills / "example-alpha/SKILL.md").read_bytes() == ALPHA_SKILL
    assert installed_mode(sandbox.skills / "example-alpha/SKILL.md") == 0o644
    assert installed_mode(sandbox.skills / "example-beta/scripts/example.sh") == 0o755
    assert own.read_bytes() == b"example own skill\n"


def test_skills_rerun_leaves_a_matching_copy(sandbox: Sandbox) -> None:
    assert sandbox.run("skills").returncode == 0
    inode = (sandbox.skills / "example-alpha").stat().st_ino

    result = sandbox.run("skills")

    assert result.returncode == 0, result.stderr
    assert "example-alpha is up to date" in result.stdout
    assert "installed example-alpha" not in result.stdout
    assert (sandbox.skills / "example-alpha").stat().st_ino == inode


def test_edited_skill_shows_the_diff_and_is_replaced_only_on_yes(sandbox: Sandbox) -> None:
    assert sandbox.run("skills").returncode == 0
    skill = sandbox.skills / "example-alpha"
    (skill / "SKILL.md").write_bytes(EDITED_SKILL)
    (skill / "example-notes.md").write_bytes(b"example notes\n")

    kept = sandbox.run("skills", stdin="n\n")
    kept_content = (skill / "SKILL.md").read_bytes()
    replaced = sandbox.run("skills", stdin="y\n")

    assert kept.returncode == 0, kept.stderr
    assert "-example edited skill\n+example alpha skill\n" in kept.stdout
    assert "-example notes\n" in kept.stdout
    assert "kept your copy of example-alpha" in kept.stdout
    assert kept_content == EDITED_SKILL
    assert replaced.returncode == 0, replaced.stderr
    assert (skill / "SKILL.md").read_bytes() == ALPHA_SKILL
    assert not (skill / "example-notes.md").exists()


def test_edited_skill_without_stdin_stops_before_any_skill_is_written(sandbox: Sandbox) -> None:
    assert sandbox.run("skills").returncode == 0
    shutil.rmtree(sandbox.skills / "example-alpha")
    (sandbox.skills / "example-beta/SKILL.md").write_bytes(EDITED_SKILL)

    result = sandbox.run("skills")

    assert result.returncode == 1
    assert "no answer on stdin to whether to replace" in result.stderr
    assert "run bootstrap.py in a terminal" in result.stderr
    assert (sandbox.skills / "example-beta/SKILL.md").read_bytes() == EDITED_SKILL
    assert not (sandbox.skills / "example-alpha").exists()


def test_skills_directory_linked_outside_claude_refuses_with_nothing_written(sandbox: Sandbox) -> None:
    elsewhere = sandbox.root / "example-elsewhere"
    elsewhere.mkdir()
    sandbox.skills.parent.mkdir()
    sandbox.skills.symlink_to(elsewhere)

    result = sandbox.run("githooks", "skills")

    assert result.returncode == 1
    assert f"{sandbox.skills} resolves to {elsewhere.resolve()}, outside" in result.stderr
    assert list(elsewhere.iterdir()) == []
    assert not sandbox.install.exists()


def test_linked_skill_refuses_before_any_skill_is_written(sandbox: Sandbox) -> None:
    elsewhere = sandbox.root / "example-elsewhere"
    elsewhere.mkdir()
    sandbox.skills.mkdir(parents=True)
    (sandbox.skills / "example-beta").symlink_to(elsewhere)

    result = sandbox.run("skills")

    assert result.returncode == 1
    assert f"{sandbox.skills / 'example-beta'} resolves to {elsewhere.resolve()}, outside" in result.stderr
    assert sorted(path.name for path in sandbox.skills.iterdir()) == ["example-beta"]
    assert list(elsewhere.iterdir()) == []


def test_skills_installs_the_commit_not_the_working_tree(sandbox: Sandbox) -> None:
    sandbox.git(sandbox.clone, "update-index", "--skip-worktree", "harness/skills/example-alpha/SKILL.md")
    (sandbox.clone / "harness/skills/example-alpha/SKILL.md").write_bytes(EDITED_SKILL)
    (sandbox.clone / "harness/skills/example-alpha/example-untracked").write_bytes(b"example\n")

    result = sandbox.run("skills")

    assert result.returncode == 0, result.stderr
    assert (sandbox.skills / "example-alpha/SKILL.md").read_bytes() == ALPHA_SKILL
    assert not (sandbox.skills / "example-alpha/example-untracked").exists()


@pytest.mark.skipif(os.geteuid() == 0, reason="root renames a directory it cannot write")
def test_failed_skill_replacement_leaves_each_skill_whole(sandbox: Sandbox) -> None:
    assert sandbox.run("skills").returncode == 0
    for name in ("example-alpha", "example-beta"):
        (sandbox.skills / name / "SKILL.md").write_bytes(EDITED_SKILL)
    # Moving a directory to another parent needs write permission on it, so replacing example-beta fails after
    # example-alpha has been replaced.
    (sandbox.skills / "example-beta").chmod(0o555)
    try:
        result = sandbox.run("skills", stdin="y\ny\n")
    finally:
        (sandbox.skills / "example-beta").chmod(0o755)

    assert result.returncode == 1
    assert "skills failed: [Errno 13] Permission denied" in result.stderr
    assert (sandbox.skills / "example-alpha/SKILL.md").read_bytes() == ALPHA_SKILL
    assert (sandbox.skills / "example-beta/SKILL.md").read_bytes() == EDITED_SKILL
    assert (sandbox.skills / "example-beta/scripts/example.sh").exists()
    assert sorted(path.name for path in sandbox.skills.iterdir()) == ["example-alpha", "example-beta"]


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        (["githooks", "example-unknown"], "unknown component example-unknown"),
        (["githooks", "--repo", "{repo}"], "--repo is used only by hooks-path"),
        (["githooks", "hooks-path"], "hooks-path needs --repo"),
    ],
    ids=["unknown-component", "repo-without-hooks-path", "hooks-path-without-repo"],
)
def test_usage_error_installs_nothing(sandbox: Sandbox, args: list[str], reason: str) -> None:
    repo = sandbox.new_repo("example-repo")

    result = sandbox.run(*[arg.format(repo=repo) for arg in args])

    assert result.returncode == 1
    assert reason in result.stderr
    assert not sandbox.install.exists()


def test_plugins_run_the_marketplace_commands_in_order(sandbox: Sandbox) -> None:
    result = sandbox.run("plugin:example-two", "plugin:example-one")

    assert result.returncode == 0, result.stderr
    assert sandbox.claude_calls() == [
        MARKETPLACE_ADD,
        ["plugin", "install", "example-one@example-market"],
        ["plugin", "install", "example-two@example-market"],
    ]


def test_failing_claude_command_stops_the_run(sandbox: Sandbox) -> None:
    result = sandbox.run("plugin:example-one", "plugin:example-two", env={"EXAMPLE_CLAUDE_EXIT": "3"})

    assert result.returncode == 1
    assert f"claude {' '.join(MARKETPLACE_ADD)} exited 3" in result.stderr
    assert sandbox.claude_calls() == [MARKETPLACE_ADD]


def make_plugin_dir(parent: Path, directory: str, manifest_name: str | None) -> str:
    path = parent / directory
    path.mkdir(parents=True)
    if manifest_name is not None:
        (path / ".claude-plugin").mkdir()
        (path / ".claude-plugin/plugin.json").write_text(json.dumps({"name": manifest_name}))
    return str(path)


@pytest.mark.parametrize("in_settings", [False, True], ids=["shell", "settings"])
def test_plugin_dirs_warning_names_the_loaded_plugin(sandbox: Sandbox, in_settings: bool) -> None:
    parent = sandbox.root / "example-plugin-dirs"
    entries = [
        make_plugin_dir(parent, "example-one", "example-renamed"),
        make_plugin_dir(parent, "example-elsewhere", "example-two"),
        make_plugin_dir(parent, "example-three", None),
    ]
    value = os.pathsep.join(entries)
    env = {"CLAUDE_CODE_PLUGIN_DIRS": value}
    if in_settings:
        env = {}
        (sandbox.home / ".claude").mkdir()
        (sandbox.home / ".claude/settings.json").write_text(json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": value}}))

    result = sandbox.run("plugin:example-one", "plugin:example-two", "plugin:example-three", env=env)

    assert result.returncode == 0, result.stderr
    assert f"loads example-two from {entries[1]}" in result.stderr
    assert f"loads example-three from {entries[2]}" in result.stderr
    assert "loads example-one from" not in result.stderr
    assert sandbox.claude_calls() == [
        MARKETPLACE_ADD,
        ["plugin", "install", "example-one@example-market"],
        ["plugin", "install", "example-two@example-market"],
        ["plugin", "install", "example-three@example-market"],
    ]


# A `content` of None makes `broken` a directory, which cannot be read as a file.
@pytest.mark.parametrize(
    ("broken", "content", "reason"),
    [
        ("example-plugin/.claude-plugin/plugin.json", "[]", "is not a JSON object"),
        ("example-plugin/.claude-plugin/plugin.json", "{", "is not valid JSON"),
        ("example-plugin/.claude-plugin/plugin.json", None, "cannot read {path}: Is a directory"),
        ("home/.claude/settings.json", "[]", "is not a JSON object"),
    ],
    ids=["manifest-not-object", "manifest-not-json", "manifest-unreadable", "settings-not-object"],
)
def test_bad_json_stops_before_any_claude_call(sandbox: Sandbox, broken: str, content: str | None, reason: str) -> None:
    plugin_dir = sandbox.root / "example-plugin"
    (plugin_dir / ".claude-plugin").mkdir(parents=True)
    settings = sandbox.home / ".claude/settings.json"
    settings.parent.mkdir()
    settings.write_text(json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": str(plugin_dir)}}))
    path = sandbox.root / broken
    if content is None:
        path.mkdir()
    else:
        path.write_text(content)

    result = sandbox.run("plugin:example-one")

    assert result.returncode == 1
    assert reason.format(path=path) in result.stderr
    assert str(path) in result.stderr
    assert sandbox.claude_calls() == []


def test_prompt_installs_what_was_answered_yes(sandbox: Sandbox) -> None:
    # githooks, skills, then the three plugins; hooks-path is not offered without --repo.
    result = sandbox.run(stdin="y\nn\nn\ny\nn\n")

    assert result.returncode == 0, result.stderr
    assert "Install hooks-path" not in result.stdout
    assert (sandbox.install / "githooks/pre-push").exists()
    assert not sandbox.skills.exists()
    assert sandbox.claude_calls() == [MARKETPLACE_ADD, ["plugin", "install", "example-two@example-market"]]


def test_prompt_without_stdin_stops(sandbox: Sandbox) -> None:
    result = sandbox.run()

    assert result.returncode == 1
    assert "no answer on stdin; name the components on the command line" in result.stderr
    assert not sandbox.install.exists()
    assert sandbox.claude_calls() == []
