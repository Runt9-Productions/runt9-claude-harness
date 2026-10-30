"""PreToolUse hook for Bash and Monitor: denies installing, removing or upgrading software.

Changing what software is on the machine needs the user's approval every time, however small the change, so the hook
denies it at the attempt. `shell_words` splits the command into the simple commands it runs, nested ones included, and
each is judged by its program, found past assignments and wrappers, and a package manager's verb past the options before
it. The text a shell or `eval` runs as its program is judged as a command of its own. Any error inside the hook denies,
so the guard fails closed. The README's "Software installs" section lists what is denied, what is allowed and the known
gaps.
"""

from __future__ import annotations

import itertools
import json
import os
import re
import sys
from enum import Enum, auto
from pathlib import Path

from shell_words import (
    SHELL_TOOLS,
    Command,
    Word,
    command_name,
    nested_scripts,
    parse,
    raw_words,
    runnable,
    takes_value,
    texts,
)

APT_VERBS = {
    "install", "reinstall", "remove", "purge", "autoremove", "autopurge", "upgrade", "full-upgrade", "dist-upgrade",
    "safe-upgrade", "build-dep", "satisfy",
}  # fmt: skip
RPM_VERBS = {
    "install", "in", "reinstall", "remove", "rm", "erase", "update", "up", "upgrade", "dist-upgrade", "dup",
    "downgrade", "autoremove", "groupinstall", "groupupdate", "groupremove", "localinstall", "localupdate", "builddep",
    "distro-sync", "swap", "patch", "si", "source-install", "install-new-recommends", "inr",
}  # fmt: skip
VERSION_MANAGER_VERBS = {"install", "uninstall"}
CONDA_VERBS = {"install", "remove", "uninstall", "update", "upgrade"}
MUTATING_SUBCOMMANDS = {
    "apt": APT_VERBS,
    "apt-get": APT_VERBS,
    "aptitude": APT_VERBS,
    "yum": RPM_VERBS,
    "dnf": RPM_VERBS,
    "zypper": RPM_VERBS,
    "apk": {"add", "del", "upgrade", "fix"},
    "snap": {"install", "remove", "refresh"},
    "flatpak": {"install", "uninstall", "update"},
    "brew": {"install", "reinstall", "uninstall", "remove", "rm", "upgrade", "bundle", "tap", "untap", "autoremove"},
    "port": {"install", "uninstall", "upgrade", "selfupdate"},
    "conda": CONDA_VERBS,
    "mamba": CONDA_VERBS,
    "micromamba": CONDA_VERBS,
    "gem": {"install", "uninstall", "update"},
    "cargo": {"install", "uninstall", "add", "binstall"},
    "go": {"install", "get"},
    "poetry": {"add"},
    "deno": {"upgrade"},
    "pipx": {
        "install", "install-all", "uninstall", "uninstall-all", "upgrade", "upgrade-all", "reinstall", "reinstall-all",
        "inject", "uninject", "run",
    },
    "rustup": {"install", "uninstall", "update"},
    "nvm": VERSION_MANAGER_VERBS,
    "fnm": VERSION_MANAGER_VERBS,
    "volta": VERSION_MANAGER_VERBS,
    "pyenv": VERSION_MANAGER_VERBS,
    "rbenv": VERSION_MANAGER_VERBS,
    "asdf": VERSION_MANAGER_VERBS,
    "mise": VERSION_MANAGER_VERBS | {"use", "upgrade", "self-update"},
    "sdk": VERSION_MANAGER_VERBS | {"upgrade"},
}  # fmt: skip
RPM_GROUP_ACTIONS = {"install", "remove", "upgrade", "update", "switch-to"}
GH_EXTENSION_ACTIONS = {"install", "upgrade", "remove"}
# Verbs whose second word picks whether they change software, as in `dnf group install`.
MUTATING_ACTIONS = {
    "dnf": {"group": RPM_GROUP_ACTIONS, "groups": RPM_GROUP_ACTIONS, "module": RPM_GROUP_ACTIONS},
    "yum": {"group": RPM_GROUP_ACTIONS, "groups": RPM_GROUP_ACTIONS},
    "uv": {
        "tool": {"install", "upgrade", "uninstall", "run"},
        "python": {"install", "uninstall", "upgrade"},
        "self": {"update"},
    },
    "poetry": {"self": {"add", "install", "update", "remove"}},
    "gh": {"extension": GH_EXTENSION_ACTIONS, "ext": GH_EXTENSION_ACTIONS},
    "dotnet": {"tool": {"install", "update", "uninstall"}, "workload": {"install", "update", "uninstall"}},
    "nix": {"profile": {"install", "add", "upgrade", "remove"}},
    "rustup": {
        "toolchain": {"install", "add", "uninstall", "remove"},
        "target": {"add", "remove"},
        "component": {"add", "remove"},
        "self": {"update", "uninstall"},
    },
    "asdf": {"plugin": {"add", "remove", "update"}},
}
# Options that pick a changing mode of a tool whose actions are options, alone or leading a cluster (`rpm -ivh`).
MODE_OPTIONS = {
    "dpkg": {"-i", "--install", "--unpack", "-r", "--remove", "-P", "--purge"},
    "rpm": {"-i", "--install", "-U", "--upgrade", "-F", "--freshen", "-e", "--erase", "--reinstall"},
    "nix-env": {"-i", "--install", "-e", "--uninstall", "-u", "--upgrade"},
}
APT_VALUE_OPTIONS = {
    "-o", "--option", "-t", "--target-release", "--default-release", "-c", "--config-file", "-a", "--host-architecture",
}  # fmt: skip
RPM_VALUE_OPTIONS = {
    "--enablerepo", "--disablerepo", "--repo", "--repoid", "--setopt", "--releasever", "--installroot", "-c",
    "--config", "-x", "--exclude", "-d", "--debuglevel", "-e", "--errorlevel", "-R", "--root", "-p", "--plus-repo",
}  # fmt: skip
UV_VALUE_OPTIONS = {"--directory", "--project", "--cache-dir", "--config-file", "--color", "--python-preference"}
# Options a package manager takes before its verb, each with a separate value.
GLOBAL_VALUE_OPTIONS = {
    "apt": APT_VALUE_OPTIONS,
    "apt-get": APT_VALUE_OPTIONS,
    "aptitude": APT_VALUE_OPTIONS,
    "yum": RPM_VALUE_OPTIONS,
    "dnf": RPM_VALUE_OPTIONS,
    "zypper": RPM_VALUE_OPTIONS,
    "cargo": {"-Z", "-C", "--config", "--color"},
    "go": {"-C"},
    "uv": UV_VALUE_OPTIONS,
}
MACHINE_TOOLS = {"pacman", "add-apt-repository", "cargo-binstall"}
RUNNERS = {"bunx", "uvx", "pnpx"}
GO_BUILD_VALUE_OPTIONS = {"-C", "-tags", "-ldflags", "-gcflags", "-exec", "-mod", "-modfile", "-o", "-p", "-toolexec"}

