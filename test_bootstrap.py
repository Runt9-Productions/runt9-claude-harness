"""Runs bootstrap.py as a user does: from outside a synthetic clone, with HOME in a temporary directory and a stub
claude on PATH that records each call, answers `plugin list --json` from a canned file, and moves a version there on
`plugin update` only when told to. Every git call runs without the machine's global and system config.
`updated_settings` is also called directly, since its cases are many and need no run, and so are the menu's scroll
and its Markdown unwrapping, which the terminal text cannot show. The menu runs on a pseudo-terminal as TERM=xterm.
Needs git, pytest and the xterm terminfo entry.
"""

import errno
import fcntl
import json
import os
import pty
import re
import select
import shutil
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

import pytest

from bootstrap.menu import MenuState, unwrapped, wrapped
from bootstrap.registry import all_components
from bootstrap.settings import updated_settings

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
TERMINAL_TIMEOUT = 15
# An escape sequence (CSI, OSC, a character set choice or a two-byte one) or any other control character.
TERMINAL_CODE = re.compile(r"\x1b(\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07|[()][0-9A-Za-z]|.)|[\x00-\x1f]")
# What xterm sends for Down and Right once curses has switched its cursor keys to application mode.
DOWN = b"\x1bOB"
RIGHT = b"\x1bOC"
STUB = """#!{python}
import json, os, sys
with open({log!r}, "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\\n")
fail = os.environ.get("EXAMPLE_CLAUDE_FAIL")
if fail and sys.argv[1:3] == ["plugin", fail]:
    sys.exit(3)
if sys.argv[1:] == ["plugin", "list", "--json"]:
    print(open({plugins!r}).read() if os.path.exists({plugins!r}) else "[]")
if sys.argv[1:3] == ["plugin", "update"] and os.path.exists({moves!r}):
    moved = json.load(open({moves!r}))
    listed = json.load(open({plugins!r}))
    for entry in listed:
        if entry["id"] == sys.argv[3] and entry["id"] in moved:
            entry["version"] = moved[entry["id"]]
    json.dump(listed, open({plugins!r}, "w"))
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
        self.plugins = root / "example-plugin-list.json"
        self.moves = root / "example-plugin-moves.json"
        bin_dir = root / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "claude"
        stub.write_text(
            STUB.format(python=sys.executable, log=str(self.log), plugins=str(self.plugins), moves=str(self.moves))
        )
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

    def run_in_terminal(self, *args: str, rows: int = 24, env: dict[str, str] | None = None) -> "Terminal":
        """Starts bootstrap.py with a pseudo-terminal of `rows` by 80 as its stdin, stdout and stderr."""
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, 80, 0, 0))
        process = subprocess.Popen(
            [sys.executable, str(self.clone / "bootstrap.py"), *args],
            cwd=self.root,
            env={**self.env, "TERM": "xterm", **(env or {})},
            stdin=slave,
            stdout=slave,
            stderr=slave,
        )
        os.close(slave)
        return Terminal(process, master)

    def list_plugins(self, versions: dict[str, str]) -> None:
        """Sets what the stub's `plugin list --json` prints: each plugin in `versions` from the example marketplace,
        and one from another marketplace."""
        listed = [{"id": f"{name}@example-market", "version": version} for name, version in versions.items()]
        listed.append({"id": "example-one@example-elsewhere", "version": "9.9.9"})
        self.plugins.write_text(json.dumps(listed))

    def move_on_update(self, versions: dict[str, str]) -> None:
        """Makes the stub's `plugin update` of each plugin in `versions` list it at that version afterwards. Any other
        plugin stays where it was, as when GitHub's copy is older than the checkout."""
        moves = {f"{name}@example-market": version for name, version in versions.items()}
        self.moves.write_text(json.dumps(moves))

    def set_plugin_version(self, name: str, version: str) -> None:
        self.write(
            f"plugins/{name}/.claude-plugin/plugin.json", json.dumps({"name": name, "version": version}).encode()
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


class Terminal:
    """A run on a pseudo-terminal. What it prints is read as text with each escape sequence and control character
    taken as a space and each run of spaces as one, so a row curses paints whole reads as it shows, while one it
    repaints in part may not."""

    def __init__(self, process: subprocess.Popen, master: int) -> None:
        self.process = process
        self.master = master
        self.printed = b""
        self.since_keys = 0

    def __enter__(self) -> "Terminal":
        return self

    def __exit__(self, *exception: object) -> None:
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        os.close(self.master)

    def text(self, start: int = 0) -> str:
        spaced = TERMINAL_CODE.sub(" ", self.printed[start:].decode(errors="replace"))
        return " ".join(spaced.split())

    def read(self, deadline: float) -> bool:
        """Adds what the run prints next to `printed`; False once the time is up or the run has closed its end."""
        ready, _, _ = select.select([self.master], [], [], max(deadline - time.monotonic(), 0))
        if not ready:
            return False
        try:
            chunk = os.read(self.master, 65536)
        except OSError as error:
            # Linux reads the master of a terminal no process holds open any more as EIO.
            if error.errno != errno.EIO:
                raise
            return False
        self.printed += chunk
        return bool(chunk)

    def expect(self, text: str) -> None:
        """Waits for `text` in what the run printed since the last keys were sent."""
        deadline = time.monotonic() + TERMINAL_TIMEOUT
        while text not in self.text(self.since_keys):
            assert self.read(deadline), f"{text!r} never showed; the run printed {self.text()!r}"

    def send(self, keys: bytes) -> None:
        self.since_keys = len(self.printed)
        os.write(self.master, keys)

    def wait(self) -> int:
        deadline = time.monotonic() + TERMINAL_TIMEOUT
        while self.read(deadline):
            pass
        return self.process.wait(timeout=max(deadline - time.monotonic(), 0))


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    box = Sandbox(tmp_path)
    box.git(tmp_path, "init", "--quiet", "--bare", "-b", "main", str(tmp_path / "origin.git"))
    box.git(tmp_path, "init", "--quiet", "-b", "main", str(box.clone))
    box.git(box.clone, "remote", "add", "origin", str(tmp_path / "origin.git"))
    shutil.copy(SCRIPT, box.clone / "bootstrap.py")
    shutil.copytree(SCRIPT.parent / "bootstrap", box.clone / "bootstrap", ignore=shutil.ignore_patterns("__pycache__"))
    box.write(".claude-plugin/marketplace.json", json.dumps(MARKETPLACE).encode())
    for plugin in MARKETPLACE["plugins"]:
        box.set_plugin_version(plugin["name"], "1.0.0")
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
    lines = result.stdout.splitlines()
    names = [line.split()[0] for line in lines]
    assert names == [
        "harness",
        "hooks-path",
        "skills",
        "fragment:example-rules",
        "settings:example-deny",
        "plugin:example-one",
        "plugin:example-two",
        "plugin:example-three",
        "all",
    ]
    widest = len("fragment:example-rules")
    assert lines[-1] == f"{'all':<{widest}}  every component above, in this order; hooks-path only with --repo"


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


def test_settings_update_follows_the_new_fragment_and_keeps_what_the_user_set_or_removed() -> None:
    old = {
        "permissions": {
            "deny": ["Read(./example-reworded)", "Read(./example-same)", "Read(./example-removed)"],
            "ask": ["Bash(example-ask)"],
        },
        "model": "example-old-model",
        "theme": "example-old-theme",
        "exampleDropped": "example-dropped",
        "exampleRemoved": "example-old-removed",
    }
    new = {
        "permissions": {
            "deny": ["Read(./example-rewording)", "Read(./example-same)", "Read(./example-removed)"],
            "ask": ["Bash(example-ask)", "Bash(example-ask-new)"],
            "allow": ["Bash(example)"],
        },
        "model": "example-new-model",
        "theme": "example-new-theme",
        "exampleRemoved": "example-new-removed",
    }
    settings = {
        "permissions": {
            "deny": ["Read(./example-reworded)", "Read(./example-same)", "Read(./example-own)"],
            "allow": ["Bash(ls)"],
        },
        "model": "example-old-model",
        "theme": "example-own-theme",
        "exampleDropped": "example-dropped",
        "exampleOwn": True,
    }
    before = json.dumps(settings)

    updated = updated_settings(settings, old, new)

    assert updated == {
        "permissions": {
            "deny": ["Read(./example-same)", "Read(./example-own)", "Read(./example-rewording)"],
            "allow": ["Bash(ls)", "Bash(example)"],
        },
        "model": "example-new-model",
        "theme": "example-own-theme",
        "exampleOwn": True,
    }
    assert json.dumps(settings) == before


def test_settings_update_removes_what_it_empties_and_keeps_what_the_user_had_empty() -> None:
    old = {"permissions": {"deny": ["Read(./example-dropped)"]}, "exampleObject": {"exampleKey": "example"}}
    settings = {"permissions": {"deny": ["Read(./example-dropped)"]}, "exampleObject": {}}

    assert updated_settings(settings, old, {}) == {"exampleObject": {}}


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        (["harness", "example-unknown"], "unknown component example-unknown"),
        (["harness", "--repo", "{repo}"], "--repo is used only by hooks-path"),
        (["harness", "hooks-path"], "hooks-path needs --repo"),
        (["all", "harness"], "all names every component; name no others with it"),
    ],
    ids=["unknown-component", "repo-without-hooks-path", "hooks-path-without-repo", "all-beside-a-name"],
)
def test_usage_error_installs_nothing(sandbox: Sandbox, args: list[str], reason: str) -> None:
    repo = sandbox.new_repo("example-repo")

    result = sandbox.run(*[arg.format(repo=repo) for arg in args])

    assert result.returncode == 1
    assert reason in result.stderr
    assert not sandbox.install.exists()


