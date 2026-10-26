#!/usr/bin/env python3
"""Install the parts of this harness you pick.

Run it from a clone of this repository, in your own shell rather than a Claude Code session:

    python3 bootstrap.py                       ask about each component in turn
    python3 bootstrap.py githooks plugin:<name>
    python3 bootstrap.py hooks-path --repo <repo> --repo <other-repo>
    python3 bootstrap.py --list                list the components

Files are copied, never linked, so switching branches in the clone changes nothing installed: harness parts into
~/.claude/harness/, with the commit they came from in its SOURCE_COMMIT, and skills into ~/.claude/skills/. An
installed skill is yours to edit; when it differs from the clone's copy, a run shows the difference and asks before
replacing it. To update, check out main, pull and run it again.

It refuses a clone with uncommitted changes to tracked files, warns when HEAD is not on origin/main as of the last
fetch, and refuses inside a Claude Code session, whose agents are kept out of ~/.claude/harness/.
"""

import argparse
import difflib
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parent
HARNESS_PARTS = ("githooks", "leak-scan")
SKILLS_SOURCE = Path("harness") / "skills"
SOURCE_COMMIT_FILE = "SOURCE_COMMIT"
MAIN_REF = "origin/main"
MARKETPLACE_FILE = CHECKOUT / ".claude-plugin" / "marketplace.json"
MARKETPLACE_SOURCE = "Runt9-Productions/runt9-claude-harness"
PLUGIN_PREFIX = "plugin:"


class BootstrapError(Exception):
    pass


@dataclass(frozen=True)
class Context:
    claude_dir: Path
    repos: tuple[Path, ...]

    @property
    def install_dir(self) -> Path:
        return self.claude_dir / "harness"

    @property
    def skills_dir(self) -> Path:
        return self.claude_dir / "skills"


type Installer = Callable[[Context], None]


@dataclass(frozen=True)
class Component:
    name: str
    summary: str
    install: Installer


# Registration order is install order: hooks-path needs what githooks installs.
COMPONENTS: list[Component] = []


def register_component(name: str, summary: str) -> Callable[[Installer], Installer]:
    def register(install: Installer) -> Installer:
        COMPONENTS.append(Component(name, summary, install))
        return install

    return register


def run(args: list[str]) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=False)
    except FileNotFoundError as error:
        raise BootstrapError(f"{args[0]} is not on PATH") from error
    if result.returncode != 0:
        command = " ".join(args)
        raise BootstrapError(f"{command} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def git(repo: Path, *args: str) -> str:
    return run(["git", "-C", str(repo), *args])


def git_succeeds(repo: Path, *args: str) -> bool:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=False)
    return result.returncode == 0


def report(message: str) -> None:
    print(message, file=sys.stderr)


@register_component("githooks", "the authorship hooks and the leak gate, from harness/githooks and harness/leak-scan")
def install_githooks(context: Context) -> None:
    context.install_dir.mkdir(parents=True, exist_ok=True)
    for part in HARNESS_PARTS:
        copy_tracked(Path("harness") / part, context.install_dir / part)
    commit = git(CHECKOUT, "rev-parse", "HEAD")
    (context.install_dir / SOURCE_COMMIT_FILE).write_text(f"{commit}\n")
    report(f"installed {', '.join(HARNESS_PARTS)} from {commit} into {context.install_dir}")


def tracked_files(source: Path) -> list[Path]:
    listing = git(CHECKOUT, "ls-files", "-z", "--", str(source))
    files = [Path(name) for name in listing.split("\0") if name]
    if not files:
        raise BootstrapError(f"{source} holds no tracked files")
    return files


def copy_tracked(source: Path, destination: Path) -> None:
    """Replaces destination with the tracked files under source, so a file deleted from the repo leaves the install."""
    files = tracked_files(source)
    if destination.exists():
        shutil.rmtree(destination)
    for file in files:
        target = destination / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(CHECKOUT / file, target)


@register_component("hooks-path", "points core.hooksPath at the installed githooks in each repository named by --repo")
def install_hooks_path(context: Context) -> None:
    hooks = context.install_dir / "githooks"
    if not hooks.is_dir():
        raise BootstrapError(f"{hooks} does not exist; install the githooks component first")
    if not context.repos:
        raise BootstrapError("hooks-path needs at least one --repo")
    for repo in context.repos:
        git(repo, "config", "core.hooksPath", str(hooks))
        report(f"core.hooksPath in {repo} is now {hooks}")
        if not git_succeeds(repo, "config", "--get", "claude.botEmail"):
            report(f"note: {repo} sets no claude.botEmail, so only the leak gate runs there")


@register_component("skills", "the style-guide skills from harness/skills, copied into ~/.claude/skills")
def install_skills(context: Context) -> None:
    relatives = [file.relative_to(SKILLS_SOURCE) for file in tracked_files(SKILLS_SOURCE)]
    # A file directly under harness/skills, such as its README, is not a skill.
    names = sorted({relative.parts[0] for relative in relatives if len(relative.parts) > 1})
    for name in names:
        refuse_outside(context.skills_dir / name, context.claude_dir)
    for name in names:
        install_skill(SKILLS_SOURCE / name, context.skills_dir / name)


