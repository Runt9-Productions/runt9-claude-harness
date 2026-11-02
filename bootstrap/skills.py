import os
from pathlib import Path

from bootstrap.core import CLAUDE_DIR, Run, Stop
from bootstrap.harness import CURRENT, require_harness

SKILLS_DIR = CLAUDE_DIR / "skills"
SKILL_FILE = "SKILL.md"


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
