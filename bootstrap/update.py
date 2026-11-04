"""`bootstrap.py --update`: finds each installed component where it already lives, prints what updating it would
change, asks, then applies the changes in install order. Every read and every question comes before the first write,
so a run stopped at a prompt changes nothing."""

import functools
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from bootstrap.core import CLONE, Run, Stop, answered_yes
from bootstrap.files import parse_json_object, print_diff, read_json_object, write_staged
from bootstrap.fragments import FRAGMENTS, USER_CLAUDE_MD
from bootstrap.git import git
from bootstrap.harness import (
    CURRENT,
    check_checkout,
    harness_version,
    install_harness,
    installed_version,
    shipped_in_head,
)
from bootstrap.plugins import (
    check_plugin,
    check_plugin_setup,
    head_plugin_version,
    installed_plugin_versions,
    print_templates,
    read_marketplace,
    update_plugin,
)
from bootstrap.registry import all_components
from bootstrap.settings import SETTINGS, SETTINGS_FILE, holds_an_entry, settings_text, updated_settings
from bootstrap.skills import check_skills, head_skill_names, install_skills, installed_skill_names, linked_skill_names

NO_STDIN = "no answer on stdin; run bootstrap.py --update in a terminal"
PLUGIN = "plugin:"
# Never found installed: core.hooksPath names the `current` link, so the hooks follow the harness.
HOOKS_PATH = "hooks-path"
IMPORT_PREFIX = "@~/"


@dataclass(frozen=True)
class Found:
    """An installed component and what updating it changes, empty when it is current."""

    name: str
    change: str = ""


@dataclass(frozen=True)
class SettingsChange:
    name: str
    old: dict
    new: dict
    # HEAD no longer ships the fragment, so `new` is empty and the change takes its entries out.
    removes: bool = False


@dataclass
class Survey:
    found: list[Found] = field(default_factory=list)
    # The harness, skills and plugin updates, in install order, which one question covers.
    updates: dict[str, Callable[[Run], None]] = field(default_factory=dict)
    settings_changes: list[SettingsChange] = field(default_factory=list)
    available: list[str] = field(default_factory=list)
    vanished: list[str] = field(default_factory=list)
    settings_before: str = ""
    settings: dict = field(default_factory=dict)
    marketplace: str = ""
    # HEAD's version of each plugin in `updates`.
    plugin_heads: dict[str, str] = field(default_factory=dict)


def unknown_components(names: list[str]) -> Stop:
    return Stop(f"unknown component {', '.join(names)}; python3 bootstrap.py --list shows them")


def update(names: list[str]) -> None:
    check_checkout()
    run = Run(repos=[])
    survey = surveyed(set(names), run)
    if names:
        survey = narrowed(survey, names)
    print_plan(survey, named=bool(names))
    if not survey.updates and not survey.settings_changes:
        print("Everything installed is current.")
        return

    skipped = []
    updates = survey.updates
    if updates and not answered_yes(f"Update {', '.join(updates)}? [y/N] ", NO_STDIN):
        skipped.extend(updates)
        updates = {}
    accepted_settings, settings_after = confirmed_settings(survey, skipped)

    steps = [([name], action) for name, action in updates.items() if not name.startswith(PLUGIN)]
    if accepted_settings:
        steps.append((accepted_settings, functools.partial(write_settings, settings_after)))
    steps += [([name], action) for name, action in updates.items() if name.startswith(PLUGIN)]
    for step_names, action in steps:
        try:
            action(run)
        except (Stop, OSError) as error:
            updated = ", ".join(run.installed) or "nothing"
            raise Stop(f"{', '.join(step_names)} failed: {error}; updated before it: {updated}") from error
        run.installed.extend(step_names)

    for name in plugins_left_behind(survey, run):
        run.installed.remove(name)
    print(f"Updated {', '.join(run.installed) or 'nothing'}.")
    if skipped:
        print(f"Skipped {', '.join(skipped)}.")
    print_templates(run)


def surveyed(names: set[str], run: Run) -> Survey:
    """Every installed component, with what HEAD ships and nothing installs and what is installed and HEAD no longer
    ships. Plugins are listed, which runs `claude`, only when no names are given or a plugin is named."""
    survey = Survey()
    harness_behind = survey_harness(survey)
    harness_moves = harness_behind and (not names or "harness" in names)
    survey_skills(survey, harness_moves)
    survey_fragments(survey)
    survey_settings(survey, harness_moves)
    if not names or any(name.startswith(PLUGIN) for name in names):
        survey_plugins(survey, run)
    return survey


