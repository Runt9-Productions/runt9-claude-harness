import copy
import functools
import json
import re

from bootstrap.core import CLAUDE_DIR, Component, Run, Stop
from bootstrap.files import parse_json_object, read_json_object, write_after_asking
from bootstrap.harness import require_installed, shipped_in_head

SETTINGS = "settings"
SETTINGS_FILE = CLAUDE_DIR / "settings.json"
DEFAULT_INDENT = "  "


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


def updated_settings(settings: dict, old: dict, new: dict) -> dict:
    """A copy of `settings` moved from the installed fragment `old` to HEAD's `new`: a value or list entry still equal
    to `old`'s follows `new`, one that differs is the user's and stays, one `old` has and `settings` lacks stays
    absent, and what only `new` has is merged as `merge_settings` merges it. Raises Stop where `merge_settings`
    would."""
    updated = copy.deepcopy(replaced_old_entries(settings, old, new))
    merge_settings(updated, added_entries(settings, old, new))
    return updated


def added_entries(settings: dict, old: dict, new: dict) -> dict:
    """The keys and list entries `new` has and `old` lacks, leaving out all of `new` under a key `old` has and
    `settings` lacks, since the user removed that key."""
    added = {}
    for key, new_value in new.items():
        if key not in old:
            added[key] = new_value
            continue
        if key not in settings:
            continue
        old_value = old[key]
        if isinstance(old_value, dict) and isinstance(new_value, dict):
            present = settings[key]
            present_object = present if isinstance(present, dict) else {}
            entries = added_entries(present_object, old_value, new_value)
        elif isinstance(old_value, list) and isinstance(new_value, list):
            entries = [entry for entry in new_value if entry not in old_value]
        else:
            continue
        if entries:
            added[key] = entries
    return added


def replaced_old_entries(settings: dict, old: dict, new: dict) -> dict:
    """A copy of `settings` in which each plain value equal to `old`'s takes `new`'s, or goes when `new` lacks its key,
    and each entry of an `old` list that `new`'s lacks leaves the list. Values are shared with the arguments."""
    replaced = {}
    for key, present in settings.items():
        if key not in old:
            replaced[key] = present
            continue
        old_value = old[key]
        new_value = new.get(key)
        if isinstance(old_value, dict) and isinstance(present, dict):
            new_object = new_value if isinstance(new_value, dict) else {}
            remaining = replaced_old_entries(present, old_value, new_object)
        elif isinstance(old_value, list) and isinstance(present, list):
            new_list = new_value if isinstance(new_value, list) else []
            remaining = [entry for entry in present if entry in new_list or entry not in old_value]
        elif present != old_value:
            replaced[key] = present
            continue
        else:
            if key in new:
                replaced[key] = new_value
            continue
        # An object or list the user had empty is theirs; one these removals emptied came from the old fragment.
        emptied = bool(present) and not remaining
        if not emptied:
            replaced[key] = remaining
    return replaced


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