def test_all_without_repo_installs_every_other_component_in_order(sandbox: Sandbox) -> None:
    # The fragment's import and the settings merge each ask before writing.
    result = sandbox.run("all", stdin="y\ny\n")

    assert result.returncode == 0, result.stderr
    assert "Not offering hooks-path: run python3 bootstrap.py hooks-path --repo <path>\n" in result.stdout
    assert (
        "Installed harness, skills, fragment:example-rules, settings:example-deny, "
        "plugin:example-one, plugin:example-two, plugin:example-three.\n"
    ) in result.stdout
    assert sandbox.claude_calls() == [
        MARKETPLACE_ADD,
        ["plugin", "install", "example-one@example-market"],
        ["plugin", "install", "example-two@example-market"],
        ["plugin", "install", "example-three@example-market"],
    ]


def test_all_with_repo_sets_hooks_path(sandbox: Sandbox) -> None:
    repo = sandbox.new_repo("example-repo")

    result = sandbox.run("all", "--repo", str(repo), stdin="y\ny\n")

    assert result.returncode == 0, result.stderr
    assert "Not offering" not in result.stdout
    assert sandbox.hooks_path(repo) == str(sandbox.current / "githooks")


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


DESCRIPTIONS = """
import json
from bootstrap.registry import all_components
print(json.dumps({component.name: component.description() for component in all_components()}))
"""


