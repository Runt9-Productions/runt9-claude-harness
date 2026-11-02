import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

CLONE = Path(__file__).resolve().parent.parent
CLAUDE_DIR = Path.home() / ".claude"


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


def answered_yes(question: str, no_stdin: str) -> bool:
    """Asks on stdin; `no_stdin` is the Stop message when stdin has no answer."""
    try:
        answer = input(question)
    except EOFError:
        raise Stop(no_stdin) from None
    return answer.strip().lower() in ("y", "yes")
