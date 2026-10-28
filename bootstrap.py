"""Install the parts of runt9-claude-harness that cannot be plugins, and the plugins you pick.

    python3 bootstrap.py [component ...] [--repo <path> ...] [--list]

Run it in your own shell, not in a Claude Code session. With components named it installs exactly those, in the order
--list shows; with none named it asks about each one. README.md says what each component does and what it refuses.

Exits 0 when everything picked installed, otherwise 1 with one line naming the reason and what installed before it.
"""

import argparse
import functools
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

# Above every definition: on an older interpreter their annotations raise at import, before main could say why.
if sys.version_info < (3, 12):  # noqa: UP036 (ruff assumes the target version, and this check is for older ones)
    running = ".".join(str(part) for part in sys.version_info[:3])
    sys.exit(f"bootstrap: needs Python 3.12 or newer, and this is {running}")

CLONE = Path(__file__).resolve().parent
MARKETPLACE_FILE = CLONE / ".claude-plugin" / "marketplace.json"
MARKETPLACE_SOURCE = "Runt9-Productions/runt9-claude-harness"
UPSTREAM = "origin/main"
CLAUDE_DIR = Path.home() / ".claude"

HARNESS_SOURCE = "harness"
HARNESS_MANIFEST = f"{HARNESS_SOURCE}/harness.json"
# The version names a directory, so it may hold nothing that walks out of one.
VERSION_PATTERN = re.compile(r"\d+(\.\d+)*")
INSTALL_DIR = CLAUDE_DIR / "harness"
VERSIONS_DIR = INSTALL_DIR / "versions"
# Hooks and skills are reached through this link, so pointing it at another version switches all of them at once.
CURRENT = INSTALL_DIR / "current"
SOURCE_COMMIT = "SOURCE_COMMIT"
FILE_MODES = {"100644": 0o644, "100755": 0o755}

SKILLS_DIR = CLAUDE_DIR / "skills"
SKILL_FILE = "SKILL.md"

SETTINGS_FILE = CLAUDE_DIR / "settings.json"
SESSION_VARIABLES = ("CLAUDE_CODE_SESSION_ID", "CLAUDECODE")
PLUGIN_DIRS_VARIABLE = "CLAUDE_CODE_PLUGIN_DIRS"


class Stop(Exception):
    """A refusal or an error. main prints the message as one line and exits 1."""


@dataclass
class Run:
    repos: list[Path]
    installed: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Component:
    name: str
    summary: str
    install: Callable[[Run], None]
    # Runs for every picked component before the first install, so a refusal installs nothing.
    check: Callable[[Run], None] | None = None
    # Acts on the --repo paths; prompt mode offers it only when --repo is given.
    needs_repos: bool = False


def warn(message: str) -> None:
    print(f"bootstrap: warning: {message}", file=sys.stderr)


@functools.cache
def git_environment() -> dict[str, str]:
    """The caller's environment without the variables that point git at another repository or add config to it, so
    each call acts on the directory it names."""
    listed = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True)
    if listed.returncode != 0:
        raise Stop(f"git rev-parse --local-env-vars exited {listed.returncode}")
    redirecting = set(listed.stdout.split())
    return {name: value for name, value in os.environ.items() if name not in redirecting}


def run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, env=git_environment())


def git_failure(cwd: Path, args: tuple[str, ...], result: subprocess.CompletedProcess[bytes]) -> Stop:
    lines = result.stderr.decode(errors="replace").strip().splitlines()
    reason = lines[-1] if lines else f"exit {result.returncode}"
    return Stop(f"git {' '.join(args)} failed in {cwd}: {reason}")


def git(cwd: Path, *args: str) -> bytes:
    result = run_git(cwd, *args)
    if result.returncode != 0:
        raise git_failure(cwd, args, result)
    return result.stdout


def git_config(repo: Path, *args: str) -> str | None:
    """The value of `git config <args>`, or None when the key is unset."""
    result = run_git(repo, "config", *args)
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        raise git_failure(repo, ("config", *args), result)
    return os.fsdecode(result.stdout).strip()