NODE_MANAGERS = {"npm", "pnpm", "yarn", "bun", "deno"}
NODE_INSTALL_VERBS = {"install", "i", "in", "add"}
NODE_CHANGE_VERBS = NODE_INSTALL_VERBS | {"uninstall", "remove", "rm", "un", "update", "up", "upgrade"}
# `npm link` puts the package's programs on the global path.
NODE_LINK_VERBS = {"link", "ln"}
# Verbs that download an initializer package named by their operand and run it.
NODE_SCAFFOLDERS = {("npm", "init"), ("npm", "create"), ("pnpm", "create"), ("yarn", "create"), ("bun", "create")}
GLOBAL_FLAGS = {"-g", "--global", "--location=global"}
NODE_VALUE_OPTIONS = {
    "--prefix", "-C", "--dir", "--cwd", "-w", "--workspace", "--filter", "--registry", "--cache", "--userconfig",
    "--loglevel", "--omit", "--include",
}  # fmt: skip
NO_DOWNLOAD = {"--no-install", "--no"}

PIP = re.compile(r"pip[0-9.]*")
PYTHON = re.compile(r"python[0-9.]*")
# `-e` is left out so that an editable install's path counts as a package it names.
PIP_VALUE_OPTIONS = {
    "-r", "--requirement", "-c", "--constraint", "-t", "--target", "--prefix", "--root", "-i", "--index-url",
    "--extra-index-url", "-f", "--find-links", "--python", "--python-version", "--platform", "--cache-dir", "--log",
    "--report", "--timeout", "--retries", "--proxy", "--cert", "--only-binary", "--no-binary", "--trusted-host",
}  # fmt: skip
# `sync` is uv's and pipenv's replay of a requirements or lock file.
PIP_VERBS = {"install", "uninstall", "sync"}
LOCKED_FLAGS = {"--locked", "--frozen"}

