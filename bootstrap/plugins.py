import functools
import os
import shutil
import subprocess
from pathlib import PurePosixPath

from bootstrap.core import CLAUDE_DIR, CLONE, Component, Run, Stop, warn
from bootstrap.files import read_json_object
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


def template_source(name: str) -> str:
    return f"plugins/{name}/{TEMPLATE_DIR}/"


def check_plugin(name: str, run: Run) -> None:
    check_plugin_setup()
    # Called only for the Stop tree_files raises on a link or submodule, so the run refuses before anything installs.
    # copy_templates lists the files again after the install.
    tree_files("HEAD", template_source(name))


def copy_templates(name: str, run: Run) -> None:
    """Writes each file in the plugin's local.example/ in HEAD to `LOCAL_DIR`/<name>/<path>.example, keeping any such
    path that already exists. No skill reads that name, so nothing takes effect until the user saves a filled copy."""
    source = template_source(name)
    for file in tree_files("HEAD", source):
        relative = PurePosixPath(file.path).relative_to(source)
        destination = LOCAL_DIR / name / f"{relative}{TEMPLATE_SUFFIX}"
        content = git(CLONE, "cat-file", "blob", file.blob)
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            # Exclusive create, so neither a file nor a link already at the path is written through.
            with destination.open("xb") as template:
                template.write(content)
        except FileExistsError:
            print(f"plugin:{name}: kept {destination}, which already exists")
            continue
        print(f"plugin:{name}: wrote {destination}")
        run.templates.append(destination)


def install_plugin(name: str, marketplace: str, run: Run) -> None:
    add_marketplace()
    claude("plugin", "install", f"{name}@{marketplace}")
    copy_templates(name, run)


def plugin_components() -> list[Component]:
    marketplace = read_json_object(MARKETPLACE_FILE)
    marketplace_name = marketplace.get("name")
    plugins = marketplace.get("plugins")
    if not isinstance(marketplace_name, str) or not isinstance(plugins, list):
        raise Stop(f"{MARKETPLACE_FILE} needs a name and a plugins list")
    components = []
    for plugin in plugins:
        if not isinstance(plugin, dict) or not isinstance(plugin.get("name"), str):
            raise Stop(f"{MARKETPLACE_FILE} has a plugin entry without a name")
        name = plugin["name"]
        components.append(
            Component(
                name=f"plugin:{name}",
                summary=plugin.get("description", ""),
                install=functools.partial(install_plugin, name, marketplace_name),
                check=functools.partial(check_plugin, name),
            )
        )
    return components