def test_descriptions_come_from_the_docs_in_head_and_are_empty_where_a_doc_is_missing(sandbox: Sandbox) -> None:
    sandbox.write(
        "README.md",
        b"# Example\n\n| Component | Example other column |\n|---|---|\n| `harness` | Example other text. |\n"
        b"\n| Component | Installs |\n|---|---|\n| `harness` | Example text. |\n",
    )
    sandbox.write(
        "plugins/example-one/README.md",
        b"# example-one\n\nFirst example plugin,\nwrapped over two lines.\n\nA second paragraph.\n",
    )
    sandbox.commit("Example docs")
    sandbox.write("README.md", b"| `harness` | Example uncommitted text. |\n")

    result = subprocess.run(
        [sys.executable, "-c", DESCRIPTIONS], cwd=sandbox.clone, env=sandbox.env, capture_output=True, text=True
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "harness": "Example text.",
        "hooks-path": "",
        "skills": "",
        "fragment:example-rules": "example rules\n",
        "settings:example-deny": "",
        "plugin:example-one": "First example plugin, wrapped over two lines.",
        "plugin:example-two": "",
        "plugin:example-three": "",
    }


def test_every_component_of_this_repository_has_a_description() -> None:
    # Empty when a doc row a component reads is renamed or dropped.
    undescribed = [component.name for component in all_components() if not component.description()]
    assert undescribed == []


PLUGIN_LIST = ["plugin", "list", "--json"]


def test_menu_installs_the_ticked_components_after_one_confirmation(sandbox: Sandbox) -> None:
    # Five rows above the footer, so moving down to plugin:example-two scrolls the list.
    with sandbox.run_in_terminal(rows=6) as terminal:
        terminal.expect("hooks-path needs --repo")
        # a twice ticks every row and clears them again. Then Space ticks harness, then hooks-path, which cannot be
        # ticked without --repo, then skills, then plugin:example-two.
        terminal.send(b"aa" + b" " + DOWN + b" " + DOWN + b" " + DOWN * 4 + b" \r")
        terminal.expect("Install harness, skills, plugin:example-two? [y/N]")
        terminal.send(b"y\r")
        installed = terminal.wait()
        installed_text = terminal.text()
    # A skill only HEAD has leaves the skills current: they follow the installed harness, not HEAD.
    sandbox.write("harness/skills/example-gamma/SKILL.md", b"example gamma skill\n")
    sandbox.set_version("0.2.0")
    sandbox.commit("Raise the example version and add an example skill")
    sandbox.list_plugins({"example-two": "1.0.0"})
    with sandbox.run_in_terminal() as terminal:
        terminal.expect("harness behind")
        terminal.expect("skills installed")
        terminal.expect("plugin:example-two installed")
        # a ticks every row but hooks-path, then Space unticks harness.
        terminal.send(b"a \r")
        terminal.expect(
            "Install skills, fragment:example-rules, settings:example-deny, plugin:example-one, plugin:example-two,"
            " plugin:example-three? [y/N]"
        )
        terminal.send(b"n\r")
        declined = terminal.wait()
        declined_text = terminal.text()

    assert installed == 0, installed_text
    assert "Installed harness, skills, plugin:example-two." in installed_text
    assert sandbox.claude_calls() == [
        PLUGIN_LIST,
        MARKETPLACE_ADD,
        ["plugin", "install", "example-two@example-market"],
        PLUGIN_LIST,
    ]
    assert declined == 0, declined_text
    assert declined_text.endswith("Nothing picked.")
    assert sandbox.current.readlink() == Path("versions/0.1.0")


