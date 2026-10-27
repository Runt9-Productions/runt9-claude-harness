"""Install the parts of runt9-claude-harness that cannot be plugins, and the plugins if you pick them.

    python3 bootstrap.py [component ...] [--repo <path> ...] [--list]

Run it in your own shell, not in a Claude Code session. It installs from the clone that holds this script, whatever
the working directory. --list prints the components and exits. With components named it installs exactly those, in
the order below; with none named it asks about each one.

Components, in install order:

  githooks        Copies harness/githooks and harness/leak-scan, as they are in the commit checked out, into
                  ~/.claude/harness/ and writes that commit's hash to ~/.claude/harness/SOURCE_COMMIT. The copies are
                  the commit's files with their modes, never the working tree. Each run replaces both directories
                  whole, so nothing else belongs in them; ~/.claude/harness/state/, where pre-push keeps its pass
                  cache, is kept.
  hooks-path      Sets core.hooksPath to ~/.claude/harness/githooks in each --repo. Git then runs only those hooks
                  in that repository, so its own hooks in .git/hooks stop running.
  skills          Copies each skill in harness/skills (a directory holding a SKILL.md), as it is in the commit checked
                  out, into ~/.claude/skills/<name>/, with each file's mode. An installed copy is yours to edit: when
                  it differs from the commit's, the run shows a diff from yours to the commit's and replaces yours
                  only if you answer yes. A replaced skill's directory is replaced whole, so files added to it by hand
                  go. Other skills in ~/.claude/skills are never touched.
  plugin:<name>   One per plugin in .claude-plugin/marketplace.json. Runs `claude plugin marketplace add
                  Runt9-Productions/runt9-claude-harness` and `claude plugin install <name>@runt9`. Plugins come from
                  GitHub, never from this clone.

Checks:

  - Refuses to run inside a Claude Code session (CLAUDE_CODE_SESSION_ID or CLAUDECODE set). --list still works.
  - An unknown component, or --repo without hooks-path, stops the run before anything is installed.
  - githooks and skills: refuse uncommitted changes to tracked files (untracked files are fine), and a symlink or
    submodule in what they copy. Warn, and install anyway, when HEAD is not reachable from origin/main as of the
    last fetch. A failed install leaves the previous one in place; for skills, each skill is either as it was or
    replaced whole.
  - hooks-path: refuses, before changing any repository, when githooks is not installed, when no --repo is given,
    or when a --repo is not the top level of a git repository. Prints a different core.hooksPath it replaces, so
    you can restore it. Fails when the value git reads back differs, because a config.worktree or an include sets
    another. Notes each repository without claude.botEmail, where the hooks run only the leak gate.
  - skills: refuses, before anything is installed, when ~/.claude/skills or a skill's directory in it resolves
    outside ~/.claude, such as through a symlink into another repository. Stops when an installed copy differs and
    stdin has no answer, so run it in a terminal.
  - plugin:<name>: warns when CLAUDE_CODE_PLUGIN_DIRS, in the shell or in the env block of ~/.claude/settings.json,
    also loads the plugin, since a session then runs that copy instead. Stops before running claude when a
    plugin.json there or the settings file cannot be read or is not a JSON object.

Nothing here keeps an agent from writing to ~/.claude/harness/ or ~/.claude/skills/; that is your harness's job.

Updating: for githooks and skills, check out main, pull and run `python3 bootstrap.py githooks skills` again. For a
plugin, run `claude plugin update <name>@runt9`; running this script again does not update a plugin already
installed.

Exits 0 when everything picked installed, otherwise 1 with one line naming the reason. A component installed before
a later one failed stays installed, and that line says which.
"""

import argparse
import difflib
import functools
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

CLONE = Path(__file__).resolve().parent
MARKETPLACE_FILE = CLONE / ".claude-plugin" / "marketplace.json"
MARKETPLACE_SOURCE = "Runt9-Productions/runt9-claude-harness"
UPSTREAM = "origin/main"
CLAUDE_DIR = Path.home() / ".claude"

INSTALL_DIR = CLAUDE_DIR / "harness"
SOURCE_COMMIT = "SOURCE_COMMIT"
# Installed side by side, because pre-push finds the scanner at ../leak-scan.
HARNESS_PARTS = ("githooks", "leak-scan")
FILE_MODES = {"100644": 0o644, "100755": 0o755}

