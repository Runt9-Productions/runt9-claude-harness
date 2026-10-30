"""PreToolUse hook for Bash and Monitor: denies installing, removing or upgrading software.

Changing what software is on the machine needs the user's approval every time, however small the change, so the hook
denies it at the attempt. It is not a block on `sudo`: privileged work that installs nothing is allowed.

`shell_words` splits the command into simple commands the way the shell would, including those inside `$(...)`,
backticks, `<(...)`, subshells, `{ ...; }` groups and compound statements. Quoted text and heredoc bodies stay text,
apart from a `$(...)` or backtick substitution inside double quotes. Each command is judged by its program, found past
leading assignments and wrappers (`sudo`, `env`, `timeout`, `nice` and the like, with the values their options
take). Denied:

- a package manager changing packages: `apt`, `dpkg`, `snap`, `dnf`, `brew`, `gem`, `pipx`, `cargo install`,
  `go install`, `uv tool install`, `uv python install`, and `pacman` or `add-apt-repository` in any form;
- a global Node install, and any install naming a new package (`npm install <name>`, `uv add`, `cargo add`);
- `pip install` outside a virtual environment, and inside one unless it replays hashed requirements
  (`--require-hashes -r`); `uv sync` without `--locked` or `--frozen`;
- a package runner that can download (`npx`, `npm exec`, `pnpm dlx`, `yarn dlx`, `bunx`, `uvx`), unless told it may
  not (`npx --no-install`, `npm exec --no`);
- a download or lookup (`curl`, `wget`, `dig`, `nslookup`, `host`) whose output an interpreter runs: piped into one
  that reads its program from stdin, or substituted where it reads its program (`bash -c "$(curl ...)"`,
  `bash <(curl ...)`, `eval "$(curl ...)"`);
- `curl` or `wget` fetching a package file, or in the same command as an archive extractor.

Allowed: lockfile replays (`npm ci`, `uv sync --locked`), a bare `npm install`, `pnpm exec`, build tools whose
lifecycle says install (`mvn install`, `installDist`), and commands that only mention an install in text. A command
the tokenizer cannot split is denied only when its raw words name an install. Any error inside the hook denies, so
the guard fails closed.

Accepted false positives: a data archive fetched and unpacked is denied like a tool, since a wrong denial costs one
sentence and a missed install changes the machine; plain `pip` in a session started inside an activated virtual
environment is judged as outside one. Known gaps: a command inside a quoted string (`sh -c '...'`, `env -S`), a
download saved to a file and run later, project dependency updates (`npm update`, `uv run`), and installers not listed
(`make install`, `apk`, `conda`, `rustup`).
"""

from __future__ import annotations

import itertools
import json
import os
import re
import sys
from pathlib import Path

from shell_words import SHELL_TOOLS, Command, Word, command_name, nested_scripts, parse, raw_words, runnable, texts

APT_VERBS = {
    "install", "reinstall", "remove", "purge", "autoremove", "autopurge", "upgrade", "full-upgrade", "dist-upgrade",
    "safe-upgrade",
}  # fmt: skip
RPM_VERBS = {
    "install", "in", "reinstall", "remove", "rm", "erase", "update", "up", "upgrade", "dist-upgrade", "dup",
    "downgrade", "autoremove",
}  # fmt: skip
MUTATING_SUBCOMMANDS = {
    "apt": APT_VERBS,
    "apt-get": APT_VERBS,
    "aptitude": APT_VERBS,
    "yum": RPM_VERBS,
    "dnf": RPM_VERBS,
    "zypper": RPM_VERBS,
    "snap": {"install", "remove", "refresh"},
    "brew": {"install", "reinstall", "uninstall", "remove", "rm", "upgrade"},
    "gem": {"install", "uninstall", "update"},
    "cargo": {"install", "uninstall", "add"},
    "go": {"install", "get"},
    "pipx": {
        "install", "install-all", "uninstall", "uninstall-all", "upgrade", "upgrade-all", "reinstall", "reinstall-all",
        "inject", "uninject", "run",
    },
}  # fmt: skip
MACHINE_TOOLS = {"pacman", "add-apt-repository"}
RUNNERS = {"bunx", "uvx"}
DPKG_CHANGES = {"-i", "--install", "--unpack", "-r", "--remove", "-P", "--purge"}

