from bootstrap.core import Component, Stop
from bootstrap.docs import ROOT_README, first_paragraph, table, with_installs
from bootstrap.fragments import fragment_components
from bootstrap.harness import HARNESS_SOURCE, check_checkout, install_harness
from bootstrap.hooks_path import check_hooks_path, install_hooks_path
from bootstrap.plugins import plugin_components
from bootstrap.settings import settings_components
from bootstrap.skills import check_skills, install_skills

PART_COLUMN = "What it is"
GITHOOKS_README = f"{HARNESS_SOURCE}/githooks/README.md"
SKILLS_README = f"{HARNESS_SOURCE}/skills/README.md"
SKILL_COLUMN = "covers"


def harness_description() -> str:
    return with_installs("harness", table(ROOT_README, PART_COLUMN))


def hooks_path_description() -> str:
    return with_installs("hooks-path", first_paragraph(GITHOOKS_README))


def skills_description() -> str:
    return with_installs("skills", first_paragraph(SKILLS_README), table(SKILLS_README, SKILL_COLUMN))


# Install order, ahead of the fragments, settings and plugins. Everything under harness/ arrives with the harness
# component; a part that must also be wired into ~/.claude or a repository is one entry here and its install function.
HARNESS_COMPONENTS = (
    Component(
        name="harness",
        summary="the harness itself: git hooks, leak scan, CLAUDE.md and settings fragments, status line and skills,"
        " as one version",
        install=install_harness,
        description=harness_description,
        check=lambda run: check_checkout(),
    ),
    Component(
        name="hooks-path",
        summary="runs the harness's git hooks (bot authorship check, leak gate) in each --repo",
        install=install_hooks_path,
        description=hooks_path_description,
        check=check_hooks_path,
        needs_repos=True,
    ),
    Component(
        name="skills",
        summary="style-guide skills for code, comments, Python, Kotlin and TypeScript, plus question-pages",
        install=install_skills,
        description=skills_description,
        check=lambda run: check_skills(),
    ),
)


def all_components() -> list[Component]:
    return [*HARNESS_COMPONENTS, *fragment_components(), *settings_components(), *plugin_components()]


def unknown_components(names: list[str]) -> Stop:
    return Stop(f"unknown component {', '.join(names)}; python3 bootstrap.py --list shows them")