def narrowed(survey: Survey, names: list[str]) -> Survey:
    """`survey` cut down to `names`. Raises Stop for a name that is unknown, never installed or not installed."""
    known = {component.name for component in all_components()}
    unknown = [name for name in names if name not in known and name not in survey.vanished]
    if unknown:
        raise unknown_components(unknown)
    if HOOKS_PATH in names:
        raise Stop(f"{HOOKS_PATH} has nothing to update: it names {CURRENT / 'githooks'}, which follows the harness")
    installed = {found.name for found in survey.found}
    missing = [name for name in names if name in known and name not in installed]
    if missing:
        raise Stop(f"not installed: {', '.join(missing)}; run bootstrap.py without --update to install")
    return Survey(
        found=[found for found in survey.found if found.name in names],
        updates={name: action for name, action in survey.updates.items() if name in names},
        settings_changes=[change for change in survey.settings_changes if change.name in names],
        vanished=[name for name in survey.vanished if name in names],
        settings_before=survey.settings_before,
        settings=survey.settings,
        marketplace=survey.marketplace,
        plugin_heads=survey.plugin_heads,
    )


def print_plan(survey: Survey, named: bool) -> None:
    """Prints, for example:

    harness: 0.1.0 to 0.2.0
    skills: link example-gamma
    fragment:example-rules: current
    available: plugin:example-two
    vanished: plugin:example-gone
    """
    for found in survey.found:
        print(f"{found.name}: {found.change or 'current'}")
    if named:
        for name in survey.vanished:
            print(f"{name}: vanished, since HEAD no longer ships it")
        return
    if survey.available:
        print(f"available: {', '.join(survey.available)}")
    if survey.vanished:
        print(f"vanished: {', '.join(survey.vanished)}")


def survey_harness(survey: Survey) -> bool:
    """Records the harness and returns whether it is behind HEAD."""
    installed = installed_version()
    if installed is None:
        survey.available.append("harness")
        return False
    head = harness_version("HEAD")
    if installed == head:
        survey.found.append(Found("harness"))
        return False
    survey.found.append(Found("harness", f"{installed} to {head}"))
    survey.updates["harness"] = install_harness
    return True


def survey_skills(survey: Survey, harness_moves: bool) -> None:
    """Skills are behind when the links differ from the skills of the harness this run leaves installed."""
    linked = linked_skill_names()
    if not linked or not CURRENT.is_dir():
        survey.available.append("skills")
        return
    wanted = head_skill_names() if harness_moves else installed_skill_names()
    changes = []
    added = sorted(wanted - linked)
    if added:
        changes.append(f"link {', '.join(added)}")
    removed = sorted(linked - wanted)
    if removed:
        changes.append(f"unlink {', '.join(removed)}")
    survey.found.append(Found("skills", "; ".join(changes)))
    if changes:
        check_skills()
        survey.updates["skills"] = install_skills


def imported_fragments() -> set[str]:
    """The names of the installed harness's fragments that ~/.claude/CLAUDE.md imports, on any line."""
    if not USER_CLAUDE_MD.exists():
        return set()
    directory = CURRENT / FRAGMENTS
    names = set()
    for line in USER_CLAUDE_MD.read_bytes().decode().splitlines():
        stripped = line.strip()
        if not stripped.startswith(IMPORT_PREFIX):
            continue
        path = Path.home() / stripped.removeprefix(IMPORT_PREFIX)
        if path.parent == directory and path.suffix == ".md":
            names.add(path.stem)
    return names


def survey_fragments(survey: Survey) -> None:
    """A fragment is never behind: its import names the file through `current`."""
    shipped = [path.stem for path in shipped_in_head(FRAGMENTS, ".md")]
    imported = imported_fragments()
    for name in shipped:
        if name in imported:
            survey.found.append(Found(f"fragment:{name}"))
        else:
            survey.available.append(f"fragment:{name}")
    for name in sorted(imported - set(shipped)):
        survey.vanished.append(f"fragment:{name}")