SKILLS_DIR = CLAUDE_DIR / "skills"
SKILLS_SOURCE = "harness/skills"
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
    marketplace_added: bool = False

    @functools.cached_property
    def commit(self) -> str:
        """The commit every component from the clone installs."""
        return git(CLONE, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()

    @functools.cached_property
    def plugins_from_dirs(self) -> dict[str, str]:
        """Maps each plugin name CLAUDE_CODE_PLUGIN_DIRS loads to the entry that loads it."""
        loaded = {}
        for entry in plugin_dirs_entries():
            directory = Path(entry).expanduser()
            # Claude Code skips a relative entry, and an archive entry is not read here.
            if not directory.is_absolute() or not directory.is_dir():
                continue
            manifest = directory / ".claude-plugin" / "plugin.json"
            name = directory.name
            if manifest.exists():
                name = read_json_object(manifest).get("name")
            if isinstance(name, str):
                loaded[name] = entry
        return loaded


@dataclass(frozen=True)
class Component:
    name: str
    summary: str
    install: Callable[[Run], None]
    # Runs for every picked component before the first install, so a refusal installs nothing.
    check: Callable[[Run], object] | None = None
    # Installs files from the clone, so the checkout checks apply.
    from_clone: bool = False
    # Acts on the --repo paths; prompt mode offers it only when --repo is given.
    needs_repos: bool = False


def warn(message: str) -> None:
    print(f"bootstrap: warning: {message}", file=sys.stderr)


def run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True)


def git(cwd: Path, *args: str) -> bytes:
    result = run_git(cwd, *args)
    if result.returncode != 0:
        lines = result.stderr.decode(errors="replace").strip().splitlines()
        reason = lines[-1] if lines else f"exit {result.returncode}"
        raise Stop(f"git {' '.join(args)} failed in {cwd}: {reason}")
    return result.stdout