DOWNLOADERS = {"curl", "wget"}
FETCHERS = DOWNLOADERS | {"dig", "nslookup", "host"}
EXTRACTORS = {"tar", "bsdtar", "unzip", "cpio", "7z", "7za"}
PACKAGE_EXTENSIONS = (".deb", ".rpm", ".appimage", ".msi", ".dmg", ".pkg", ".snap", ".exe")
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
SOURCES = {"source", "."}
CODE_FLAGS = {"node": {"-e", "--eval", "-p", "--print"}, "perl": {"-e", "-E"}, "ruby": {"-e"}}
PYTHON_CODE_FLAGS = {"-c", "-m"}
SHELL_VALUE_OPTIONS = {"-o", "+o", "-O", "+O", "--rcfile", "--init-file"}
PYTHON_VALUE_OPTIONS = {"-W", "-X"}
STDIN_PATHS = {"-", "/dev/stdin"}
STDIN_REDIRECTS = {"<", "<<<"}
# Redirects whose target is the text fed to stdin rather than a file: here-strings and heredocs.
TEXT_REDIRECTS = {"<<<", "<<", "<<-"}
STDIN_INPUTS = STDIN_REDIRECTS | TEXT_REDIRECTS


class ProgramSource(Enum):
    """Where an interpreter reads the program it runs."""

    STDIN = auto()
    # The operand after a code flag (`bash -c`), or every word of `eval`.
    CODE = auto()
    SCRIPT_FILE = auto()


def operand_positions(arguments: list[str], value_options: set[str]) -> list[int]:
    """Where the operands are, skipping options and the values of `value_options`."""
    positions = []
    index = 0
    while index < len(arguments):
        word = arguments[index]
        if word == "--":
            positions += range(index + 1, len(arguments))
            break
        if word in value_options:
            index += 2
            continue
        # A leading `+` selects a toolchain, as in `cargo +nightly install`.
        if not word.startswith(("-", "+")) or word == "-":
            positions.append(index)
        index += 1
    return positions


def subcommand(arguments: list[str], value_options: set[str]) -> tuple[str | None, list[str]]:
    """The first operand and the arguments after it."""
    positions = operand_positions(arguments, value_options)
    if not positions:
        return None, []
    return arguments[positions[0]], arguments[positions[0] + 1 :]


def mode_option(name: str, arguments: list[str]) -> str | None:
    modes = MODE_OPTIONS.get(name, set())
    for argument in arguments:
        leading = argument if argument.startswith("--") else argument[:2]
        if leading in modes:
            return argument
    return None


def in_virtualenv(program: str, cwd: str) -> bool:
    """Whether `program` is a path into a virtual environment, which keeps `pyvenv.cfg` beside its `bin`."""
    if "/" not in program:
        return False
    path = Path(cwd) / Path(os.path.expandvars(program)).expanduser()
    return (path.parent.parent / "pyvenv.cfg").is_file()


def activates_virtualenv(words: list[str]) -> bool:
    return len(words) > 1 and command_name(words[0]) in SOURCES and words[1].endswith("bin/activate")


