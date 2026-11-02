from bootstrap.core import Component
from bootstrap.fragments import fragment_components
from bootstrap.harness import check_checkout, install_harness
from bootstrap.hooks_path import check_hooks_path, install_hooks_path
from bootstrap.plugins import plugin_components
from bootstrap.settings import settings_components
from bootstrap.skills import check_skills, install_skills

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


def all_components() -> list[Component]:
    return [*HARNESS_COMPONENTS, *fragment_components(), *settings_components(), *plugin_components()]