def refuse_outside(destination: Path, root: Path) -> None:
    """Catches a symlinked skills directory or skill pointing outside root, such as into another repository."""
    resolved = destination.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise BootstrapError(f"{destination} resolves to {resolved}, outside {root}; refusing to write there")


def install_skill(source: Path, destination: Path) -> None:
    if destination.exists():
        changes = installed_changes(source, destination)
        if not changes:
            report(f"{destination} is up to date")
            return
        report(changes)
        if not ask(f"Replace {destination} with the clone's copy shown above?", "rerun it in a terminal to answer"):
            report(f"kept {destination}")
            return
    copy_tracked(source, destination)
    report(f"installed {destination}")


def installed_changes(source: Path, destination: Path) -> str:
    """A diff from the installed copy to the clone's, empty when they match."""
    clone_files = {file.relative_to(source): CHECKOUT / file for file in tracked_files(source)}
    installed_files = {file.relative_to(destination): file for file in destination.rglob("*") if file.is_file()}
    lines = []
    for relative in sorted(clone_files.keys() | installed_files.keys()):
        before = read_lines(installed_files.get(relative))
        after = read_lines(clone_files.get(relative))
        name = destination / relative
        lines.extend(difflib.unified_diff(before, after, f"{name} (installed)", f"{name} (clone)"))
    return "".join(lines)


def read_lines(file: Path | None) -> list[str]:
    if file is None:
        return []
    return file.read_text().splitlines(keepends=True)


def install_plugin(marketplace: str, plugin: str, context: Context) -> None:
    # Read before installing, so a manifest that cannot be read refuses with nothing installed.
    loading = plugin_dirs_loading(plugin)
    run(["claude", "plugin", "marketplace", "add", MARKETPLACE_SOURCE])
    installed = run(["claude", "plugin", "install", f"{plugin}@{marketplace}"])
    report(installed)
    for directory in loading:
        report(f"warning: {plugin} also loads from {directory}; remove it from CLAUDE_CODE_PLUGIN_DIRS")


def plugin_dirs_loading(plugin: str) -> list[Path]:
    """The CLAUDE_CODE_PLUGIN_DIRS entries whose plugin is named plugin: its plugin.json name, else its directory."""
    matches = []
    for entry in os.environ.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(os.pathsep):
        if not entry:
            continue
        directory = Path(entry).expanduser()
        manifest = directory / ".claude-plugin" / "plugin.json"
        name = directory.name
        if manifest.is_file():
            name = manifest_name(manifest)
        if name == plugin:
            matches.append(directory)
    return matches


def manifest_name(manifest: Path) -> str:
    try:
        name = json.loads(manifest.read_text()).get("name")
    except (OSError, ValueError, AttributeError) as error:
        raise BootstrapError(f"cannot read {manifest}: {error}") from error
    if not isinstance(name, str):
        raise BootstrapError(f"{manifest} names no plugin")
    return name


def register_plugins() -> None:
    marketplace = json.loads(MARKETPLACE_FILE.read_text())
    for entry in marketplace["plugins"]:
        install = partial(install_plugin, marketplace["name"], entry["name"])
        COMPONENTS.append(Component(f"{PLUGIN_PREFIX}{entry['name']}", entry["description"], install))


def check_checkout() -> None:
    changes = git(CHECKOUT, "status", "--porcelain", "--untracked-files=no")
    if changes:
        raise BootstrapError(f"{CHECKOUT} has uncommitted changes; commit or stash them first:\n{changes}")
    if not git_succeeds(CHECKOUT, "merge-base", "--is-ancestor", "HEAD", MAIN_REF):
        report(f"warning: HEAD is not on {MAIN_REF} (as of the last fetch): installing unmerged code")


def picked_components(names: list[str]) -> list[Component]:
    """The named components in install order, or with no names, the ones the user says yes to."""
    known = {component.name for component in COMPONENTS}
    unknown = [name for name in names if name not in known]
    if unknown:
        raise BootstrapError(f"unknown component {', '.join(unknown)}; --list shows them")
    if names:
        return [component for component in COMPONENTS if component.name in names]
    picked = []
    for component in COMPONENTS:
        question = f"Install {component.name} ({component.summary})?"
        if ask(question, "name the components on the command line"):
            picked.append(component)
    return picked


def ask(question: str, without_stdin: str) -> bool:
    try:
        answer = input(f"{question} [y/N] ")
    except EOFError as error:
        raise BootstrapError(f"no answer on stdin; {without_stdin}") from error
    return answer.strip().lower() in ("y", "yes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("components", nargs="*", metavar="component", help="what to install; none asks about each")
    parser.add_argument("--repo", action="append", default=[], type=Path, help="a repository for hooks-path")
    parser.add_argument("--list", action="store_true", help="list the components and exit")
    arguments = parser.parse_args()

    register_plugins()
    if arguments.list:
        for component in COMPONENTS:
            print(f"{component.name}: {component.summary}")
        return
    if os.environ.get("CLAUDE_CODE_SESSION_ID"):
        sys.exit("bootstrap: refusing to run inside a Claude Code session; run it in your own shell")

    repos = tuple(repo.expanduser() for repo in arguments.repo)
    context = Context(Path.home() / ".claude", repos)
    try:
        check_checkout()
        for component in picked_components(arguments.components):
            component.install(context)
    except BootstrapError as error:
        sys.exit(f"bootstrap: {error}")


if __name__ == "__main__":
    main()