def test_menu_opens_whatever_the_survey_cannot_read_and_shows_full_descriptions(sandbox: Sandbox) -> None:
    # Taller than the terminal, so its last item shows only once the view scrolls.
    items = "".join(f"- Example item {number} of 30\n" for number in range(1, 31))
    fragment = f"## Example rules\n\nShown whole in the description view.\n\n{items}"
    sandbox.write("harness/fragments/example-rules.md", fragment.encode())
    # The plugins step marks plugin:example-one, then stops at example-two's manifest, which has no version.
    sandbox.write("plugins/example-two/.claude-plugin/plugin.json", b'{"name": "example-two"}')
    sandbox.commit("Example fragment text and an example manifest without a version")
    sandbox.list_plugins({"example-one": "1.0.0", "example-two": "1.0.0"})

    with sandbox.run_in_terminal() as terminal:
        terminal.expect("plugin:example-three")
        # Unmarked, like every row of the step that stopped.
        terminal.expect("plugin:example-one first example")
        terminal.send(DOWN * 3 + b"?")
        terminal.expect("Shown whole in the description view.")
        terminal.send(DOWN * 20)
        terminal.expect("Example item 30 of 30")
        # Back to the list, then down to plugin:example-one, which has no README.
        terminal.send(b"x" + DOWN * 2 + RIGHT)
        terminal.expect("no description found")
        terminal.send(b"xq")
        quit_code = terminal.wait()
        text = terminal.text()

    assert quit_code == 0, text
    assert text.endswith("Nothing picked.")


def test_menu_scrolls_just_far_enough_to_show_the_cursor() -> None:
    # Called directly: the terminal text cannot tell which rows a scroll left on screen.
    state = MenuState(rows=[])
    state.cursor = 6
    state.scroll(5)
    scrolled_down = state.top
    state.cursor = 1
    state.scroll(5)

    assert scrolled_down == 2
    assert state.top == 1


def test_description_joins_hard_wrapped_markdown_and_indents_wrapped_list_items() -> None:
    # Called directly: the terminal text reads the same however a paragraph is split across rows.
    text = (
        "## Example\n\nA paragraph wrapped\nover two lines.\n\n- An item wrapped\n  over two lines.\n- A second item.\n"
        "\n| `example-a` | example |\n| `example-b` | example |\n\n### Example heading\nA line under it.\n"
    )

    lines = unwrapped(text)

    assert lines == [
        "## Example",
        "",
        "A paragraph wrapped over two lines.",
        "",
        "- An item wrapped over two lines.",
        "- A second item.",
        "",
        "| `example-a` | example |",
        "| `example-b` | example |",
        "",
        "### Example heading",
        "A line under it.",
    ]
    assert wrapped(lines[4], 20) == ["- An item wrapped", "  over two lines."]


def test_menu_stops_on_a_terminal_curses_cannot_drive(sandbox: Sandbox) -> None:
    with sandbox.run_in_terminal(env={"TERM": "example-unknown"}) as terminal:
        exit_code = terminal.wait()
        text = terminal.text()

    assert exit_code == 1
    assert "the menu needs a terminal curses can drive; check TERM" in text


def test_prompt_without_stdin_stops(sandbox: Sandbox) -> None:
    result = sandbox.run()

    assert result.returncode == 1
    assert "no answer on stdin; name the components on the command line" in result.stderr
    assert not sandbox.install.exists()
    assert sandbox.claude_calls() == []


def test_update_with_nothing_behind_reports_each_component_and_asks_nothing(sandbox: Sandbox) -> None:
    assert (
        sandbox.run("harness", "skills", "fragment:example-rules", "settings:example-deny", stdin="y\ny\n").returncode
        == 0
    )
    # One entry of the fragment left is enough for it to count as installed.
    (sandbox.home / ".claude/settings.json").write_text(json.dumps({"permissions": {"deny": ["Read(./example-key)"]}}))
    sandbox.list_plugins({"example-one": "1.0.0"})

    result = sandbox.run("--update")

    assert result.returncode == 0, result.stderr
    assert result.stdout == (
        "harness: current\n"
        "skills: current\n"
        "fragment:example-rules: current\n"
        "settings:example-deny: current\n"
        "plugin:example-one: current\n"
        "available: plugin:example-two, plugin:example-three\n"
        "Everything installed is current.\n"
    )
    assert sandbox.claude_calls() == [PLUGIN_LIST]