def survey_settings(survey: Survey, harness_moves: bool) -> None:
    """A settings fragment is installed when settings.json holds at least one entry of the installed harness's copy,
    and behind when moving settings.json from that copy to HEAD's changes it. One HEAD no longer ships is taken as
    empty when the harness moves, so its entries are offered for removal. Read before the harness moves, since the
    installed copy goes with the old version."""
    if SETTINGS_FILE.exists():
        survey.settings_before = SETTINGS_FILE.read_text(encoding="utf-8")
        survey.settings = parse_json_object(survey.settings_before, str(SETTINGS_FILE))
    held = {}
    for path in sorted((CURRENT / SETTINGS).glob("*.json")):
        fragment = read_json_object(path)
        if holds_an_entry(survey.settings, fragment):
            held[path.stem] = fragment

    shipped = shipped_in_head(SETTINGS, ".json")
    for path in shipped:
        name = f"settings:{path.stem}"
        if path.stem not in held:
            survey.available.append(name)
            continue
        old = held[path.stem]
        new = parse_json_object(git(CLONE, "show", f"HEAD:{path}"), f"{path} in HEAD")
        if updated_settings(survey.settings, old, new) == survey.settings:
            survey.found.append(Found(name))
            continue
        survey.found.append(Found(name, f"changes {SETTINGS_FILE}"))
        survey.settings_changes.append(SettingsChange(name, old, new))
    shipped_names = {path.stem for path in shipped}
    for stem, old in held.items():
        if stem in shipped_names:
            continue
        name = f"settings:{stem}"
        if not harness_moves:
            survey.vanished.append(name)
            continue
        survey.found.append(Found(name, f"HEAD no longer ships it; removes its entries from {SETTINGS_FILE}"))
        survey.settings_changes.append(SettingsChange(name, old, {}, removes=True))


def survey_plugins(survey: Survey, run: Run) -> None:
    check_plugin_setup()
    marketplace, plugins = read_marketplace()
    survey.marketplace = marketplace
    installed = installed_plugin_versions(marketplace)
    shipped = [plugin["name"] for plugin in plugins]
    for plugin in shipped:
        name = f"{PLUGIN}{plugin}"
        if plugin not in installed:
            survey.available.append(name)
            continue
        head = head_plugin_version(plugin)
        versions = installed[plugin]
        if versions == {head}:
            survey.found.append(Found(name))
            continue
        check_plugin(plugin, run)
        survey.found.append(Found(name, f"{', '.join(sorted(versions))} to {head}"))
        survey.updates[name] = functools.partial(update_plugin, plugin, marketplace)
        survey.plugin_heads[name] = head
    for plugin in sorted(set(installed) - set(shipped)):
        survey.vanished.append(f"{PLUGIN}{plugin}")


def confirmed_settings(survey: Survey, skipped: list[str]) -> tuple[list[str], str]:
    """Shows each changed fragment's diff against settings.json as the fragments accepted before it leave it, and asks
    about each. Returns the accepted fragments and the text to write; appends each declined one to `skipped`."""
    target = SETTINGS_FILE.resolve()
    settings = survey.settings
    text = survey.settings_before
    accepted = []
    for change in survey.settings_changes:
        updated = updated_settings(settings, change.old, change.new)
        # A fragment accepted before this one already made the same change.
        if updated == settings:
            accepted.append(change.name)
            continue
        after = settings_text(updated, survey.settings_before)
        print_diff(target, text, after)
        verb = "Remove" if change.removes else "Apply"
        if answered_yes(f"{verb} {change.name}? [y/N] ", NO_STDIN):
            settings = updated
            text = after
            accepted.append(change.name)
        else:
            skipped.append(change.name)
    return accepted, text


def write_settings(text: str, run: Run) -> None:
    target = SETTINGS_FILE.resolve()
    write_staged(target, text.encode())
    print(f"settings: wrote {target}")


def plugins_left_behind(survey: Survey, run: Run) -> list[str]:
    """The plugins updated in this run that `claude plugin list --json` still shows short of HEAD's version, each
    reported with the version it was left at."""
    updated = [name for name in run.installed if name in survey.plugin_heads]
    if not updated:
        return []
    listed = installed_plugin_versions(survey.marketplace)
    behind = []
    for name in updated:
        head = survey.plugin_heads[name]
        versions = listed.get(name.removeprefix(PLUGIN), set())
        if versions == {head}:
            continue
        left_at = ", ".join(sorted(versions)) or "no version"
        print(
            f"{name}: left at {left_at}, not HEAD's {head}: claude plugin update installs GitHub's main, which can"
            " differ from this checkout"
        )
        behind.append(name)
    return behind
