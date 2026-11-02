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
TEMPLATES_HEADER = "Templates to fill in, saved without .example to take effect:\n"
BLOCK_START = "<!-- runt9-claude-harness: bootstrap.py keeps the lines from here to the end marker -->"
BLOCK_END = "<!-- runt9-claude-harness: end -->"
EXAMPLE_IMPORT = "@~/.claude/harness/current/fragments/example-rules.md"
ALPHA_SKILL = b"example alpha skill\n"
SETTINGS_FRAGMENT = {
    "permissions": {"deny": ["Read(./example-secret)", "Read(./example-key)"], "defaultMode": "example-mode"},
    "model": "example-fragment-model",
}
STUB = """#!{python}
import json, os, sys
with open({log!r}, "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\\n")
fail = os.environ.get("EXAMPLE_CLAUDE_FAIL")
sys.exit(3 if fail and sys.argv[1:3] == ["plugin", fail] else 0)
"""


class Sandbox:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.home = root / "home"
        self.install = self.home / ".claude" / "harness"
        self.current = self.install / "current"
        self.skills = self.home / ".claude" / "skills"
        self.claude_md = self.home / ".claude" / "CLAUDE.md"
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

    def set_version(self, version: str) -> None:
        self.write("harness/harness.json", json.dumps({"version": version}).encode())

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

    def run(self, *args: str, stdin: str | None = None, env: dict[str, str] | None = None, flags: tuple[str, ...] = ()):
        return subprocess.run(
            [sys.executable, *flags, str(self.clone / "bootstrap.py"), *args],
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
        # git config --get exits 1 for an unset key; any other failure must not read as unset.
        assert result.returncode in (0, 1), result.stderr
        return result.stdout.strip() or None


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    box = Sandbox(tmp_path)
    box.git(tmp_path, "init", "--quiet", "--bare", "-b", "main", str(tmp_path / "origin.git"))
    box.git(tmp_path, "init", "--quiet", "-b", "main", str(box.clone))
    box.git(box.clone, "remote", "add", "origin", str(tmp_path / "origin.git"))
    shutil.copy(SCRIPT, box.clone / "bootstrap.py")
    shutil.copytree(SCRIPT.parent / "bootstrap", box.clone / "bootstrap", ignore=shutil.ignore_patterns("__pycache__"))
    box.write(".claude-plugin/marketplace.json", json.dumps(MARKETPLACE).encode())
    box.set_version("0.1.0")
    box.write("harness/githooks/pre-push", PRE_PUSH, 0o755)
    box.write("harness/githooks/README.md", b"example readme\n")
    box.write("harness/githooks/example-retired-hook", b"#!/bin/sh\n", 0o755)
    box.write("harness/leak-scan/scan.sh", b"#!/bin/sh\necho example scan\n", 0o755)
    box.write("harness/skills/README.md", b"example skills readme\n")
    box.write("harness/skills/example-alpha/SKILL.md", ALPHA_SKILL)
    box.write("harness/skills/example-beta/SKILL.md", b"example beta skill\n")
    box.write("harness/skills/example-beta/scripts/example.sh", b"#!/bin/sh\n", 0o755)
    box.write("harness/skills/example-shared/example.txt", b"example file outside any skill\n")
    box.write("harness/fragments/README.md", b"example fragments readme\n")
    box.write("harness/fragments/example-rules.md", b"example rules\n")
    box.write("harness/settings/example-deny.json", json.dumps(SETTINGS_FRAGMENT).encode())
    box.commit("Example harness")
    return box


def installed_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def test_harness_installs_a_new_version_and_keeps_state(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    marker = sandbox.install / "state" / "passed" / "example-pass"
    marker.parent.mkdir(parents=True)
    marker.touch()
    sandbox.set_version("0.2.0")
    head = sandbox.commit("Raise the example version")

    result = sandbox.run("harness")

    assert result.returncode == 0, result.stderr
    assert "warning" not in result.stderr
    assert f"installed 0.2.0 from {head} into {sandbox.install / 'versions/0.2.0'}" in result.stdout
    assert sandbox.current.readlink() == Path("versions/0.2.0")
    assert (sandbox.current / "SOURCE_COMMIT").read_text() == f"{head}\n"
    assert (sandbox.current / "githooks/pre-push").read_bytes() == PRE_PUSH
    assert installed_mode(sandbox.current / "githooks/pre-push") == 0o755
    assert installed_mode(sandbox.current / "harness.json") == 0o644
    assert not (sandbox.current / "githooks/README.md").exists()
    assert sorted(path.name for path in (sandbox.install / "versions").iterdir()) == ["0.2.0"]
    assert marker.exists()


def test_harness_replaces_an_installed_version_only_on_yes(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    edited = b"#!/bin/sh\necho example unbumped\n"
    sandbox.write("harness/githooks/pre-push", edited, 0o755)
    (sandbox.clone / "harness/githooks/example-retired-hook").unlink()
    sandbox.commit("Change the example hooks without a version rise")

    # A bare Enter takes the [y/N] default.
    kept = sandbox.run("harness", stdin="\n")
    kept_hook = (sandbox.current / "githooks/pre-push").read_bytes()
    no_answer = sandbox.run("harness")
    replaced = sandbox.run("harness", stdin="y\n")

    assert kept.returncode == 0, kept.stderr
    assert "0.1.0 is already installed" in kept.stdout
    assert kept_hook == PRE_PUSH
    assert no_answer.returncode == 1
    assert "run bootstrap.py in a terminal" in no_answer.stderr
    assert replaced.returncode == 0, replaced.stderr
    assert (sandbox.current / "githooks/pre-push").read_bytes() == edited
    assert not (sandbox.current / "githooks/example-retired-hook").exists()


def test_harness_installs_the_commit_not_a_hidden_working_tree_change(sandbox: Sandbox) -> None:
    sandbox.git(sandbox.clone, "update-index", "--skip-worktree", "harness/githooks/pre-push")
    (sandbox.clone / "harness/githooks/pre-push").write_bytes(b"#!/bin/sh\necho example edit\n")
    assert sandbox.git(sandbox.clone, "status", "--porcelain") == ""

    result = sandbox.run("harness")

    assert result.returncode == 0, result.stderr
    assert (sandbox.current / "githooks/pre-push").read_bytes() == PRE_PUSH


def test_symlink_in_the_harness_stops_the_install(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/leak-scan/example-link").symlink_to("scan.sh")
    head = sandbox.commit("Add an example symlink")

    result = sandbox.run("harness")

    assert result.returncode == 1
    assert f"harness/leak-scan/example-link in {head} is not a regular file (mode 120000)" in result.stderr
    assert not os.path.lexists(sandbox.current)
    assert list((sandbox.install / "versions").iterdir()) == []


def test_uncommitted_tracked_change_refuses_the_harness(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/githooks/README.md").write_text("example edit\n")

    result = sandbox.run("harness")

    assert result.returncode == 1
    assert "has uncommitted changes to tracked files" in result.stderr
    assert not sandbox.install.exists()


def test_untracked_file_does_not_refuse_the_harness(sandbox: Sandbox) -> None:
    (sandbox.clone / "harness/githooks/example-untracked").write_text("example\n")

    result = sandbox.run("harness")

    assert result.returncode == 0, result.stderr
    assert (sandbox.current / "githooks/pre-push").exists()
    assert not (sandbox.current / "githooks/example-untracked").exists()


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


def test_runs_with_the_script_directory_off_sys_path(sandbox: Sandbox) -> None:
    result = sandbox.run("--list", flags=("-P",))

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("variable", ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE"])
def test_session_refuses(sandbox: Sandbox, variable: str) -> None:
    result = sandbox.run("harness", "plugin:example-one", env={variable: "1"})

    assert result.returncode == 1
    assert "refusing to run inside a Claude Code session" in result.stderr
    assert not sandbox.install.exists()
    assert sandbox.claude_calls() == []


def test_list_works_in_a_session(sandbox: Sandbox) -> None:
    result = sandbox.run("--list", env={"CLAUDE_CODE_SESSION_ID": "1", "CLAUDECODE": "1"})

    assert result.returncode == 0, result.stderr
    names = [line.split()[0] for line in result.stdout.splitlines()]
    assert names == [
        "harness",
        "hooks-path",
        "skills",
        "fragment:example-rules",
        "settings:example-deny",
        "plugin:example-one",
        "plugin:example-two",
        "plugin:example-three",
    ]


def test_head_off_origin_main_warns_and_installs_head(sandbox: Sandbox) -> None:
    sandbox.write("harness/githooks/README.md", b"example local change\n")
    head = sandbox.commit("Example local commit", push=False)

    result = sandbox.run("harness")

    assert result.returncode == 0, result.stderr
    assert "warning: HEAD is not on origin/main" in result.stderr
    assert (sandbox.current / "SOURCE_COMMIT").read_text() == f"{head}\n"


def test_hooks_path_sets_each_repository_after_the_harness(sandbox: Sandbox) -> None:
    with_bot = sandbox.new_repo("example-with-bot")
    sandbox.git(with_bot, "config", "claude.botEmail", "bot@example.com")
    without_bot = sandbox.new_repo("example-without-bot")

    result = sandbox.run("hooks-path", "harness", "--repo", str(with_bot), "--repo", str(without_bot))

    assert result.returncode == 0, result.stderr
    hooks = str(sandbox.current / "githooks")
    assert sandbox.hooks_path(with_bot) == hooks
    assert sandbox.hooks_path(without_bot) == hooks
    assert f"{without_bot} sets no claude.botEmail" in result.stderr
    assert f"{with_bot} sets no claude.botEmail" not in result.stderr


def test_hooks_path_refuses_before_the_harness_is_installed(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")

    result = sandbox.run("hooks-path", "--repo", str(repo))

    assert result.returncode == 1
    assert "the harness is not installed" in result.stderr
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
    assert sandbox.run("harness", env=env).returncode == 0

    replaced = sandbox.run("hooks-path", "--repo", str(repo), env=env)
    repeated = sandbox.run("hooks-path", "--repo", str(repo), env=env)

    assert replaced.returncode == 0, replaced.stderr
    assert f"{repo} had core.hooksPath /example/old hooks" in replaced.stdout
    assert f"to restore it: git -C {repo} {restore}\n" in replaced.stdout
    assert sandbox.hooks_path(repo) == str(sandbox.current / "githooks")
    assert repeated.returncode == 0, repeated.stderr
    assert "had core.hooksPath" not in repeated.stdout


def test_hooks_path_names_the_repository_hooks_that_stop_running(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")
    hooks_dir = repo / ".git/hooks"
    hooks_dir.mkdir(exist_ok=True)
    for name in ("pre-commit", "pre-push.sample"):
        (hooks_dir / name).write_text("#!/bin/sh\n")
        (hooks_dir / name).chmod(0o755)
    assert sandbox.run("harness").returncode == 0

    result = sandbox.run("hooks-path", "--repo", str(repo))

    assert result.returncode == 0, result.stderr
    assert f"warning: {repo} stops running pre-commit from {hooks_dir}\n" in result.stderr
    assert "pre-push.sample" not in result.stderr


def test_hooks_path_ignores_a_git_dir_in_the_environment(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")
    other = sandbox.new_repo("example-other")
    assert sandbox.run("harness").returncode == 0

    result = sandbox.run("hooks-path", "--repo", str(repo), env={"GIT_DIR": str(other / ".git")})

    assert result.returncode == 0, result.stderr
    assert sandbox.hooks_path(repo) == str(sandbox.current / "githooks")
    assert sandbox.hooks_path(other) is None


def test_hooks_path_refuses_a_directory_inside_a_repository(sandbox: Sandbox) -> None:
    named_first = sandbox.new_repo("example-first")
    outer = sandbox.new_repo("example-outer")
    inner = outer / "example-subdirectory"
    inner.mkdir()

    result = sandbox.run("harness", "hooks-path", "--repo", str(named_first), "--repo", str(inner))

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

    result = sandbox.run("harness", "hooks-path", "--repo", str(repo))

    assert result.returncode == 1
    assert "reads core.hooksPath as /example/override" in result.stderr
    assert "installed before it: harness" in result.stderr
    assert (sandbox.current / "githooks/pre-push").exists()


def test_skills_links_each_skill_and_leaves_other_skills(sandbox: Sandbox) -> None:
    own = sandbox.skills / "example-own/SKILL.md"
    own.parent.mkdir(parents=True)
    own.write_bytes(b"example own skill\n")

    result = sandbox.run("harness", "skills")
    rerun = sandbox.run("skills")

    assert result.returncode == 0, result.stderr
    assert sorted(path.name for path in sandbox.skills.iterdir()) == ["example-alpha", "example-beta", "example-own"]
    for name in ("example-alpha", "example-beta"):
        assert (sandbox.skills / name).readlink() == sandbox.current / "skills" / name
    assert (sandbox.skills / "example-alpha/SKILL.md").read_bytes() == ALPHA_SKILL
    assert own.read_bytes() == b"example own skill\n"
    assert rerun.returncode == 0, rerun.stderr
    assert "linked" not in rerun.stdout


def test_skill_name_already_taken_refuses_with_nothing_linked(sandbox: Sandbox) -> None:
    taken = sandbox.skills / "example-beta"
    taken.mkdir(parents=True)

    result = sandbox.run("harness", "skills")

    assert result.returncode == 1
    assert f"{taken} already exist and are not links into" in result.stderr
    assert "installed before it: harness" in result.stderr
    assert sorted(path.name for path in sandbox.skills.iterdir()) == ["example-beta"]


def test_skill_dropped_by_a_new_version_loses_only_its_link(sandbox: Sandbox) -> None:
    assert sandbox.run("harness", "skills").returncode == 0
    (sandbox.skills / "example-own-dangling").symlink_to(sandbox.root / "example-moved-skill")
    shutil.rmtree(sandbox.clone / "harness/skills/example-beta")
    sandbox.set_version("0.2.0")
    sandbox.commit("Drop the example beta skill")

    result = sandbox.run("harness", "skills")

    assert result.returncode == 0, result.stderr
    assert f"removed {sandbox.skills / 'example-beta'}" in result.stdout
    assert sorted(path.name for path in sandbox.skills.iterdir()) == ["example-alpha", "example-own-dangling"]


def test_skills_directory_linked_outside_claude_refuses_with_nothing_written(sandbox: Sandbox) -> None:
    elsewhere = sandbox.root / "example-elsewhere"
    elsewhere.mkdir()
    sandbox.skills.parent.mkdir()
    sandbox.skills.symlink_to(elsewhere)

    result = sandbox.run("harness", "skills")

    assert result.returncode == 1
    assert f"{sandbox.skills} resolves to {elsewhere.resolve()}, outside" in result.stderr
    assert list(elsewhere.iterdir()) == []
    assert not sandbox.install.exists()


def test_skills_refuses_before_the_harness_is_installed(sandbox: Sandbox) -> None:
    result = sandbox.run("skills")

    assert result.returncode == 1
    assert "the harness is not installed" in result.stderr
    assert not sandbox.skills.exists()


def test_fragment_import_goes_inside_the_block_through_a_link_only_on_yes(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    own = sandbox.root / "example-own-claude.md"
    before = f"# Example rules\r\n\n{BLOCK_START}\n@~/example-other.md\n{BLOCK_END}\nexample last line"
    own.write_bytes(before.encode())
    sandbox.claude_md.symlink_to(own)

    declined = sandbox.run("fragment:example-rules", stdin="n\n")
    declined_text = own.read_bytes().decode()
    written = sandbox.run("fragment:example-rules", stdin="y\n")
    rerun = sandbox.run("fragment:example-rules")

    assert declined.returncode == 1
    assert f"not written, so {own} is unchanged" in declined.stderr
    assert f"\n+{EXAMPLE_IMPORT}\n" in declined.stdout
    assert declined_text == before
    assert written.returncode == 0, written.stderr
    assert sandbox.claude_md.is_symlink()
    assert sandbox.claude_md.readlink() == own
    after = f"# Example rules\r\n\n{BLOCK_START}\n@~/example-other.md\n{EXAMPLE_IMPORT}\n{BLOCK_END}\nexample last line"
    assert own.read_bytes().decode() == after
    assert rerun.returncode == 0, rerun.stderr
    assert "already imports" in rerun.stdout


def test_fragment_import_pasted_outside_any_block_is_left_alone(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    before = f"# Example rules\n{EXAMPLE_IMPORT}\n"
    sandbox.claude_md.write_text(before)

    result = sandbox.run("fragment:example-rules")

    assert result.returncode == 0, result.stderr
    assert "already imports" in result.stdout
    assert sandbox.claude_md.read_text() == before


@pytest.mark.parametrize("template", ["# Example template\n", None], ids=["template", "no-template"])
def test_missing_claude_md_starts_from_the_harness_template(sandbox: Sandbox, template: str | None) -> None:
    if template is not None:
        sandbox.write("harness/claude-md-template.md", template.encode())
        sandbox.commit("Add an example template")

    result = sandbox.run("harness", "fragment:example-rules", stdin="y\n")

    assert result.returncode == 0, result.stderr
    block = f"{BLOCK_START}\n{EXAMPLE_IMPORT}\n{BLOCK_END}\n"
    assert sandbox.claude_md.read_text() == (block if template is None else f"{template}\n{block}")


def test_shipped_template_holds_the_markers_bootstrap_writes_between() -> None:
    # A template whose markers drifted from bootstrap's would get a second block appended at its end.
    template = (SCRIPT.parent / "harness" / "claude-md-template.md").read_text().splitlines()
    assert template.index(BLOCK_START) + 1 == template.index(BLOCK_END)


@pytest.mark.parametrize(
    ("component", "relative", "content", "target"),
    [
        ("fragment:example-later", "fragments/example-later.md", b"example later rules\n", ".claude/CLAUDE.md"),
        ("settings:example-later", "settings/example-later.json", b"{}\n", ".claude/settings.json"),
    ],
    ids=["fragment", "settings"],
)
def test_fragment_missing_from_the_installed_harness_refuses_with_nothing_installed(
    sandbox: Sandbox, component: str, relative: str, content: bytes, target: str
) -> None:
    assert sandbox.run("harness").returncode == 0
    sandbox.write(f"harness/{relative}", content)
    sandbox.set_version("0.2.0")
    sandbox.commit("Add a later example fragment")

    result = sandbox.run("skills", component)

    assert result.returncode == 1
    assert f"the installed harness has no {sandbox.current / relative}" in result.stderr
    assert not sandbox.skills.exists()
    assert not (sandbox.home / target).exists()


def test_unmatched_block_marker_refuses_with_nothing_installed(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    before = f"{BLOCK_START}\nexample line\n"
    sandbox.claude_md.write_text(before)

    result = sandbox.run("skills", "fragment:example-rules")

    assert result.returncode == 1
    assert "fix the markers by hand" in result.stderr
    assert not sandbox.skills.exists()
    assert sandbox.claude_md.read_text() == before


def test_settings_merge_adds_only_what_is_missing_through_a_link_only_on_yes(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    own = sandbox.root / "example-own-settings.json"
    existing = {
        "permissions": {"allow": ["Bash(ls)"], "deny": ["Read(./example-secret)", "Read(./example-own)"]},
        "model": "example-own-model",
        "exampleOther": {"kept": True},
    }
    before = json.dumps(existing, indent=4) + "\n"
    own.write_text(before)
    settings = sandbox.home / ".claude/settings.json"
    settings.symlink_to(own)

    declined = sandbox.run("settings:example-deny", stdin="n\n")
    declined_text = own.read_text()
    written = sandbox.run("settings:example-deny", stdin="y\n")
    rerun = sandbox.run("settings:example-deny")

    assert declined.returncode == 1
    assert '\n+            "Read(./example-key)"\n' in declined.stdout
    assert declined_text == before
    assert written.returncode == 0, written.stderr
    assert settings.readlink() == own
    merged = {
        "permissions": {
            "allow": ["Bash(ls)"],
            "deny": ["Read(./example-secret)", "Read(./example-own)", "Read(./example-key)"],
            "defaultMode": "example-mode",
        },
        "model": "example-own-model",
        "exampleOther": {"kept": True},
    }
    assert own.read_text() == json.dumps(merged, indent=4) + "\n"
    assert rerun.returncode == 0, rerun.stderr
    assert "already has everything" in rerun.stdout


def test_missing_settings_file_is_written_from_the_fragment(sandbox: Sandbox) -> None:
    result = sandbox.run("harness", "settings:example-deny", stdin="y\n")

    assert result.returncode == 0, result.stderr
    assert (sandbox.home / ".claude/settings.json").read_text() == json.dumps(SETTINGS_FRAGMENT, indent=2) + "\n"


def test_settings_not_an_object_refuses_with_nothing_installed(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    settings = sandbox.home / ".claude/settings.json"
    settings.write_text("[]")

    result = sandbox.run("skills", "settings:example-deny", stdin="y\n")

    assert result.returncode == 1
    assert f"{settings} is not a JSON object" in result.stderr
    assert not sandbox.skills.exists()
    assert settings.read_text() == "[]"


def test_settings_the_fragment_cannot_merge_into_refuses_unchanged(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    settings = sandbox.home / ".claude/settings.json"
    content = '{"permissions": {"deny": "example"}}'
    settings.write_text(content)

    result = sandbox.run("settings:example-deny", stdin="y\n")

    assert result.returncode == 1
    assert f"permissions.deny in {settings} is not a list" in result.stderr
    assert settings.read_text() == content


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        (["harness", "example-unknown"], "unknown component example-unknown"),
        (["harness", "--repo", "{repo}"], "--repo is used only by hooks-path"),
        (["harness", "hooks-path"], "hooks-path needs --repo"),
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


def test_plugin_writes_its_templates_as_example_files_and_lists_them(sandbox: Sandbox) -> None:
    sandbox.write("plugins/example-one/local.example/example-rules.md", b"example rules template\n")
    sandbox.write("plugins/example-one/local.example/example-nested/example-deep.md", b"example deep template\n")
    sandbox.commit("Add example templates")
    sandbox.write("plugins/example-one/local.example/example-rules.md", b"example uncommitted edit\n")
    sandbox.write("plugins/example-one/local.example/example-untracked.md", b"example untracked\n")
    local = sandbox.home / ".claude/local"

    result = sandbox.run("plugin:example-one", "plugin:example-two")

    assert result.returncode == 0, result.stderr
    rules = local / "example-one/example-rules.md.example"
    deep = local / "example-one/example-nested/example-deep.md.example"
    assert sorted(path for path in local.rglob("*") if path.is_file()) == sorted([rules, deep])
    assert rules.read_bytes() == b"example rules template\n"
    assert deep.read_bytes() == b"example deep template\n"
    assert f"plugin:example-one: wrote {rules}\n" in result.stdout
    installed, _, listed = result.stdout.partition(TEMPLATES_HEADER)
    assert installed.endswith("Installed plugin:example-one, plugin:example-two.\n")
    assert sorted(listed.splitlines()) == sorted([str(rules), str(deep)])


def test_plugin_template_keeps_what_exists_and_writes_through_a_linked_local(sandbox: Sandbox) -> None:
    for name in ("example-kept.md", "example-filled.md", "example-linked.md"):
        sandbox.write(f"plugins/example-one/local.example/{name}", b"example template\n")
    sandbox.commit("Add example templates")
    own = sandbox.root / "example-own-local/example-one"
    own.mkdir(parents=True)
    (own / "example-kept.md.example").write_bytes(b"example own edit\n")
    (own / "example-filled.md").write_bytes(b"example own rules\n")
    link_target = sandbox.root / "example-link-target"
    (own / "example-linked.md.example").symlink_to(link_target)
    local = sandbox.home / ".claude/local"
    local.parent.mkdir()
    local.symlink_to(own.parent)

    result = sandbox.run("plugin:example-one")
    rerun = sandbox.run("plugin:example-one")

    assert result.returncode == 0, result.stderr
    assert (own / "example-kept.md.example").read_bytes() == b"example own edit\n"
    assert (own / "example-filled.md").read_bytes() == b"example own rules\n"
    assert (own / "example-filled.md.example").read_bytes() == b"example template\n"
    assert not os.path.lexists(link_target)
    assert f"kept {local / 'example-one/example-kept.md.example'}, which already exists" in result.stdout
    assert f"kept {local / 'example-one/example-linked.md.example'}, which already exists" in result.stdout
    assert result.stdout.endswith(f"{TEMPLATES_HEADER}{local / 'example-one/example-filled.md.example'}\n")
    assert rerun.returncode == 0, rerun.stderr
    assert TEMPLATES_HEADER not in rerun.stdout


def test_symlink_in_plugin_templates_stops_the_run_before_anything_installs(sandbox: Sandbox) -> None:
    # The regular file sorts before the link, so a copy that refuses only on reaching the link has written it.
    sandbox.write("plugins/example-two/local.example/example-a-rules.md", b"example rules template\n")
    (sandbox.clone / "plugins/example-two/local.example/example-link").symlink_to("example-a-rules.md")
    sandbox.commit("Add an example template symlink")

    result = sandbox.run("plugin:example-one", "plugin:example-two")

    assert result.returncode == 1
    assert "plugins/example-two/local.example/example-link in HEAD is not a regular file (mode 120000)" in result.stderr
    assert not (sandbox.home / ".claude/local").exists()
    assert sandbox.claude_calls() == []


def test_failing_claude_command_stops_the_run_before_its_templates(sandbox: Sandbox) -> None:
    sandbox.write("plugins/example-one/local.example/example-rules.md", b"example rules template\n")
    sandbox.commit("Add an example template")

    result = sandbox.run("plugin:example-one", "plugin:example-two", env={"EXAMPLE_CLAUDE_FAIL": "install"})

    assert result.returncode == 1
    assert "claude plugin install example-one@example-market exited 3" in result.stderr
    assert sandbox.claude_calls() == [MARKETPLACE_ADD, ["plugin", "install", "example-one@example-market"]]
    assert not (sandbox.home / ".claude/local").exists()


@pytest.mark.parametrize("in_settings", [False, True], ids=["shell", "settings"])
def test_plugin_dirs_warns_once(sandbox: Sandbox, in_settings: bool) -> None:
    value = str(sandbox.root / "example-plugin-dirs")
    env = {"CLAUDE_CODE_PLUGIN_DIRS": value}
    if in_settings:
        env = {}
        (sandbox.home / ".claude").mkdir()
        (sandbox.home / ".claude/settings.json").write_text(json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": value}}))

    result = sandbox.run("plugin:example-one", "plugin:example-two", env=env)

    assert result.returncode == 0, result.stderr
    assert result.stderr.count(f"CLAUDE_CODE_PLUGIN_DIRS is {value}") == 1
    assert sandbox.claude_calls() == [
        MARKETPLACE_ADD,
        ["plugin", "install", "example-one@example-market"],
        ["plugin", "install", "example-two@example-market"],
    ]


def test_claude_missing_from_path_refuses_with_nothing_installed(sandbox: Sandbox) -> None:
    git_only = sandbox.root / "example-git-only"
    git_only.mkdir()
    (git_only / "git").symlink_to(shutil.which("git", path=sandbox.env["PATH"]))

    result = sandbox.run("harness", "plugin:example-one", env={"PATH": str(git_only)})

    assert result.returncode == 1
    assert "claude is not on PATH, and plugin components run it" in result.stderr
    assert not sandbox.install.exists()


def test_settings_not_an_object_stops_before_any_claude_call(sandbox: Sandbox) -> None:
    settings = sandbox.home / ".claude/settings.json"
    settings.parent.mkdir()
    settings.write_text("[]")

    result = sandbox.run("plugin:example-one")

    assert result.returncode == 1
    assert f"{settings} is not a JSON object" in result.stderr
    assert sandbox.claude_calls() == []


def test_prompt_installs_what_was_answered_yes(sandbox: Sandbox) -> None:
    # harness, skills, the fragment, the settings, then the three plugins; hooks-path is not offered without --repo.
    result = sandbox.run(stdin="y\nn\nn\nn\nn\ny\nn\n")

    assert result.returncode == 0, result.stderr
    assert "Install hooks-path" not in result.stdout
    assert (sandbox.current / "githooks/pre-push").exists()
    assert not sandbox.skills.exists()
    assert sandbox.claude_calls() == [MARKETPLACE_ADD, ["plugin", "install", "example-two@example-market"]]


def test_prompt_without_stdin_stops(sandbox: Sandbox) -> None:
    result = sandbox.run()

    assert result.returncode == 1
    assert "no answer on stdin; name the components on the command line" in result.stderr
    assert not sandbox.install.exists()
    assert sandbox.claude_calls() == []