def test_update_moves_the_harness_to_a_new_version_and_relinks_its_skills(sandbox: Sandbox) -> None:
    assert sandbox.run("harness", "skills").returncode == 0
    sandbox.write("harness/skills/example-gamma/SKILL.md", b"example gamma skill\n")
    shutil.rmtree(sandbox.clone / "harness/skills/example-beta")
    sandbox.set_version("0.2.0")
    sandbox.commit("Add an example gamma skill and drop example beta")

    result = sandbox.run("--update", stdin="y\n")

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith(
        "harness: 0.1.0 to 0.2.0\n"
        "skills: link example-gamma; unlink example-beta\n"
        "available: fragment:example-rules, settings:example-deny, plugin:example-one, plugin:example-two,"
        " plugin:example-three\n"
        "Update harness, skills? [y/N] "
    )
    assert sandbox.current.readlink() == Path("versions/0.2.0")
    assert (sandbox.skills / "example-gamma").readlink() == sandbox.current / "skills/example-gamma"
    assert (sandbox.skills / "example-gamma/SKILL.md").read_bytes() == b"example gamma skill\n"
    assert not os.path.lexists(sandbox.skills / "example-beta")


def test_update_moves_settings_to_the_new_fragments_and_keeps_what_the_user_added(sandbox: Sandbox) -> None:
    sandbox.write("harness/settings/example-ask.json", json.dumps({"permissions": {"ask": ["Bash(example)"]}}).encode())
    sandbox.commit("Add an example ask fragment")
    assert sandbox.run("harness").returncode == 0
    settings = sandbox.home / ".claude/settings.json"
    own = {
        "permissions": {
            "deny": ["Read(./example-secret)", "Read(./example-key)", "Read(./example-own)"],
            "defaultMode": "example-mode",
            "ask": ["Bash(example)"],
        },
        "model": "example-fragment-model",
        "exampleOwn": True,
    }
    settings.write_text(json.dumps(own, indent=2) + "\n")
    reworded = {
        "permissions": {
            "deny": ["Read(./example-secret)", "Read(./example-key-file)"],
            "defaultMode": "example-new-mode",
        },
        "model": "example-fragment-model",
    }
    sandbox.write("harness/settings/example-deny.json", json.dumps(reworded).encode())
    sandbox.write(
        "harness/settings/example-ask.json", json.dumps({"permissions": {"ask": ["Bash(example-new)"]}}).encode()
    )
    sandbox.set_version("0.2.0")
    sandbox.commit("Reword both example fragments")

    # The harness, then example-ask, then example-deny, whose change lands on top of example-ask's.
    result = sandbox.run("--update", stdin="y\ny\ny\n")

    assert result.returncode == 0, result.stderr
    assert "Apply settings:example-ask? [y/N] " in result.stdout
    assert "Apply settings:example-deny? [y/N] " in result.stdout
    assert json.loads(settings.read_text()) == {
        "permissions": {
            "deny": ["Read(./example-secret)", "Read(./example-own)", "Read(./example-key-file)"],
            "defaultMode": "example-new-mode",
            "ask": ["Bash(example-new)"],
        },
        "model": "example-fragment-model",
        "exampleOwn": True,
    }


def test_update_updates_a_newer_plugin_and_rewrites_its_changed_template(sandbox: Sandbox) -> None:
    sandbox.write("plugins/example-one/local.example/example-rules.md", b"example rules template\n")
    sandbox.commit("Add an example template")
    assert sandbox.run("plugin:example-one").returncode == 0
    local = sandbox.home / ".claude/local/example-one"
    (local / "example-rules.md").write_bytes(b"example own rules\n")
    sandbox.write("plugins/example-one/local.example/example-rules.md", b"example reworded template\n")
    sandbox.set_plugin_version("example-one", "1.1.0")
    sandbox.commit("Reword the example template")
    # Installed in two scopes, one of them already at HEAD's version.
    listed = [{"id": "example-one@example-market", "version": version} for version in ("1.0.0", "1.1.0")]
    sandbox.plugins.write_text(json.dumps(listed))
    sandbox.move_on_update({"example-one": "1.1.0"})
    sandbox.log.unlink()

    result = sandbox.run("--update", stdin="y\n")

    assert result.returncode == 0, result.stderr
    assert "plugin:example-one: 1.0.0, 1.1.0 to 1.1.0\n" in result.stdout
    assert sandbox.claude_calls() == [
        PLUGIN_LIST,
        ["plugin", "marketplace", "update", "example-market"],
        ["plugin", "update", "example-one@example-market"],
        PLUGIN_LIST,
    ]
    template = local / "example-rules.md.example"
    assert template.read_bytes() == b"example reworded template\n"
    assert (local / "example-rules.md").read_bytes() == b"example own rules\n"
    assert result.stdout.endswith(f"{TEMPLATES_HEADER}{template}\n")


