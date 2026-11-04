import os
from pathlib import Path, PurePosixPath

from bootstrap.core import CLAUDE_DIR, Run, Stop
from bootstrap.harness import CURRENT, HARNESS_SOURCE, require_harness, tree_files

SKILLS_DIR = CLAUDE_DIR / "skills"
SKILLS_SOURCE = CURRENT / "skills"
SKILL_FILE = "SKILL.md"


def check_skills() -> None:
    resolved = SKILLS_DIR.resolve()
    if not resolved.is_relative_to(CLAUDE_DIR.resolve()):
        raise Stop(f"{SKILLS_DIR} resolves to {resolved}, outside {CLAUDE_DIR}; refusing to write through it")


def is_link_to(link: Path, target: Path) -> bool:
    return link.is_symlink() and link.readlink() == target


def installed_skill_names() -> set[str]:
    return {path.name for path in SKILLS_SOURCE.iterdir() if (path / SKILL_FILE).is_file()}


def head_skill_names() -> set[str]:
    """The skills the harness component installs from HEAD."""
    source = PurePosixPath(HARNESS_SOURCE, "skills")
    names = set()
    for file in tree_files("HEAD", f"{source}/"):
        path = PurePosixPath(file.path)
        if path.name == SKILL_FILE and path.parent.parent == source:
            names.add(path.parent.name)
    return names


def linked_skill_names() -> set[str]:
    """The names in `SKILLS_DIR` that link into the installed harness, including links its version no longer fills."""
    if not SKILLS_DIR.is_dir():
        return set()
    return {link.name for link in SKILLS_DIR.iterdir() if is_link_to(link, SKILLS_SOURCE / link.name)}


def install_skills(run: Run) -> None:
    require_harness()
    names = sorted(installed_skill_names())

    taken = []
    for name in names:
        link = SKILLS_DIR / name
        if os.path.lexists(link) and not is_link_to(link, SKILLS_SOURCE / name):
            taken.append(str(link))
    if taken:
        raise Stop(
            f"{', '.join(taken)} already exist and are not links into {SKILLS_SOURCE}; move them away to install these"
        )

    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    for name in names:
        link = SKILLS_DIR / name
        if not os.path.lexists(link):
            link.symlink_to(SKILLS_SOURCE / name)
            print(f"skills: linked {link} to {SKILLS_SOURCE / name}")

    # A skill that a later version dropped leaves its link dangling.
    for link in SKILLS_DIR.iterdir():
        if not link.is_symlink() or link.exists():
            continue
        if link.readlink().parent == SKILLS_SOURCE:
            link.unlink()
            print(f"skills: removed {link}, whose skill this version no longer has")