def parse_json_object(text: str | bytes, origin: str) -> dict:
    try:
        value = json.loads(text)
    except ValueError as error:
        raise Stop(f"{origin} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise Stop(f"{origin} is not a JSON object")
    return value


def read_json_object(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise Stop(f"cannot read {path}: {error.strerror}") from error
    return parse_json_object(text, str(path))


def check_checkout() -> None:
    changes = git(CLONE, "--no-optional-locks", "status", "--porcelain", "--untracked-files=no")
    if changes:
        raise Stop(f"{CLONE} has uncommitted changes to tracked files; commit or stash them, since only HEAD installs")
    if run_git(CLONE, "rev-parse", "--verify", "--quiet", f"refs/remotes/{UPSTREAM}^{{commit}}").returncode != 0:
        warn(f"there is no {UPSTREAM} to compare HEAD with; installing HEAD anyway")
        return
    ancestry = ("merge-base", "--is-ancestor", "HEAD", UPSTREAM)
    reachable = run_git(CLONE, *ancestry)
    if reachable.returncode == 1:
        warn(f"HEAD is not on {UPSTREAM} as of the last fetch; installing HEAD anyway")
    elif reachable.returncode != 0:
        raise git_failure(CLONE, ancestry, reachable)


def export_tree(commit: str, source: str, target: Path) -> None:
    """Writes the blobs under `source` in `commit` to `target`, bypassing every filter and attribute."""
    listing = git(CLONE, "ls-tree", "-r", "-z", "--full-tree", commit, "--", source)
    entries = [entry for entry in listing.split(b"\0") if entry]
    if not entries:
        raise Stop(f"{commit} has no {source}")
    for entry in entries:
        meta, raw_path = entry.split(b"\t", 1)
        mode, _, blob = meta.decode().split()
        path = os.fsdecode(raw_path)
        if mode not in FILE_MODES:
            raise Stop(f"{path} in {commit} is not a regular file (mode {mode}); only regular files install")
        destination = target / Path(path).relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(git(CLONE, "cat-file", "blob", blob))
        destination.chmod(FILE_MODES[mode])


def harness_version(commit: str) -> str:
    origin = f"{HARNESS_MANIFEST} in {commit}"
    text = git(CLONE, "show", f"{commit}:{HARNESS_MANIFEST}")
    version = parse_json_object(text, origin).get("version")
    if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
        raise Stop(f"{origin} needs a version made of dot-separated numbers")
    return version


def install_harness(run: Run) -> None:
    commit = git(CLONE, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    version = harness_version(commit)
    # Named by content as well as version, so a commit that changes harness/ without a version rise (a branch, or two
    # pull requests raising to the same version) installs anew instead of finding its version already there.
    tree = git(CLONE, "rev-parse", f"{commit}:{HARNESS_SOURCE}").decode().strip()
    name = f"{version}-{tree[:12]}"
    target = VERSIONS_DIR / name

    if target.exists():
        print(f"harness: {version} with this content is already installed in {target}")
    else:
        VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
        # Staged beside where it goes, so the one rename that installs it cannot leave a partial version.
        with tempfile.TemporaryDirectory(prefix=".staging-", dir=VERSIONS_DIR) as staging:
            staged = Path(staging) / name
            export_tree(commit, HARNESS_SOURCE, staged)
            (staged / SOURCE_COMMIT).write_text(f"{commit}\n", encoding="utf-8")
            staged.rename(target)
        print(f"harness: installed {version} from {commit} into {target}")

    # A new link renamed over the old one, so `current` never names a missing or partial version.
    link = INSTALL_DIR / ".current-new"
    link.unlink(missing_ok=True)
    link.symlink_to(Path(VERSIONS_DIR.name) / name)
    link.replace(CURRENT)
    print(f"harness: {CURRENT} points at {name}")

    for other in VERSIONS_DIR.iterdir():
        if other.name != name:
            shutil.rmtree(other)


def require_harness() -> None:
    if not CURRENT.is_dir():
        raise Stop(f"the harness is not installed in {INSTALL_DIR}; install it first")


def check_hooks_path(run: Run) -> None:
    if not run.repos:
        raise Stop("hooks-path needs --repo <path>, once for each repository")
    for repo in run.repos:
        result = run_git(repo, "rev-parse", "--show-toplevel")
        if result.returncode != 0:
            raise Stop(f"{repo} is not a git repository")
        top_level = Path(os.fsdecode(result.stdout).strip())
        if not top_level.samefile(repo):
            raise Stop(f"{repo} is inside the repository {top_level}, not its top level")


def report_replaced_hooks(repo: Path, hooks: str) -> None:
    """Says what setting core.hooksPath to `hooks` turns off in `repo`: the value git uses now, from whichever
    scope, and each hook in the directory git runs hooks from now."""
    configured = git_config(repo, "--show-scope", "--get", "core.hooksPath")
    if configured is not None:
        scope, previous = configured.split("\t", 1)
        if previous == hooks:
            return
        if scope == "local":
            restore = ["git", "-C", str(repo), "config", "core.hooksPath", previous]
        else:
            # A value from another scope applies again once the repository's own is gone.
            restore = ["git", "-C", str(repo), "config", "--unset", "core.hooksPath"]
        print(f"hooks-path: {repo} had core.hooksPath {previous} from its {scope} config")
        print(f"hooks-path: to restore it: {shlex.join(restore)}")

    hooks_dir = repo / os.fsdecode(git(repo, "rev-parse", "--git-path", "hooks")).strip()
    if not hooks_dir.is_dir():
        return
    disabled = []
    for path in sorted(hooks_dir.iterdir()):
        if path.suffix == ".sample":
            continue
        if path.is_file() and os.access(path, os.X_OK):
            disabled.append(path.name)
    if disabled:
        warn(f"{repo} stops running {', '.join(disabled)} from {hooks_dir}")


def install_hooks_path(run: Run) -> None:
    require_harness()
    hooks = str(CURRENT / "githooks")
    for repo in run.repos:
        report_replaced_hooks(repo, hooks)
        git(repo, "config", "--local", "core.hooksPath", hooks)
        effective = git_config(repo, "--get", "core.hooksPath")
        if effective != hooks:
            raise Stop(f"{repo} reads core.hooksPath as {effective}, not {hooks}; a config.worktree or include sets it")
        print(f"hooks-path: {repo} uses {hooks}")
        if not git_config(repo, "--get", "claude.botEmail"):
            warn(f"{repo} sets no claude.botEmail, so only the leak gate runs there")


def check_skills() -> None:
    resolved = SKILLS_DIR.resolve()
    if not resolved.is_relative_to(CLAUDE_DIR.resolve()):
        raise Stop(f"{SKILLS_DIR} resolves to {resolved}, outside {CLAUDE_DIR}; refusing to write through it")


def is_link_to(link: Path, target: Path) -> bool:
    return link.is_symlink() and link.readlink() == target


def install_skills(run: Run) -> None:
    require_harness()
    source = CURRENT / "skills"
    names = sorted(path.name for path in source.iterdir() if (path / SKILL_FILE).is_file())

    taken = []
    for name in names:
        link = SKILLS_DIR / name
        if os.path.lexists(link) and not is_link_to(link, source / name):
            taken.append(str(link))
    if taken:
        raise Stop(f"{', '.join(taken)} already exist and are not links into {source}; move them away to install these")

    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    for name in names:
        link = SKILLS_DIR / name
        if not os.path.lexists(link):
            link.symlink_to(source / name)
            print(f"skills: linked {link} to {source / name}")

    # A skill that a later version dropped leaves its link dangling.
    for link in SKILLS_DIR.iterdir():
        if not link.is_symlink() or link.exists():
            continue
        if link.readlink().parent == source:
            link.unlink()
            print(f"skills: removed {link}, whose skill this version no longer has")


# Cached so it runs once per run, however many plugins are picked.
@functools.cache
def check_plugin_setup() -> None:
    if shutil.which("claude") is None:
        raise Stop("claude is not on PATH, and plugin components run it")
    values = []
    if os.environ.get(PLUGIN_DIRS_VARIABLE):
        values.append(os.environ[PLUGIN_DIRS_VARIABLE])
    if SETTINGS_FILE.exists():
        env = read_json_object(SETTINGS_FILE).get("env")
        if isinstance(env, dict) and env.get(PLUGIN_DIRS_VARIABLE):
            values.append(env[PLUGIN_DIRS_VARIABLE])
    for value in values:
        warn(f"{PLUGIN_DIRS_VARIABLE} is {value}, and a plugin it loads replaces the installed one of the same name")


def claude(*args: str) -> None:
    result = subprocess.run(["claude", *args])
    if result.returncode != 0:
        raise Stop(f"claude {' '.join(args)} exited {result.returncode}")


# Cached so it runs once per run. Adding a marketplace already added succeeds, so a re-run needs no special case.
@functools.cache
def add_marketplace() -> None:
    claude("plugin", "marketplace", "add", MARKETPLACE_SOURCE)


def install_plugin(name: str, marketplace: str, run: Run) -> None:
    add_marketplace()
    claude("plugin", "install", f"{name}@{marketplace}")


def plugin_components() -> list[Component]:
    marketplace = read_json_object(MARKETPLACE_FILE)
    marketplace_name = marketplace.get("name")
    plugins = marketplace.get("plugins")
    if not isinstance(marketplace_name, str) or not isinstance(plugins, list):
        raise Stop(f"{MARKETPLACE_FILE} needs a name and a plugins list")
    components = []
    for plugin in plugins:
        if not isinstance(plugin, dict) or not isinstance(plugin.get("name"), str):
            raise Stop(f"{MARKETPLACE_FILE} has a plugin entry without a name")
        name = plugin["name"]
        components.append(
            Component(
                name=f"plugin:{name}",
                summary=plugin.get("description", ""),
                install=functools.partial(install_plugin, name, marketplace_name),
                check=lambda run: check_plugin_setup(),
            )
        )
    return components


# Install order. Everything under harness/ arrives with the harness component; a part that must also be wired into
# ~/.claude or a repository is one entry here and its install function.
HARNESS_COMPONENTS = (
    Component(
        name="harness",
        summary="install harness/ from HEAD as ~/.claude/harness/versions/<version> and point current at it",
        install=install_harness,
        check=lambda run: check_checkout(),
    ),
    Component(
        name="hooks-path",
        summary="set core.hooksPath to ~/.claude/harness/current/githooks in each --repo",
        install=install_hooks_path,
        check=check_hooks_path,
        needs_repos=True,
    ),
    Component(
        name="skills",
        summary="link each skill in ~/.claude/harness/current/skills into ~/.claude/skills",
        install=install_skills,
        check=lambda run: check_skills(),
    ),
)


def answered_yes(question: str, no_stdin: str) -> bool:
    """Asks on stdin; `no_stdin` is the Stop message when stdin has no answer."""
    try:
        answer = input(question)
    except EOFError:
        raise Stop(no_stdin) from None
    return answer.strip().lower() in ("y", "yes")


def ask(components: list[Component], run: Run) -> list[Component]:
    picked = []
    for component in components:
        if component.needs_repos and not run.repos:
            print(f"Not offering {component.name}: run python3 bootstrap.py {component.name} --repo <path>")
            continue
        question = f"Install {component.name} ({component.summary})? [y/N] "
        if answered_yes(question, "no answer on stdin; name the components on the command line instead"):
            picked.append(component)
    return picked


def pick(names: list[str], components: list[Component], run: Run) -> list[Component]:
    known = {component.name for component in components}
    unknown = [name for name in names if name not in known]
    if unknown:
        raise Stop(f"unknown component {', '.join(unknown)}; python3 bootstrap.py --list shows them")
    if not names:
        return ask(components, run)
    picked = [component for component in components if component.name in names]
    if run.repos and not any(component.needs_repos for component in picked):
        users = [component.name for component in components if component.needs_repos]
        raise Stop(f"--repo is used only by {', '.join(users)}, and none is named")
    return picked


def bootstrap(args: argparse.Namespace) -> None:
    if not args.list and any(variable in os.environ for variable in SESSION_VARIABLES):
        raise Stop("refusing to run inside a Claude Code session; run it in your own shell")
    components = [*HARNESS_COMPONENTS, *plugin_components()]
    if args.list:
        width = max(len(component.name) for component in components)
        for component in components:
            print(f"{component.name:<{width}}  {component.summary}")
        return

    run = Run(repos=[repo.resolve() for repo in args.repo])
    picked = pick(args.components, components, run)
    if not picked:
        print("Nothing picked.")
        return
    for component in picked:
        if component.check is not None:
            component.check(run)

    for component in picked:
        try:
            component.install(run)
        except (Stop, OSError) as error:
            installed = ", ".join(run.installed) or "nothing"
            raise Stop(f"{component.name} failed: {error}; installed before it: {installed}") from error
        run.installed.append(component.name)
    print(f"Installed {', '.join(run.installed)}.")


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="bootstrap.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("components", nargs="*", metavar="component", help="components to install, from --list")
    parser.add_argument("--repo", action="append", default=[], type=Path, metavar="<path>", help="for hooks-path")
    parser.add_argument("--list", action="store_true", help="print the components and exit")
    args = parser.parse_args()
    try:
        bootstrap(args)
    except (Stop, OSError) as error:
        print(f"bootstrap: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