def judge_node(name: str, arguments: list[str]) -> str | None:
    verb, rest = subcommand(arguments, NODE_VALUE_OPTIONS)
    if name == "yarn" and verb == "global":
        action, _ = subcommand(rest, NODE_VALUE_OPTIONS)
        return f"`yarn global {action}`" if action in NODE_CHANGE_VERBS else None
    if verb == "dlx" or (name == "bun" and verb == "x"):
        return f"`{name} {verb}` can download and run a package"
    if name == "npm" and verb in ("exec", "x"):
        return None if NO_DOWNLOAD.intersection(arguments) else f"`npm {verb}` can download a package"
    if verb in NODE_LINK_VERBS:
        return f"`{name} {verb}` links a package onto the global path"
    if verb in NODE_CHANGE_VERBS and GLOBAL_FLAGS.intersection(arguments):
        return f"a global `{name} {verb}`"
    packages = [rest[index] for index in operand_positions(rest, NODE_VALUE_OPTIONS)]
    if (name, verb) in NODE_SCAFFOLDERS and packages:
        return f"`{name} {verb} {packages[0]}` downloads and runs a package"
    if verb in NODE_INSTALL_VERBS and packages:
        return f"`{name} {verb} {packages[0]}` names a new package"
    return None


def judge_pip(program: str, arguments: list[str], in_venv: bool) -> str | None:
    verb, rest = subcommand(arguments, PIP_VALUE_OPTIONS)
    if verb not in PIP_VERBS:
        return None
    if not in_venv:
        return f"`{program} {verb}` outside a virtual environment"
    if verb != "install":
        return None
    packages = [rest[index] for index in operand_positions(rest, PIP_VALUE_OPTIONS)]
    if packages:
        return f"`{program} install {packages[0]}` names a new package"
    return None


def judge_uv(verb: str | None, rest: list[str]) -> str | None:
    if verb == "add":
        return "`uv add` names a new package"
    if verb == "sync":
        return None if LOCKED_FLAGS.intersection(rest) else "`uv sync` without `--locked` or `--frozen`"
    if verb == "pip":
        # uv installs into a virtual environment unless told `--system`.
        return judge_pip("uv pip", rest, "--system" not in rest)
    return None


def judge_install(words: list[str], cwd: str, activated: bool) -> str | None:
    """Whether a program and its arguments install, remove or upgrade software, by package manager or runner."""
    program = words[0]
    name = command_name(program)
    arguments = words[1:]
    if name in MACHINE_TOOLS:
        return f"`{name}`"
    if name in RUNNERS:
        return f"`{name}` can download and run a package"
    value_options = GLOBAL_VALUE_OPTIONS.get(name, set())
    verb, rest = subcommand(arguments, value_options)
    if verb in MUTATING_SUBCOMMANDS.get(name, set()):
        return f"`{name} {verb}`"
    action, _ = subcommand(rest, value_options)
    if action in MUTATING_ACTIONS.get(name, {}).get(verb, set()):
        return f"`{name} {verb} {action}`"
    mode = mode_option(name, arguments)
    if mode:
        return f"`{name} {mode}`"
    if name == "go" and verb == "run":
        packages = [rest[index] for index in operand_positions(rest, GO_BUILD_VALUE_OPTIONS)]
        # A module path with a version (`example.com/cmd@latest`) is fetched; a package in the module is not.
        if packages and "@" in packages[0]:
            return f"`go run {packages[0]}` can download and run a module"
        return None
    if name in NODE_MANAGERS:
        return judge_node(name, arguments)
    if name == "npx":
        return None if NO_DOWNLOAD.intersection(arguments) else "`npx` can download a package"
    if name == "uv":
        return judge_uv(verb, rest)
    if name == "pipenv":
        return judge_pip(name, arguments, "--system" not in arguments)
    if PIP.fullmatch(name):
        return judge_pip(name, arguments, activated or in_virtualenv(program, cwd))
    if PYTHON.fullmatch(name) and "-m" in arguments:
        module = arguments[arguments.index("-m") + 1 :]
        if module and PIP.fullmatch(module[0]):
            return judge_pip(f"{name} -m {module[0]}", module[1:], activated or in_virtualenv(program, cwd))
    return None


def is_interpreter(name: str) -> bool:
    return name in SHELLS or name in SOURCES or name in CODE_FLAGS or name == "eval" or bool(PYTHON.fullmatch(name))