def git_config(repo: Path, *args: str) -> str | None:
    """The value of `git config <args>`, or None when the key is unset."""
    result = run_git(repo, "config", *args)
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        raise Stop(f"git config {' '.join(args)} failed in {repo}: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout.decode().strip()


def read_json_object(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise Stop(f"cannot read {path}: {error.strerror}") from error
    try:
        value = json.loads(text)
    except ValueError as error:
        raise Stop(f"{path} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise Stop(f"{path} is not a JSON object")
    return value


def check_checkout() -> None:
    changes = git(CLONE, "--no-optional-locks", "status", "--porcelain", "--untracked-files=no")
    if changes:
        raise Stop(f"{CLONE} has uncommitted changes to tracked files; commit or stash them, since only HEAD installs")
    if run_git(CLONE, "rev-parse", "--verify", "--quiet", f"refs/remotes/{UPSTREAM}^{{commit}}").returncode != 0:
        warn(f"there is no {UPSTREAM} to compare HEAD with; installing HEAD anyway")
        return
    reachable = run_git(CLONE, "merge-base", "--is-ancestor", "HEAD", UPSTREAM)
    if reachable.returncode == 1:
        warn(f"HEAD is not on {UPSTREAM} as of the last fetch; installing HEAD anyway")
    elif reachable.returncode != 0:
        raise Stop(f"git merge-base --is-ancestor HEAD {UPSTREAM} failed: {reachable.stderr.decode().strip()}")


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


def swap_in(staging: Path) -> None:
    """Renames each part from `staging` into INSTALL_DIR. When a rename fails, every part goes back as it was."""
    retired = staging / ".retired"
    retired.mkdir()
    swapped = []
    try:
        for part in HARNESS_PARTS:
            current = INSTALL_DIR / part
            if current.exists():
                current.rename(retired / part)
            (staging / part).rename(current)
            swapped.append(part)
    except OSError:
        for part in reversed(HARNESS_PARTS):
            current = INSTALL_DIR / part
            if part in swapped:
                current.rename(staging / part)
            if (retired / part).exists():
                (retired / part).rename(current)
        raise


def install_githooks(run: Run) -> None:
    commit = run.commit
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".bootstrap-", dir=INSTALL_DIR))
    try:
        for part in HARNESS_PARTS:
            export_tree(commit, f"harness/{part}", staging / part)
        swap_in(staging)
        # Written only once the swap has succeeded, so it never names a commit that is not installed.
        pending = staging / SOURCE_COMMIT
        pending.write_text(f"{commit}\n", encoding="utf-8")
        pending.replace(INSTALL_DIR / SOURCE_COMMIT)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    print(f"githooks: installed {' and '.join(HARNESS_PARTS)} from {commit} into {INSTALL_DIR}")


def check_hooks_path(run: Run) -> None:
    if not run.repos:
        raise Stop("hooks-path needs --repo <path>, once for each repository")
    for repo in run.repos:
        result = run_git(repo, "rev-parse", "--show-toplevel")
        if result.returncode != 0:
            raise Stop(f"{repo} is not a git repository")
        top_level = Path(result.stdout.decode().strip())
        if not top_level.samefile(repo):
            raise Stop(f"{repo} is inside the repository {top_level}, not its top level")


def install_hooks_path(run: Run) -> None:
    hooks = INSTALL_DIR / "githooks"
    if not (INSTALL_DIR / SOURCE_COMMIT).is_file():
        raise Stop(f"githooks is not installed in {INSTALL_DIR}; install it first")
    for repo in run.repos:
        previous = git_config(repo, "--local", "--get", "core.hooksPath")
        if previous is not None and previous != str(hooks):
            restore = f"git -C {repo} config core.hooksPath {previous}"
            print(f"hooks-path: {repo} had core.hooksPath {previous}; to restore it: {restore}")
        git(repo, "config", "--local", "core.hooksPath", str(hooks))
        effective = git_config(repo, "--get", "core.hooksPath")
        if effective != str(hooks):
            raise Stop(f"{repo} reads core.hooksPath as {effective}, not {hooks}; a config.worktree or include sets it")
        print(f"hooks-path: {repo} uses {hooks}")
        if not git_config(repo, "--get", "claude.botEmail"):
            warn(f"{repo} sets no claude.botEmail, so only the leak gate runs there")


@dataclass(frozen=True)
class SkillFile:
    mode: int
    content: bytes


def skill_names(commit: str) -> list[str]:
    listing = git(CLONE, "ls-tree", "-r", "-z", "--name-only", "--full-tree", commit, "--", SKILLS_SOURCE)
    names = []
    for entry in listing.split(b"\0"):
        path = PurePosixPath(os.fsdecode(entry))
        if path.name == SKILL_FILE and path.parent.parent == PurePosixPath(SKILLS_SOURCE):
            names.append(path.parent.name)
    return names


def resolve_inside_claude_dir(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(CLAUDE_DIR.resolve()):
        raise Stop(f"{path} resolves to {resolved}, outside {CLAUDE_DIR}; refusing to write through it")
    return resolved


def skill_targets(run: Run) -> dict[str, Path]:
    """Maps each skill in the commit to the directory it installs to, through any symlink inside ~/.claude."""
    resolve_inside_claude_dir(SKILLS_DIR)
    return {name: resolve_inside_claude_dir(SKILLS_DIR / name) for name in skill_names(run.commit)}


def read_skill(directory: Path) -> dict[str, SkillFile]:
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_dir():
            continue
        files[path.relative_to(directory).as_posix()] = SkillFile(path.stat().st_mode & 0o777, path.read_bytes())
    return files


def text_lines(file: SkillFile | None) -> list[str]:
    if file is None:
        return []
    return file.content.decode(errors="replace").splitlines()


def print_skill_diff(installed: dict[str, SkillFile], clone: dict[str, SkillFile]) -> None:
    """Prints a unified diff from the installed copy to the clone's, with a line for each changed file mode."""
    for path in sorted(installed.keys() | clone.keys()):
        before = installed.get(path)
        after = clone.get(path)
        if before == after:
            continue
        both = before is not None and after is not None
        if both and before.mode != after.mode:
            print(f"mode of {path}: {before.mode:o} installed, {after.mode:o} in the clone")
        lines = difflib.unified_diff(
            text_lines(before), text_lines(after), f"installed/{path}", f"clone/{path}", lineterm=""
        )
        for line in lines:
            print(line)


def should_replace(name: str, target: Path, staged: Path, run: Run) -> bool:
    """Whether the clone's copy of a skill goes over `target`, asking first when the installed copy differs."""
    if not target.exists():
        return True
    installed = read_skill(target)
    clone = read_skill(staged)
    if installed == clone:
        print(f"skills: {name} is up to date in {target}")
        return False
    print(f"skills: {target} differs from {SKILLS_SOURCE}/{name} in {run.commit}:")
    print_skill_diff(installed, clone)
    no_stdin = f"no answer on stdin to whether to replace {target}; run bootstrap.py in a terminal"
    if answered_yes(f"Replace {target} with the clone's copy? [y/N] ", no_stdin):
        return True
    print(f"skills: kept your copy of {name} in {target}")
    return False


def replace_skill(staged: Path, target: Path, previous: Path) -> None:
    """Renames `staged` to `target`. When that fails, the skill that was at `target` goes back."""
    if target.exists():
        target.rename(previous)
    try:
        staged.rename(target)
    except OSError:
        if previous.exists():
            previous.rename(target)
        raise


def install_skills(run: Run) -> None:
    targets = skill_targets(run)
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".bootstrap-", dir=SKILLS_DIR))
    try:
        # Every question is answered before the first skill is replaced, so no stdin stops the run with none written.
        replacing = []
        for name, target in targets.items():
            staged = staging / "clone" / name
            export_tree(run.commit, f"{SKILLS_SOURCE}/{name}", staged)
            if should_replace(name, target, staged, run):
                replacing.append(name)
        (staging / "previous").mkdir()
        for name in replacing:
            replace_skill(staging / "clone" / name, targets[name], staging / "previous" / name)
            print(f"skills: installed {name} from {run.commit} into {targets[name]}")
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def plugin_dirs_entries() -> list[str]:
    values = []
    if os.environ.get(PLUGIN_DIRS_VARIABLE):
        values.append(os.environ[PLUGIN_DIRS_VARIABLE])
    if SETTINGS_FILE.exists():
        env = read_json_object(SETTINGS_FILE).get("env")
        if isinstance(env, dict) and isinstance(env.get(PLUGIN_DIRS_VARIABLE), str):
            values.append(env[PLUGIN_DIRS_VARIABLE])
    entries = []
    for value in values:
        entries.extend(entry for entry in value.split(os.pathsep) if entry)
    return entries


