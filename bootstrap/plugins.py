import functools
import os
import shutil
import subprocess

from bootstrap.core import CLONE, Component, Run, Stop, warn
from bootstrap.files import read_json_object
from bootstrap.settings import SETTINGS_FILE

MARKETPLACE_FILE = CLONE / ".claude-plugin" / "marketplace.json"
MARKETPLACE_SOURCE = "Runt9-Productions/runt9-claude-harness"
PLUGIN_DIRS_VARIABLE = "CLAUDE_CODE_PLUGIN_DIRS"


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


def install_plugin(name: str, marketplace: str, run: Run) -> None:
    add_marketplace()
    claude("plugin", "install", f"{name}@{marketplace}")


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
                check=lambda run: check_plugin_setup(),
            )
        )
    return components