def short_letters(option: str) -> str:
    """The letters of a cluster of short options (`-lc`); empty for a long option or an operand."""
    if option.startswith("--") or not option.startswith("-"):
        return ""
    return option[1:]


def is_code_flag(name: str, option: str) -> bool:
    if name in SHELLS:
        # `-c` may share a cluster with other single-letter options, as in `bash -lc`.
        return "c" in short_letters(option)
    if PYTHON.fullmatch(name):
        return option in PYTHON_CODE_FLAGS
    return option in CODE_FLAGS.get(name, set())


def interpreter_value_options(name: str) -> set[str]:
    if name in SHELLS:
        return SHELL_VALUE_OPTIONS
    if PYTHON.fullmatch(name):
        return PYTHON_VALUE_OPTIONS
    return set()


def is_interpreter_option(name: str, word: str) -> bool:
    if word in STDIN_PATHS:
        return False
    # A shell takes `+o pipefail` and `+x` as options too.
    return word.startswith("-") or (name in SHELLS and word.startswith("+"))


def split_options(name: str, arguments: list[Word]) -> tuple[list[str], list[Word]]:
    """An interpreter's options and its operands, which begin at `--` or at the first word that is not an option."""
    value_options = interpreter_value_options(name)
    options = []
    index = 0
    while index < len(arguments):
        word = arguments[index].text
        if word == "--":
            return options, arguments[index + 1 :]
        if not is_interpreter_option(name, word):
            break
        options.append(word)
        index += 2 if takes_value(word, value_options) else 1
    return options, arguments[index:]


def program_input(name: str, arguments: list[Word]) -> tuple[ProgramSource, list[Word]]:
    """Where an interpreter reads its program, with the words it reads it from (none for stdin)."""
    if name == "eval":
        return ProgramSource.CODE, arguments
    if name in SOURCES:
        if arguments and arguments[0].text in STDIN_PATHS:
            return ProgramSource.STDIN, []
        return ProgramSource.SCRIPT_FILE, arguments[:1]
    options, operands = split_options(name, arguments)
    if any(is_code_flag(name, option) for option in options):
        return ProgramSource.CODE, operands[:1]
    if name in SHELLS and any("s" in short_letters(option) for option in options):
        return ProgramSource.STDIN, []
    if not operands or operands[0].text in STDIN_PATHS:
        return ProgramSource.STDIN, []
    return ProgramSource.SCRIPT_FILE, operands[:1]


def first_fetcher(script: list[Command]) -> str | None:
    for command in itertools.chain.from_iterable(nested_scripts(script)):
        words = runnable(command)
        if words and command_name(words[0].text) in FETCHERS:
            return command_name(words[0].text)
    return None


def redirected_input(command: Command, operators: set[str]) -> list[Word]:
    return [target for operator, target in command.redirects if operator in operators]


def shell_program(name: str, command: Command, arguments: list[Word]) -> str | None:
    """The text a shell or `eval` runs as commands; None for another program, or a shell running a script file."""
    if name != "eval" and name not in SHELLS | SOURCES:
        return None
    source, program_words = program_input(name, arguments)
    if source is ProgramSource.STDIN:
        return "\n".join(texts(redirected_input(command, TEXT_REDIRECTS)))
    if source is ProgramSource.CODE:
        return " ".join(texts(program_words))
    return None


def judge_program_source(name: str, command: Command, arguments: list[Word]) -> str | None:
    """Whether an interpreter runs a fetcher's output substituted where it reads its program."""
    source, program_words = program_input(name, arguments)
    if source is ProgramSource.STDIN:
        program_words = redirected_input(command, STDIN_REDIRECTS)
    for word in program_words:
        for substitution in word.substitutions:
            fetcher = first_fetcher(substitution)
            if fetcher:
                return f"`{fetcher}` output run by `{name}`"
    return None


def is_package_file(word: str) -> bool:
    path = re.split(r"[?#]", word, maxsplit=1)[0]
    return path.lower().endswith(PACKAGE_EXTENSIONS)


