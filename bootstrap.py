"""Install the parts of runt9-claude-harness that cannot be plugins, and the plugins you pick.

    python3 bootstrap.py [component ...] [--repo <path> ...] [--list]

Run it in your own shell, not in a Claude Code session. With components named it installs exactly those, in the order
--list shows; with none named it asks about each one. README.md says what each component does and what it refuses.

Exits 0 when everything picked installed, otherwise 1 with one line naming the reason and what installed before it.
"""

import argparse
import copy
import difflib
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
from pathlib import Path, PurePosixPath

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
# Not installed, so changing one needs no version rise; the CI version guard exempts the same files.
NOT_SHIPPED = ("harness/*/README.md", "test_*.py", "test_*.bats", "*.test.ts", "*.test.tsx")

SKILLS_DIR = CLAUDE_DIR / "skills"
SKILL_FILE = "SKILL.md"

FRAGMENTS = "fragments"
USER_CLAUDE_MD = CLAUDE_DIR / "CLAUDE.md"
# Inside the installed harness; a missing ~/.claude/CLAUDE.md starts from it. Not named CLAUDE.md, which Claude Code
# would load as instructions for sessions working in harness/.
CLAUDE_MD_TEMPLATE = "claude-md-template.md"
BLOCK_START = "<!-- runt9-claude-harness: bootstrap.py keeps the lines from here to the end marker -->"
BLOCK_END = "<!-- runt9-claude-harness: end -->"

SETTINGS = "settings"
SETTINGS_FILE = CLAUDE_DIR / "settings.json"
DEFAULT_INDENT = "  "
SESSION_VARIABLES = ("CLAUDE_CODE_SESSION_ID", "CLAUDECODE")
PLUGIN_DIRS_VARIABLE = "CLAUDE_CODE_PLUGIN_DIRS"


class Stop(Exception):
    """A refusal or an error. main prints the message as one line and exits 1."""


@dataclass
class Run:
    repos: list[Path]
    picked: list[str] = field(default_factory=list)
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


def ships(path: str) -> bool:
    return not any(PurePosixPath(path).match(pattern) for pattern in NOT_SHIPPED)


def export_tree(commit: str, source: str, target: Path) -> None:
    """Writes the blobs under `source` in `commit` that ship to `target`, bypassing every filter and attribute."""
    listing = git(CLONE, "ls-tree", "-r", "-z", "--full-tree", commit, "--", source)
    entries = [entry for entry in listing.split(b"\0") if entry]
    if not entries:
        raise Stop(f"{commit} has no {source}")
    for entry in entries:
        meta, raw_path = entry.split(b"\t", 1)
        mode, _, blob = meta.decode().split()
        path = os.fsdecode(raw_path)
        if not ships(path):
            continue
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
    target = VERSIONS_DIR / version

    replace = True
    if target.exists():
        no_stdin = f"no answer on stdin to whether to replace {target}; run bootstrap.py in a terminal"
        question = f"{version} is already installed in {target}. Replace it from {commit}? [y/N] "
        replace = answered_yes(question, no_stdin)
    if replace:
        VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
        # Staged beside where it goes, so a rename installs it whole.
        with tempfile.TemporaryDirectory(prefix=".staging-", dir=VERSIONS_DIR) as staging:
            staged = Path(staging) / version
            export_tree(commit, HARNESS_SOURCE, staged)
            (staged / SOURCE_COMMIT).write_text(f"{commit}\n", encoding="utf-8")
            if target.exists():
                shutil.rmtree(target)
            staged.rename(target)
        print(f"harness: installed {version} from {commit} into {target}")

    # A new link renamed over the old one, so `current` never names a partial version.
    link = INSTALL_DIR / ".current-new"
    link.unlink(missing_ok=True)
    link.symlink_to(Path(VERSIONS_DIR.name) / version)
    link.replace(CURRENT)
    print(f"harness: {CURRENT} points at {version}")

    for other in VERSIONS_DIR.iterdir():
        if other.name != version:
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