NODE_MANAGERS = {"npm", "pnpm", "yarn", "bun"}
NODE_INSTALL_VERBS = {"install", "i", "in", "add"}
NODE_CHANGE_VERBS = NODE_INSTALL_VERBS | {"uninstall", "remove", "rm", "un", "update", "up", "upgrade"}
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
    "--report", "--timeout", "--retries", "--proxy", "--cert",
}  # fmt: skip
REQUIREMENT_OPTIONS = {"-r", "--requirement"}
LOCKED_FLAGS = {"--locked", "--frozen"}
UV_MACHINE_ACTIONS = {"tool": {"install", "upgrade", "uninstall", "run"}, "python": {"install", "uninstall", "upgrade"}}

DOWNLOADERS = {"curl", "wget"}
FETCHERS = DOWNLOADERS | {"dig", "nslookup", "host"}
EXTRACTORS = {"tar", "bsdtar", "unzip", "cpio", "7z", "7za"}
PACKAGE_EXTENSIONS = (".deb", ".rpm", ".appimage", ".msi", ".dmg", ".pkg", ".snap", ".exe")
SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
SOURCES = {"source", "."}
CODE_FLAGS = {"node": {"-e", "--eval", "-p", "--print"}, "perl": {"-e", "-E"}, "ruby": {"-e"}}
PYTHON_CODE_FLAGS = {"-c", "-m"}
STDIN_PATHS = {"-", "/dev/stdin"}
STDIN_REDIRECTS = {"<", "<<<"}


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
        if not word.startswith("-") or word == "-":
            positions.append(index)
        index += 1
    return positions


def subcommand(arguments: list[str], value_options: set[str] | None = None) -> tuple[str | None, list[str]]:
    """The first operand and the arguments after it."""
    positions = operand_positions(arguments, value_options or set())
    if not positions:
        return None, []
    return arguments[positions[0]], arguments[positions[0] + 1 :]


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
    if verb in NODE_CHANGE_VERBS and GLOBAL_FLAGS.intersection(arguments):
        return f"a global `{name} {verb}`"
    packages = [rest[index] for index in operand_positions(rest, NODE_VALUE_OPTIONS)]
    if verb in NODE_INSTALL_VERBS and packages:
        return f"`{name} {verb} {packages[0]}` names a new package"
    return None


def judge_pip(program: str, arguments: list[str], in_venv: bool) -> str | None:
    verb, rest = subcommand(arguments, PIP_VALUE_OPTIONS)
    if verb not in ("install", "uninstall"):
        return None
    if not in_venv:
        return f"`{program} {verb}` outside a virtual environment"
    if verb == "uninstall":
        return None
    packages = [rest[index] for index in operand_positions(rest, PIP_VALUE_OPTIONS)]
    if packages:
        return f"`{program} install {packages[0]}` names a new package"
    if "--require-hashes" in rest and REQUIREMENT_OPTIONS.intersection(rest):
        return None
    return f"`{program} install` without `--require-hashes -r`"