def judge_command(command: Command, cwd: str, activated: bool) -> str | None:
    words = runnable(command)
    if not words:
        return None
    reason = judge_install(texts(words), cwd, activated)
    if reason:
        return reason
    name = command_name(words[0].text)
    program = shell_program(name, command, words[1:])
    if program:
        reason = judge_bash(program, cwd)
        if reason:
            return reason
    if is_interpreter(name):
        return judge_program_source(name, command, words[1:])
    if name in DOWNLOADERS:
        package = next((word.text for word in words[1:] if is_package_file(word.text)), None)
        if package:
            return f"`{name}` fetching a package file (`{package}`)"
    return None


def reads_program_from_pipe(name: str, command: Command, arguments: list[Word]) -> bool:
    """Whether an interpreter reads its program from a stdin no redirect of its own supplies."""
    if not is_interpreter(name):
        return False
    source, _ = program_input(name, arguments)
    return source is ProgramSource.STDIN and not redirected_input(command, STDIN_INPUTS)


def judge_pipes(script: list[Command]) -> str | None:
    """A fetcher before an interpreter that reads its program from stdin, anywhere later in the same script.

    The parser keeps no grouping, and a pipe into a `{ ...; }` group or subshell feeds every command inside it, so any
    such interpreter after a fetcher counts as reading the fetcher's output."""
    fetcher = None
    for command in script:
        words = runnable(command)
        if not words:
            continue
        name = command_name(words[0].text)
        if fetcher and reads_program_from_pipe(name, command, words[1:]):
            return f"`{fetcher}` piped into `{name}`"
        if name in FETCHERS:
            fetcher = name
    return None


def judge_fetch_and_extract(programs: list[list[str]]) -> str | None:
    names = [command_name(words[0]) for words in programs if words]
    downloader = next((name for name in names if name in DOWNLOADERS), None)
    extractor = next((name for name in names if name in EXTRACTORS), None)
    if downloader and extractor:
        return f"`{downloader}` and `{extractor}` in one command"
    return None


def judge_unparsed(command: str, cwd: str) -> str | None:
    """Judges the raw words of a command the tokenizer cannot split, reading a program at every word."""
    words = raw_words(command)
    for start in range(len(words)):
        reason = judge_install(words[start:], cwd, activated=False)
        if reason:
            return f"{reason}, in a command that does not parse"
    names = [command_name(word) for word in words]
    fetcher = next((name for name in names if name in FETCHERS), None)
    runner = next((name for name in names if is_interpreter(name) or name in EXTRACTORS), None)
    if fetcher and runner:
        return f"`{fetcher}` and `{runner}` in a command that does not parse"
    return None


def judge_bash(command: str, cwd: str) -> str | None:
    try:
        script = parse(command)
    except ValueError:
        return judge_unparsed(command, cwd)
    scripts = list(nested_scripts(script))
    commands = list(itertools.chain.from_iterable(scripts))
    programs = [texts(runnable(command)) for command in commands]
    activated = any(activates_virtualenv(words) for words in programs)
    for each in commands:
        reason = judge_command(each, cwd, activated)
        if reason:
            return reason
    for each in scripts:
        reason = judge_pipes(each)
        if reason:
            return reason
    return judge_fetch_and_extract(programs)


def judge(tool: str, tool_input: dict, cwd: str) -> str | None:
    if tool not in SHELL_TOOLS:
        return None
    return judge_bash(str(tool_input.get("command", "")), cwd)


def deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        cwd = str(payload.get("cwd") or Path.cwd())
        matched = judge(str(payload.get("tool_name", "")), payload.get("tool_input") or {}, cwd)
    except Exception as error:
        deny(f"The install guard failed ({type(error).__name__}), so the call is refused. Tell the user.")
        return
    if matched:
        deny(
            f"{matched}. Installing, removing or upgrading software always needs the user's explicit approval first,"
            " however small or reversible the change: ask the user to run it themselves with a `!` prefix, and say so"
            " if you believe it changes no software. Running it again through another tool, wrapper, interpreter or"
            " script is routing around the guard."
        )


if __name__ == "__main__":
    main()