def require_installed(relative: str) -> Path:
    path = CURRENT / relative
    if not path.is_file():
        raise Stop(f"the installed harness has no {path}; install the harness from this checkout first")
    return path


def shipped_in_head(directory: str, suffix: str) -> list[PurePosixPath]:
    """The files ending in `suffix` directly in harness/<directory>/ in HEAD, which is what the harness component
    installs."""
    source = f"{HARNESS_SOURCE}/{directory}/"
    listing = git(CLONE, "ls-tree", "--name-only", "-z", "--full-tree", "HEAD", "--", source)
    paths = [PurePosixPath(os.fsdecode(entry)) for entry in listing.split(b"\0") if entry]
    return [path for path in paths if path.suffix == suffix and ships(str(path))]


def write_after_asking(target: Path, before: str, after: str) -> None:
    """Shows the diff from `before` to `after` and writes `after` to `target` on yes. Raises Stop on no."""
    diff = difflib.unified_diff(
        before.splitlines(), after.splitlines(), fromfile=str(target), tofile=str(target), lineterm=""
    )
    print("\n".join(diff))
    no_stdin = f"no answer on stdin to whether to write {target}; run bootstrap.py in a terminal"
    if not answered_yes(f"Write this to {target}? [y/N] ", no_stdin):
        raise Stop(f"not written, so {target} is unchanged")

    target.parent.mkdir(parents=True, exist_ok=True)
    # Staged beside the file and renamed over it, so a failed write leaves the old one whole.
    with tempfile.TemporaryDirectory(prefix=".staging-", dir=target.parent) as staging:
        staged = Path(staging) / target.name
        staged.write_bytes(after.encode())
        if target.exists():
            shutil.copymode(target, staged)
        staged.replace(target)


def check_fragment(name: str, run: Run) -> None:
    # A harness installed in this run comes from HEAD, which is where the fragment was listed from.
    if "harness" not in run.picked:
        require_installed(f"{FRAGMENTS}/{name}.md")
    if USER_CLAUDE_MD.exists():
        block_bounds(USER_CLAUDE_MD.read_bytes().decode().splitlines())


def block_bounds(lines: list[str]) -> tuple[int, int] | None:
    """The indexes of the block's start and end marker lines, or None when `lines` has neither marker. Raises Stop
    when the markers are not one start line followed by one end line, which `check_fragment` relies on."""
    starts = [index for index, line in enumerate(lines) if line.rstrip() == BLOCK_START]
    ends = [index for index, line in enumerate(lines) if line.rstrip() == BLOCK_END]
    if not starts and not ends:
        return None
    if len(starts) != 1 or len(ends) != 1 or ends[0] < starts[0]:
        raise Stop(f"{USER_CLAUDE_MD} needs one {BLOCK_START} line, then one {BLOCK_END} line; fix the markers by hand")
    return starts[0], ends[0]


def with_import(text: str, import_line: str) -> str:
    """`text` with `import_line` added at the end of the block, or with a new block holding it appended. Returns
    `text` unchanged when any line already imports it, inside the block or not."""
    lines = text.splitlines(keepends=True)
    bounds = block_bounds(lines)
    if any(line.strip() == import_line for line in lines):
        return text
    if bounds is None:
        if text and not text.endswith("\n"):
            text += "\n"
        separator = "\n" if text else ""
        return f"{text}{separator}{BLOCK_START}\n{import_line}\n{BLOCK_END}\n"
    _, end = bounds
    lines.insert(end, f"{import_line}\n")
    return "".join(lines)


def install_fragment(name: str, run: Run) -> None:
    fragment = require_installed(f"{FRAGMENTS}/{name}.md")
    import_line = f"@~/{fragment.relative_to(Path.home())}"
    # Resolved so a CLAUDE.md that links elsewhere keeps its link and the file it names changes.
    target = USER_CLAUDE_MD.resolve()
    template = CURRENT / CLAUDE_MD_TEMPLATE
    if USER_CLAUDE_MD.exists():
        # Bytes, so line endings outside the block survive the round trip.
        before = USER_CLAUDE_MD.read_bytes().decode()
        base_text = before
    else:
        before = ""
        base_text = template.read_bytes().decode() if template.is_file() else ""
    after = with_import(base_text, import_line)
    if after == before:
        print(f"fragment:{name}: {USER_CLAUDE_MD} already imports {fragment}")
        return
    write_after_asking(target, before, after)
    print(f"fragment:{name}: {target} imports {fragment}")


