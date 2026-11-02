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