def check_plugin(name: str, run: Run) -> None:
    if shutil.which("claude") is None:
        raise Stop("claude is not on PATH, and plugin components run it")
    entry = run.plugins_from_dirs.get(name)
    if entry is not None:
        warn(f"{PLUGIN_DIRS_VARIABLE} also loads {name} from {entry}, and a session runs that copy instead")


def claude(*args: str) -> None:
    result = subprocess.run(["claude", *args])
    if result.returncode != 0:
        raise Stop(f"claude {' '.join(args)} exited {result.returncode}")


def install_plugin(name: str, marketplace: str, run: Run) -> None:
    # Adding a marketplace that is already added succeeds, so a re-run needs no special case.
    if not run.marketplace_added:
        claude("plugin", "marketplace", "add", MARKETPLACE_SOURCE)
        run.marketplace_added = True
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
                check=functools.partial(check_plugin, name),
            )
        )
    return components


# Install order. A new installable part is one entry here and its install function.
HARNESS_COMPONENTS = (
    Component(
        name="githooks",
        summary="copy harness/githooks and harness/leak-scan from HEAD into ~/.claude/harness",
        install=install_githooks,
        from_clone=True,
    ),
    Component(
        name="hooks-path",
        summary="set core.hooksPath to ~/.claude/harness/githooks in each --repo",
        install=install_hooks_path,
        check=check_hooks_path,
        needs_repos=True,
    ),
    Component(
        name="skills",
        summary="copy the skills in harness/skills from HEAD into ~/.claude/skills, asking before replacing an edit",
        install=install_skills,
        check=skill_targets,
        from_clone=True,
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
    if any(component.from_clone for component in picked):
        check_checkout()
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
