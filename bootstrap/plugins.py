import functools
import json
import os
import shutil
import subprocess
from pathlib import Path, PurePosixPath

from bootstrap.core import CLAUDE_DIR, CLONE, Component, Run, Stop, warn
from bootstrap.docs import first_paragraph
from bootstrap.files import parse_json_object, read_json_object, write_staged
from bootstrap.git import git
from bootstrap.harness import tree_files
from bootstrap.settings import SETTINGS_FILE

MARKETPLACE_FILE = CLONE / ".claude-plugin" / "marketplace.json"
MARKETPLACE_SOURCE = "Runt9-Productions/runt9-claude-harness"
PLUGIN_DIRS_VARIABLE = "CLAUDE_CODE_PLUGIN_DIRS"
LOCAL_DIR = CLAUDE_DIR / "local"
TEMPLATE_DIR = "local.example"
TEMPLATE_SUFFIX = ".example"


# Cached so it runs once per run, however many plugins are picked.
@functools.cache
def check_plugin_setup() -> None:
    if shutil.which("claude") is None:
        raise Stop("claude is not on PATH, and plugin components run it")
    values = []
    if os.environ.get(PLUGIN_DIRS_VARIABLE):
        values.append(os.environ[PLUGIN_DIRS_VARIABLE])
    if SETTINGS_FILE.exists():
        env = read_json_object(SETTINGS_FILE).get("env")
        if isinstance(env, dict) and env.get(PLUGIN_DIRS_VARIABLE):
            values.append(env[PLUGIN_DIRS_VARIABLE])
    for value in values:
        warn(f"{PLUGIN_DIRS_VARIABLE} is {value}, and a plugin it loads replaces the installed one of the same name")


def claude(*args: str) -> None:
    result = subprocess.run(["claude", *args])
    if result.returncode != 0:
        raise Stop(f"claude {' '.join(args)} exited {result.returncode}")


# Cached so it runs once per run. Adding a marketplace already added succeeds, so a re-run needs no special case.
@functools.cache
def add_marketplace() -> None:
    claude("plugin", "marketplace", "add", MARKETPLACE_SOURCE)


# Cached so it runs once per run, before the first plugin update.
@functools.cache
def refresh_marketplace(marketplace: str) -> None:
    claude("plugin", "marketplace", "update", marketplace)


def template_source(name: str) -> str:
    return f"plugins/{name}/{TEMPLATE_DIR}/"


def check_plugin(name: str, run: Run) -> None:
    check_plugin_setup()
    # Called only for the Stop tree_files raises on a link or submodule, so the run refuses before anything installs.
    # copy_templates lists the files again after the install.
    tree_files("HEAD", template_source(name))


def is_stale_template(path: Path, content: bytes) -> bool:
    """Whether `path` is a regular file, not a link, holding something other than `content`."""
    if path.is_symlink() or not path.is_file():
        return False
    return path.read_bytes() != content


def copy_templates(name: str, run: Run, *, rewrite_changed: bool = False) -> None:
    """Writes each file in the plugin's local.example/ in HEAD to `LOCAL_DIR`/<name>/<path>.example, keeping any such
    path that already exists, unless `rewrite_changed` is set and it is a file whose content differs. No skill reads
    that name, so nothing takes effect until the user saves a filled copy."""
    source = template_source(name)
    for file in tree_files("HEAD", source):
        relative = PurePosixPath(file.path).relative_to(source)
        destination = LOCAL_DIR / name / f"{relative}{TEMPLATE_SUFFIX}"
        content = git(CLONE, "cat-file", "blob", file.blob)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if rewrite_changed and is_stale_template(destination, content):
            write_staged(destination, content)
            print(f"plugin:{name}: rewrote {destination}")
            run.templates.append(destination)
            continue
        try:
            # Exclusive create, so neither a file nor a link already at the path is written through.
            with destination.open("xb") as template:
                template.write(content)
        except FileExistsError:
            print(f"plugin:{name}: kept {destination}, which already exists")
            continue
        print(f"plugin:{name}: wrote {destination}")
        run.templates.append(destination)


def print_templates(run: Run) -> None:
    if run.templates:
        print("Templates to fill in, saved without .example to take effect:")
        for template in run.templates:
            print(template)


def install_plugin(name: str, marketplace: str, run: Run) -> None:
    add_marketplace()
    claude("plugin", "install", f"{name}@{marketplace}")
    copy_templates(name, run)


def update_plugin(name: str, marketplace: str, run: Run) -> None:
    refresh_marketplace(marketplace)
    claude("plugin", "update", f"{name}@{marketplace}")
    copy_templates(name, run, rewrite_changed=True)


def read_marketplace() -> tuple[str, list[dict]]:
    """The marketplace's name and its plugin entries, each of which has a name."""
    marketplace = read_json_object(MARKETPLACE_FILE)
    marketplace_name = marketplace.get("name")
    plugins = marketplace.get("plugins")
    if not isinstance(marketplace_name, str) or not isinstance(plugins, list):
        raise Stop(f"{MARKETPLACE_FILE} needs a name and a plugins list")
    for plugin in plugins:
        if not isinstance(plugin, dict) or not isinstance(plugin.get("name"), str):
            raise Stop(f"{MARKETPLACE_FILE} has a plugin entry without a name")
    return marketplace_name, plugins


def head_plugin_version(name: str) -> str:
    manifest = f"plugins/{name}/.claude-plugin/plugin.json"
    origin = f"{manifest} in HEAD"
    version = parse_json_object(git(CLONE, "show", f"HEAD:{manifest}"), origin).get("version")
    if not isinstance(version, str):
        raise Stop(f"{origin} has no version")
    return version


def installed_plugin_versions(marketplace: str) -> dict[str, set[str]]:
    """The versions `claude plugin list --json` reports for each plugin installed from `marketplace`, by plugin name.
    A plugin installed in more than one scope can have more than one."""
    command = ["claude", "plugin", "list", "--json"]
    shown = " ".join(command)
    result = subprocess.run(command, stdout=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise Stop(f"{shown} exited {result.returncode}")
    try:
        listed = json.loads(result.stdout)
    except ValueError as error:
        raise Stop(f"{shown} printed something other than JSON: {error}") from error
    if not isinstance(listed, list):
        raise Stop(f"{shown} printed something other than a list")
    suffix = f"@{marketplace}"
    versions: dict[str, set[str]] = {}
    for entry in listed:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            raise Stop(f"{shown} listed an entry without an id")
        if not entry["id"].endswith(suffix):
            continue
        version = entry.get("version")
        if not isinstance(version, str):
            raise Stop(f"{shown} listed {entry['id']} without a version")
        versions.setdefault(entry["id"].removesuffix(suffix), set()).add(version)
    return versions


def plugin_components() -> list[Component]:
    marketplace_name, plugins = read_marketplace()
    components = []
    for plugin in plugins:
        name = plugin["name"]
        components.append(
            Component(
                name=f"plugin:{name}",
                summary=plugin.get("description", ""),
                install=functools.partial(install_plugin, name, marketplace_name),
                description=functools.partial(first_paragraph, f"plugins/{name}/README.md"),
                check=functools.partial(check_plugin, name),
            )
        )
    return components