def test_update_leaves_a_linked_or_unchanged_template_alone_and_adds_a_missing_one(sandbox: Sandbox) -> None:
    for name in ("example-linked.md", "example-same.md"):
        sandbox.write(f"plugins/example-one/local.example/{name}", b"example template\n")
    sandbox.commit("Add example templates")
    assert sandbox.run("plugin:example-one").returncode == 0
    local = sandbox.home / ".claude/local/example-one"
    linked = local / "example-linked.md.example"
    link_target = sandbox.root / "example-own-template"
    link_target.write_bytes(b"example own template\n")
    linked.unlink()
    linked.symlink_to(link_target)
    sandbox.write("plugins/example-one/local.example/example-linked.md", b"example reworded template\n")
    sandbox.write("plugins/example-one/local.example/example-added.md", b"example added template\n")
    sandbox.set_plugin_version("example-one", "1.1.0")
    sandbox.commit("Reword one example template and add another")
    sandbox.list_plugins({"example-one": "1.0.0"})
    sandbox.move_on_update({"example-one": "1.1.0"})

    result = sandbox.run("--update", stdin="y\n")

    assert result.returncode == 0, result.stderr
    assert linked.readlink() == link_target
    assert link_target.read_bytes() == b"example own template\n"
    added = local / "example-added.md.example"
    assert added.read_bytes() == b"example added template\n"
    assert result.stdout.endswith(f"{TEMPLATES_HEADER}{added}\n")


def test_update_declining_the_harness_holds_back_its_settings_and_reports_what_vanished(sandbox: Sandbox) -> None:
    sandbox.write("harness/settings/example-ask.json", json.dumps({"permissions": {"ask": ["Bash(example)"]}}).encode())
    sandbox.commit("Add an example ask fragment")
    installs = ("harness", "settings:example-ask", "settings:example-deny")
    assert sandbox.run(*installs, stdin="y\ny\n").returncode == 0
    settings = sandbox.home / ".claude/settings.json"
    installed = json.loads(settings.read_text())
    # The second import is the user's own file, outside the harness, so it is no fragment and never vanishes.
    sandbox.claude_md.write_text(f"{EXAMPLE_IMPORT}\n@~/example-notes/example-own.md\n")
    sandbox.write(
        "harness/settings/example-ask.json", json.dumps({"permissions": {"ask": ["Bash(example-new)"]}}).encode()
    )
    sandbox.write(
        "harness/settings/example-deny.json", json.dumps({**SETTINGS_FRAGMENT, "model": "example-new"}).encode()
    )
    (sandbox.clone / "harness/fragments/example-rules.md").unlink()
    sandbox.set_version("0.2.0")
    sandbox.set_plugin_version("example-one", "1.1.0")
    sandbox.commit("Change both example fragments and the example plugin, and drop the example rules")
    sandbox.list_plugins({"example-one": "1.0.0", "example-gone": "1.0.0"})

    # A no to the harness and the plugin, then yeses a settings question would take.
    result = sandbox.run("--update", stdin="n\ny\ny\n")

    assert result.returncode == 0, result.stderr
    assert "vanished: fragment:example-rules, plugin:example-gone\n" in result.stdout
    assert "Apply settings:" not in result.stdout
    assert json.loads(settings.read_text()) == installed
    assert sandbox.current.readlink() == Path("versions/0.1.0")
    assert sandbox.claude_calls() == [PLUGIN_LIST]
    assert result.stdout.endswith(
        "Updated nothing.\n"
        "Skipped harness, plugin:example-one.\n"
        "Waiting for the harness: settings:example-ask, settings:example-deny.\n"
    )


def test_update_with_the_harness_named_asks_about_every_changed_settings_fragment(sandbox: Sandbox) -> None:
    sandbox.write("harness/settings/example-ask.json", json.dumps({"permissions": {"ask": ["Bash(example)"]}}).encode())
    sandbox.commit("Add an example ask fragment")
    installs = ("harness", "settings:example-ask", "settings:example-deny")
    assert sandbox.run(*installs, stdin="y\ny\n").returncode == 0
    settings = sandbox.home / ".claude/settings.json"
    installed = json.loads(settings.read_text())
    sandbox.write(
        "harness/settings/example-ask.json", json.dumps({"permissions": {"ask": ["Bash(example-new)"]}}).encode()
    )
    sandbox.write(
        "harness/settings/example-deny.json", json.dumps({**SETTINGS_FRAGMENT, "model": "example-new"}).encode()
    )
    sandbox.set_version("0.2.0")
    sandbox.commit("Change both example fragments")

    # The harness, then no to example-ask and yes to example-deny.
    result = sandbox.run("--update", "harness", stdin="y\nn\ny\n")

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith(
        "harness: 0.1.0 to 0.2.0\n"
        f"settings:example-ask: changes {settings}\n"
        f"settings:example-deny: changes {settings}\n"
        "Update harness? [y/N] "
    )
    installed["model"] = "example-new"
    assert json.loads(settings.read_text()) == installed
    assert sandbox.current.readlink() == Path("versions/0.2.0")
    assert result.stdout.endswith("Updated harness, settings:example-deny.\nSkipped settings:example-ask.\n")


