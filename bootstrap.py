"""Install the parts of runt9-claude-harness that cannot be plugins, and the plugins you pick.

    python3 bootstrap.py [component ...] [--repo <path> ...] [--list]

Run it in your own shell, not in a Claude Code session. With components named it installs exactly those, in the order
--list shows; with none named it asks about each one. README.md says what each component does and what it refuses.

Exits 0 when everything picked installed, otherwise 1 with one line naming the reason and what installed before it.
"""

import argparse
import os
import sys
from pathlib import Path

# Above every definition: on an older interpreter their annotations raise at import, before main could say why.
if sys.version_info < (3, 12):  # noqa: UP036 (ruff assumes the target version, and this check is for older ones)
    running = ".".join(str(part) for part in sys.version_info[:3])
    sys.exit(f"bootstrap: needs Python 3.12 or newer, and this is {running}")

# -P, -I and PYTHONSAFEPATH leave this directory off sys.path, and the bootstrap package beside this script is found
# through it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bootstrap.core import Component, Run, Stop, answered_yes
from bootstrap.registry import all_components

SESSION_VARIABLES = ("CLAUDE_CODE_SESSION_ID", "CLAUDECODE")


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
    components = all_components()
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