def fragment_components() -> list[Component]:
    components = []
    for path in shipped_in_head(FRAGMENTS, ".md"):
        components.append(
            Component(
                name=f"fragment:{path.stem}",
                summary=f"import ~/.claude/harness/current/{FRAGMENTS}/{path.name} in ~/.claude/CLAUDE.md",
                install=functools.partial(install_fragment, path.stem),
                check=functools.partial(check_fragment, path.stem),
            )
        )
    return components


def check_settings(name: str, run: Run) -> None:
    # A harness installed in this run comes from HEAD, which is where the fragment was listed from.
    if "harness" not in run.picked:
        require_installed(f"{SETTINGS}/{name}.json")
    if SETTINGS_FILE.exists():
        read_json_object(SETTINGS_FILE)


def merge_settings(settings: dict, fragment: dict, at: str = "") -> None:
    """Adds to `settings`, in place, each key of `fragment` it lacks and each entry of a fragment list its list lacks,
    descending into objects both have. A value `settings` already has is never replaced. Raises Stop where the
    fragment has an object or a list and `settings` has something else."""
    for key, value in fragment.items():
        path = f"{at}.{key}" if at else key
        if key not in settings:
            settings[key] = value
            continue
        present = settings[key]
        if isinstance(value, dict) and isinstance(present, dict):
            merge_settings(present, value, path)
        elif isinstance(value, list) and isinstance(present, list):
            for entry in value:
                if entry not in present:
                    present.append(entry)
        elif isinstance(value, (dict, list)):
            kind = "an object" if isinstance(value, dict) else "a list"
            raise Stop(f"{path} in {SETTINGS_FILE} is not {kind}, as the fragment's is; fix it by hand")


def json_indent(text: str) -> str:
    """The indentation of the first indented line in `text`, so a rewrite keeps the file's own."""
    match = re.search(r"\n([ \t]+)\S", text)
    return match[1] if match else DEFAULT_INDENT


def install_settings(name: str, run: Run) -> None:
    fragment_path = require_installed(f"{SETTINGS}/{name}.json")
    fragment = read_json_object(fragment_path)
    # Resolved so a settings.json that links elsewhere keeps its link and the file it names changes.
    target = SETTINGS_FILE.resolve()
    if SETTINGS_FILE.exists():
        before = SETTINGS_FILE.read_text(encoding="utf-8")
        settings = parse_json_object(before, str(SETTINGS_FILE))
    else:
        before = ""
        settings = {}
    merged = copy.deepcopy(settings)
    merge_settings(merged, fragment)
    if merged == settings:
        print(f"settings:{name}: {SETTINGS_FILE} already has everything in {fragment_path}")
        return
    after = json.dumps(merged, indent=json_indent(before), ensure_ascii=False) + "\n"
    write_after_asking(target, before, after)
    print(f"settings:{name}: {target} has everything in {fragment_path}")


def settings_components() -> list[Component]:
    components = []
    for path in shipped_in_head(SETTINGS, ".json"):
        components.append(
            Component(
                name=f"settings:{path.stem}",
                summary=f"merge ~/.claude/harness/current/{SETTINGS}/{path.name} into ~/.claude/settings.json",
                install=functools.partial(install_settings, path.stem),
                check=functools.partial(check_settings, path.stem),
            )
        )
    return components


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


# Install order, ahead of the fragments, settings and plugins. Everything under harness/ arrives with the harness
# component; a part that must also be wired into ~/.claude or a repository is one entry here and its install function.
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
    components = [*HARNESS_COMPONENTS, *fragment_components(), *settings_components(), *plugin_components()]
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
    run.picked = [component.name for component in picked]
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