def test_update_with_names_covers_only_those_named(sandbox: Sandbox) -> None:
    assert sandbox.run("harness").returncode == 0
    sandbox.set_version("0.2.0")
    sandbox.set_plugin_version("example-one", "1.1.0")
    sandbox.commit("Raise the example versions")
    sandbox.list_plugins({"example-one": "1.0.0", "example-gone": "1.0.0"})

    result = sandbox.run("--update", "plugin:example-one", "plugin:example-gone", stdin="y\n")

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith(
        "plugin:example-one: 1.0.0 to 1.1.0\n"
        "plugin:example-gone: vanished, since HEAD no longer ships it\n"
        "Update plugin:example-one? [y/N] "
    )
    assert "available:" not in result.stdout
    assert sandbox.current.readlink() == Path("versions/0.1.0")
    assert sandbox.claude_calls() == [
        PLUGIN_LIST,
        ["plugin", "marketplace", "update", "example-market"],
        ["plugin", "update", "example-one@example-market"],
        PLUGIN_LIST,
    ]


def test_update_without_the_harness_named_judges_against_it_and_holds_back_its_settings(sandbox: Sandbox) -> None:
    assert sandbox.run("harness", "skills", "settings:example-deny", stdin="y\n").returncode == 0
    sandbox.write("harness/skills/example-gamma/SKILL.md", b"example gamma skill\n")
    (sandbox.clone / "harness/settings/example-deny.json").unlink()
    sandbox.set_version("0.2.0")
    sandbox.commit("Add an example gamma skill and drop the example deny fragment")
    settings = sandbox.home / ".claude/settings.json"
    before = settings.read_text()

    result = sandbox.run("--update", "skills", "settings:example-deny")
    only_settings = sandbox.run("--update", "settings:example-deny")

    assert result.returncode == 0, result.stderr
    assert result.stdout == (
        "skills: current\n"
        f"settings:example-deny: HEAD no longer ships it; removes its entries from {settings}\n"
        "Updated nothing.\n"
        "Waiting for the harness: settings:example-deny.\n"
    )
    assert only_settings.returncode == 1
    assert "name it too: --update harness settings:example-deny\n" in only_settings.stderr
    assert settings.read_text() == before
    # No plugin named, so `claude plugin list` never ran.
    assert sandbox.claude_calls() == []


def test_update_reports_a_plugin_its_update_left_short_of_head(sandbox: Sandbox) -> None:
    for name in ("example-one", "example-two"):
        sandbox.set_plugin_version(name, "1.1.0")
    sandbox.commit("Raise the example plugin versions")
    sandbox.list_plugins({"example-one": "1.0.0", "example-two": "1.0.0"})
    sandbox.move_on_update({"example-one": "1.1.0"})

    result = sandbox.run("--update", stdin="y\n")

    assert result.returncode == 0, result.stderr
    assert result.stdout.endswith(
        "plugin:example-two: left at 1.0.0, not HEAD's 1.1.0: claude plugin update installs GitHub's main, which can"
        " differ from this checkout\n"
        "Updated plugin:example-one.\n"
    )
    assert sandbox.claude_calls() == [
        PLUGIN_LIST,
        ["plugin", "marketplace", "update", "example-market"],
        ["plugin", "update", "example-one@example-market"],
        ["plugin", "update", "example-two@example-market"],
        PLUGIN_LIST,
    ]


def test_update_says_updated_nothing_only_when_it_applied_nothing(sandbox: Sandbox) -> None:
    sandbox.set_plugin_version("example-one", "1.1.0")
    sandbox.commit("Raise the example plugin version")
    sandbox.list_plugins({"example-one": "1.0.0"})

    declined = sandbox.run("--update", stdin="n\n")
    left_behind = sandbox.run("--update", stdin="y\n")

    assert declined.returncode == 0, declined.stderr
    assert declined.stdout.endswith("Updated nothing.\nSkipped plugin:example-one.\n")
    assert left_behind.returncode == 0, left_behind.stderr
    assert left_behind.stdout.endswith(
        "plugin:example-one: left at 1.0.0, not HEAD's 1.1.0: claude plugin update"
        " installs GitHub's main, which can differ from this checkout\n"
    )
    assert "Updated" not in left_behind.stdout