def judge_uv(arguments: list[str]) -> str | None:
    verb, rest = subcommand(arguments)
    if verb == "add":
        return "`uv add` names a new package"
    if verb == "sync":
        return None if LOCKED_FLAGS.intersection(rest) else "`uv sync` without `--locked` or `--frozen`"
    if verb == "pip":
        # uv installs into a virtual environment unless told `--system`.
        return judge_pip("uv pip", rest, "--system" not in rest)
    action, _ = subcommand(rest)
    if action in UV_MACHINE_ACTIONS.get(verb, set()):
        return f"`uv {verb} {action}`"
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
    verb, _ = subcommand(arguments)
    if verb in MUTATING_SUBCOMMANDS.get(name, set()):
        return f"`{name} {verb}`"
    if name == "dpkg":
        flag = next((argument for argument in arguments if argument in DPKG_CHANGES), None)
        return f"`dpkg {flag}`" if flag else None
    if name in NODE_MANAGERS:
        return judge_node(name, arguments)
    if name == "npx":
        return None if NO_DOWNLOAD.intersection(arguments) else "`npx` can download a package"
    if name == "uv":
        return judge_uv(arguments)
    if PIP.fullmatch(name):
        return judge_pip(name, arguments, activated or in_virtualenv(program, cwd))
    if PYTHON.fullmatch(name) and "-m" in arguments:
        module = arguments[arguments.index("-m") + 1 :]
        if module and PIP.fullmatch(module[0]):
            return judge_pip(f"{name} -m {module[0]}", module[1:], activated or in_virtualenv(program, cwd))
    return None


def is_interpreter(name: str) -> bool:
    return name in SHELLS or name in SOURCES or name in CODE_FLAGS or name == "eval" or bool(PYTHON.fullmatch(name))


def is_code_flag(name: str, word: str) -> bool:
    if name in SHELLS:
        # `-c` may share a cluster with other single-letter options, as in `bash -lc`.
        return word.startswith("-") and not word.startswith("--") and "c" in word
    if PYTHON.fullmatch(name):
        return word in PYTHON_CODE_FLAGS
    return word in CODE_FLAGS.get(name, set())


def code_input(name: str, arguments: list[Word]) -> tuple[bool, list[Word]]:
    """Whether an interpreter reads its program from stdin, and the words it reads its program from otherwise."""
    if name == "eval":
        return False, arguments
    if name in SOURCES:
        return bool(arguments) and arguments[0].text in STDIN_PATHS, arguments[:1]
    for index, word in enumerate(arguments):
        if is_code_flag(name, word.text):
            return False, arguments[index + 1 : index + 2]
    operands = [word for word in arguments if not word.text.startswith("-") or word.text in STDIN_PATHS]
    if name in SHELLS and "-s" in texts(arguments):
        return True, []
    if not operands or operands[0].text in STDIN_PATHS:
        return True, []
    return False, operands[:1]


def first_fetcher(script: list[Command]) -> str | None:
    for command in itertools.chain.from_iterable(nested_scripts(script)):
        words = runnable(command)
        if words and command_name(words[0].text) in FETCHERS:
            return command_name(words[0].text)
    return None


def judge_program_source(name: str, command: Command, arguments: list[Word]) -> str | None:
    """Whether an interpreter runs a fetcher's output substituted where it reads its program."""
    reads_stdin, program_words = code_input(name, arguments)
    if reads_stdin:
        redirected = [target for operator, target in command.redirects if operator in STDIN_REDIRECTS]
        program_words = [*program_words, *redirected]
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
    if is_interpreter(name):
        return judge_program_source(name, command, words[1:])
    if name in DOWNLOADERS:
        package = next((word.text for word in words[1:] if is_package_file(word.text)), None)
        if package:
            return f"`{name}` fetching a package file (`{package}`)"
    return None


def judge_pipes(script: list[Command]) -> str | None:
    """A fetcher piped, at any later stage of its pipeline, into an interpreter that reads its program from stdin."""
    fetcher = None
    for command in script:
        if not command.piped:
            fetcher = None
        words = runnable(command)
        if not words:
            continue
        name = command_name(words[0].text)
        if fetcher and is_interpreter(name) and code_input(name, words[1:])[0]:
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
            " however small or reversible the change: ask them to run it with a `!` prefix, or to grant it. If this"
            " changes no software (a data download, a lockfile replay), say so and ask for an exception; running it"
            " again through another tool, wrapper, interpreter or script is routing around the guard."
        )


if __name__ == "__main__":
    main()