def test_update_offers_to_remove_a_settings_fragment_the_new_harness_drops(sandbox: Sandbox) -> None:
    assert sandbox.run("harness", "settings:example-deny", stdin="y\n").returncode == 0
    settings = sandbox.home / ".claude/settings.json"
    held = json.loads(settings.read_text())
    held["permissions"]["deny"].append("Read(./example-own)")
    held["model"] = "example-own-model"
    settings.write_text(json.dumps(held, indent=2) + "\n")
    (sandbox.clone / "harness/settings/example-deny.json").unlink()
    sandbox.set_version("0.2.0")
    sandbox.commit("Drop the example deny fragment")

    result = sandbox.run("--update", stdin="y\ny\n")

    assert result.returncode == 0, result.stderr
    assert f"settings:example-deny: HEAD no longer ships it; removes its entries from {settings}\n" in result.stdout
    assert "Remove settings:example-deny? [y/N] " in result.stdout
    assert json.loads(settings.read_text()) == {
        "permissions": {"deny": ["Read(./example-own)"]},
        "model": "example-own-model",
    }


def test_update_failure_names_the_component_and_what_updated_before_it(sandbox: Sandbox) -> None:
    assert sandbox.run("harness", "settings:example-deny", stdin="y\n").returncode == 0
    sandbox.write(
        "harness/settings/example-deny.json", json.dumps({**SETTINGS_FRAGMENT, "model": "example-new"}).encode()
    )
    sandbox.set_version("0.2.0")
    sandbox.set_plugin_version("example-one", "1.1.0")
    sandbox.commit("Change the example fragment and raise the example versions")
    sandbox.list_plugins({"example-one": "1.0.0"})

    result = sandbox.run("--update", stdin="y\ny\n", env={"EXAMPLE_CLAUDE_FAIL": "update"})

    assert result.returncode == 1
    assert (
        "plugin:example-one failed: claude plugin update example-one@example-market exited 3;"
        " updated before it: harness, settings:example-deny"
    ) in result.stderr
    assert sandbox.current.readlink() == Path("versions/0.2.0")


@pytest.mark.parametrize(
    ("env", "uncommitted", "reason"),
    [
        ({"CLAUDECODE": "1"}, False, "refusing to run inside a Claude Code session"),
        ({}, True, "has uncommitted changes to tracked files"),
    ],
    ids=["session", "uncommitted-change"],
)
def test_update_refusal_updates_nothing(sandbox: Sandbox, env: dict[str, str], uncommitted: bool, reason: str) -> None:
    assert sandbox.run("harness").returncode == 0
    sandbox.set_version("0.2.0")
    sandbox.commit("Raise the example version")
    if uncommitted:
        (sandbox.clone / "harness/githooks/README.md").write_text("example edit\n")

    result = sandbox.run("--update", stdin="y\n", env=env)

    assert result.returncode == 1
    assert reason in result.stderr
    assert sandbox.current.readlink() == Path("versions/0.1.0")
    assert sandbox.claude_calls() == []


def test_update_without_an_answer_stops_before_writing(sandbox: Sandbox) -> None:
    assert sandbox.run("harness", "settings:example-deny", stdin="y\n").returncode == 0
    settings = (sandbox.home / ".claude/settings.json").read_text()
    sandbox.write(
        "harness/settings/example-deny.json", json.dumps({**SETTINGS_FRAGMENT, "model": "example-new"}).encode()
    )
    sandbox.set_version("0.2.0")
    sandbox.commit("Change the example fragment and raise the example version")

    # A yes to the harness, then no answer to the settings question.
    result = sandbox.run("--update", stdin="y\n")

    assert result.returncode == 1
    assert "no answer on stdin; run bootstrap.py --update in a terminal" in result.stderr
    assert sandbox.current.readlink() == Path("versions/0.1.0")
    assert (sandbox.home / ".claude/settings.json").read_text() == settings


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        (["plugin:example-two"], "not installed: plugin:example-two; run bootstrap.py without --update"),
        (["example-unknown"], "unknown component example-unknown"),
        (["hooks-path"], "hooks-path has nothing to update"),
        (["--repo", "{repo}"], "--update takes no --repo"),
    ],
    ids=["not-installed", "unknown-component", "hooks-path", "repo"],
)
def test_update_usage_error_updates_nothing(sandbox: Sandbox, args: list[str], reason: str) -> None:
    repo = sandbox.new_repo("example-repo")
    assert sandbox.run("harness").returncode == 0
    sandbox.set_version("0.2.0")
    sandbox.commit("Raise the example version")

    result = sandbox.run("--update", "harness", *[arg.format(repo=repo) for arg in args], stdin="y\n")

    assert result.returncode == 1
    assert reason in result.stderr
    assert sandbox.current.readlink() == Path("versions/0.1.0")
