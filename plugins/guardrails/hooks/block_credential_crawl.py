"""PreToolUse hook for Bash, Monitor, Read, Grep and Glob: denies reading a credential store, and searching outside
the project for credential values.

Credentials are off-limits whatever the goal. The hook judges the paths a call actually reads, never names that only
appear in the command:

- Read reads `file_path`; Glob lists `path` and the names its `pattern` spells; Grep reads `path` and the files its
  `glob` names.
- A Bash or Monitor command is split into simple commands by `shell_words`, which finds each one's program past
  assignments and wrappers, inside substitutions, subshells, compound statements and unquoted heredocs too. A known
  file-reading command reads its file operands (after the script or pattern for `sed`, `awk`, `jq` and the search
  commands, and before the destination for `cp`, `rsync` and `scp`), and any command reads the target of a `<`
  redirect. A recursive search reads its roots, the working directory when it names none, and `find` lists its roots
  and the names its name tests spell. Relative paths resolve from wherever a `cd` or `pushd` before them moved to;
  after `cd -` or `popd` they count as outside the project.

The plugin README lists the stores, the keywords, what is allowed and the known gaps. Two choices here are easy to
undo by accident: a search reaching outside the project is checked for a keyword in
every word but its roots, since an option the parser does not know can move the pattern; and a command the tokenizer
cannot split is denied when a raw word names a store, or when it runs a search and its text holds a keyword. Any
error inside the hook denies, so the guard fails closed.
"""

from __future__ import annotations

import fnmatch
import itertools
import json
import os
import re
import sys
from pathlib import Path

from shell_words import SHELL_TOOLS, Command, command_name, parse, raw_words, runnable, substituted_scripts, texts

LOCAL_DIR = Path.home() / ".claude" / "local" / "guardrails"
ALLOWED_SUFFIXES_FILE = "credential-allowed-suffixes.txt"

STORE_NAMES = {
    ".pgpass", ".netrc", ".git-credentials", ".pypirc", ".my.cnf", ".htpasswd", ".envrc",
    "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
    "id_rsa.pub", "id_ed25519.pub", "id_ecdsa.pub", "id_dsa.pub",
}  # fmt: skip
SHADOW_FILE = "/etc/shadow"
# Only the per-user copy holds a registry token; a project's own file sets options.
HOME_STORES = (".npmrc",)
KEY_EXTENSIONS = (".jks", ".p12", ".pfx", ".pem", ".key", ".keytab", ".keystore", ".truststore")
CREDENTIAL_DIRS = (".ssh", ".aws", ".docker", ".gnupg", ".kube", ".config/gh")
CREDENTIAL_DIR_ENDINGS = tuple(f"/{directory}" for directory in CREDENTIAL_DIRS)
# Files in a credential directory that hold no secret.
CREDENTIAL_DIR_EXCEPTIONS = ("/.ssh/known_hosts", "/.ssh/known_hosts.old", "/.ssh/config", "/.ssh/authorized_keys")
ENV_TEMPLATES = {".env.example", ".env.sample", ".env.template"}
SECRET_WORDS = ("database", "datasource", "credential", "secret", "password")
SECRET_EXTENSIONS = ("properties", "yml", "yaml", "xml", "json", "conf", "cnf", "ini", "toml", "env")
# The secret word stands as a word of the name, so `secrets.prod.yaml` counts and `passwordReset.json` does not.
SECRET_CONFIG = re.compile(rf"(^|[._-])({'|'.join(SECRET_WORDS)})s?([._-][^/]*)?\.({'|'.join(SECRET_EXTENSIONS)})$")
ENV_FILE = re.compile(r"\.env(\.[^/]+)?$")

# Names a wildcard is matched against, so `id_*` and `*.pem` count; a file in a credential directory is caught by
# its path instead.
GLOB_CANDIDATES = [*STORE_NAMES, ".env", *(f"x{extension}" for extension in KEY_EXTENSIONS)]
GLOB_CHARACTERS = re.compile(r"[*?\[]")
GLOB_WILDCARDS = re.compile(r"\[[^\]]*\]|[*?]")
# Below this, a wildcard's literal part is too generic to say which file it is after: `.*` and `*rc` also spell
# `.pgpass` and `.envrc`.
MIN_LITERAL_RUN = 3
# A name search for a fragment open at both ends (`*env*`) is after names, not one store.
NAME_FRAGMENT = re.compile(r"\*[^/*]+\*")
BRACE_LIST = re.compile(r"\{([^{}]*,[^{}]*)\}")

KEYWORD = re.compile(
    r"passw(or)?d|passphrase|credential|secret|token|(api|access|private)[\s_-]?key|bearer|jdbc:", re.IGNORECASE
)

# Commands that read their file operands, and those whose first operand is a script or pattern rather than a file.
READERS = {
    "cat", "tac", "nl", "head", "tail", "less", "more", "bat", "cut", "sort", "uniq", "wc", "strings", "xxd", "od",
    "hexdump", "base64", "diff", "cmp", "cp", "tar", "zip", "rsync", "scp", "source", ".", "vi", "vim", "nano", "yq",
}  # fmt: skip
SCRIPT_FIRST = {"sed", "awk", "jq"}
# With one of these the script arrives through the option, so every operand is a file.
SCRIPT_OPTIONS = {"-e", "-f", "--expression", "--file"}
# Options of the reading commands whose separate value is not a file they read: `scp -i ~/.ssh/key` signs in with
# the key rather than copying it.
READER_VALUE_OPTIONS = {
    "scp": {"-i", "-F", "-o", "-P", "-c", "-J", "-l", "-S"},
    "rsync": {"-e", "--rsh"},
}
# These write their last operand; `cp` writes elsewhere when the destination arrives through `-t`.
DESTINATION_LAST = {"cp", "rsync", "scp"}
CP_TARGET_OPTION = re.compile(r"-t|--target-directory")
DIRECTORY_CHANGERS = {"cd", "pushd", "popd"}
# Where `cd -`, `popd` and a bare `pushd` lead is not tracked; from here every relative path is outside the project.
UNTRACKED_DIRECTORY = "/"
FIND_LEADING_OPTIONS = {"-H", "-L", "-P"}
FIND_NAME_TESTS = {"-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename"}
SEARCHES = {"grep", "egrep", "fgrep", "rg", "ag", "ack"}
# rg, ag and ack recurse by default; grep only when told to.
RECURSIVE_BY_DEFAULT = {"rg", "ag", "ack"}
GREP_RECURSIVE = re.compile(r"^-[A-Za-z]*[rR]|^--(recursive|dereference-recursive|directories=recurse)$")
# Options of the search commands that take a separate value, so the value is not mistaken for an operand.
SEARCH_VALUE_OPTIONS = {
    "-e", "-f", "-g", "-t", "-T", "-m", "-A", "-B", "-C", "-d", "-D", "-j", "-M", "--glob", "--iglob", "--type",
    "--type-not", "--max-count", "--include", "--exclude", "--exclude-dir", "--regexp", "--file", "--max-depth",
    "--depth", "--context", "--after-context", "--before-context", "--max-filesize", "--max-columns", "--threads",
    "--directories", "--devices", "--ignore", "--ignore-dir", "--ignore-file",
}  # fmt: skip
PATTERN_OPTIONS = {"-e", "--regexp"}


def allowed_suffixes() -> list[str]:
    """The local exemptions; a missing or unreadable file is no exemptions, which keeps the restrictive default."""
    try:
        text = (LOCAL_DIR / ALLOWED_SUFFIXES_FILE).read_text()
    except (OSError, UnicodeDecodeError):
        return []
    lines = [line.strip() for line in text.splitlines()]
    return [line for line in lines if line and not line.startswith("#")]


def resolve(path: str, here: str) -> str:
    """`path` made absolute from `here`, with `~` and variables expanded and `..` folded; links are not followed."""
    expanded = Path(os.path.expandvars(path)).expanduser()
    return os.path.normpath(Path(here) / expanded)


def is_allowed(full: str) -> bool:
    return any(full.endswith("/" + suffix.lstrip("/")) or full == suffix for suffix in allowed_suffixes())


def in_credential_dir(lowered: str) -> bool:
    """Whether a lowercased absolute path is a credential directory, or anything below one that may hold a secret."""
    if lowered.endswith(CREDENTIAL_DIR_EXCEPTIONS):
        return False
    return any(f"/{directory}/" in lowered + "/" for directory in CREDENTIAL_DIRS)


def is_store(path: str, here: str) -> bool:
    full = resolve(path, here)
    lowered = full.lower()
    name = Path(lowered).name
    if name in ENV_TEMPLATES:
        return False
    if is_allowed(full):
        return False
    if name in STORE_NAMES or name.endswith(KEY_EXTENSIONS):
        return True
    if lowered.endswith(SHADOW_FILE) or in_credential_dir(lowered):
        return True
    if any(full == str(Path.home() / store) for store in HOME_STORES):
        return True
    return bool(ENV_FILE.fullmatch(name) or SECRET_CONFIG.search(name))


def is_credential_dir(path: str, here: str) -> bool:
    """Whether `path` is a credential directory or anything below one."""
    lowered = resolve(path, here).lower() + "/"
    return any(f"/{directory}/" in lowered for directory in CREDENTIAL_DIRS)


def inside(path: str, here: str, project: str) -> bool:
    full = resolve(path, here)
    root = os.path.normpath(project)
    return full == root or full.startswith(root + os.sep)


def expand_braces(word: str) -> list[str]:
    """Every spelling a brace list in `word` expands to; `${VAR}` holds no comma, so it stays as written."""
    match = BRACE_LIST.search(word)
    if not match:
        return [word]
    spellings = []
    for member in match.group(1).split(","):
        spellings += expand_braces(word[: match.start()] + member + word[match.end() :])
    return spellings


def spelling_names_store(path: str, here: str) -> bool:
    if is_store(path, here):
        return True
    last = path.rstrip("/").rsplit("/", 1)[-1].lower()
    if not GLOB_CHARACTERS.search(last):
        return False
    literal_runs = GLOB_WILDCARDS.split(last)
    if max(len(run) for run in literal_runs) < MIN_LITERAL_RUN:
        return False
    return any(fnmatch.fnmatchcase(candidate, last) for candidate in GLOB_CANDIDATES)


def names_store(path: str, here: str) -> bool:
    """Whether `path`, or a name its brace lists and wildcards can spell, is a store."""
    return any(spelling_names_store(spelling, here) for spelling in expand_braces(path))


def lists_stores(pattern: str, here: str) -> bool:
    """Whether a search that returns names only, for `pattern`, lists stores; a fragment such as `*env*` does not."""
    last = pattern.rstrip("/").rsplit("/", 1)[-1]
    return names_store(pattern, here) and not NAME_FRAGMENT.fullmatch(last)


def first_store(paths: list[str], here: str) -> str | None:
    """The denial for the first path that is, or can spell, a store."""
    for path in paths:
        if not names_store(path, here):
            continue
        if resolve(path, here).lower().endswith(CREDENTIAL_DIR_ENDINGS):
            return f"`{path}` holds credential files"
        return f"`{path}` is a credential file"
    return None


def option_value(word: str) -> tuple[str, str | None]:
    """An option and the value attached to it: `--regexp=x` and `-rnex` both give `x`, and None is no attached value.

    In a cluster of short options, the first that takes a value takes the rest of the cluster."""
    if word.startswith("--"):
        option, equals, value = word.partition("=")
        return option, value if equals else None
    for index, letter in enumerate(word[1:], start=2):
        if f"-{letter}" in SEARCH_VALUE_OPTIONS:
            return f"-{letter}", word[index:] or None
    return word, None


def search_parts(name: str, arguments: list[str]) -> tuple[list[str], bool, bool]:
    """A search command's operands, whether its pattern came through an option rather than the first operand, and
    whether it recurses."""
    pattern_given = False
    operands = []
    recursive = name in RECURSIVE_BY_DEFAULT
    index = 0
    while index < len(arguments):
        word = arguments[index]
        index += 1
        if word == "--":
            operands += arguments[index:]
            break
        if not word.startswith("-"):
            operands.append(word)
            continue
        option, value = option_value(word)
        flags = word.removesuffix(value) if value else word
        recursive = recursive or bool(GREP_RECURSIVE.match(flags))
        if value is None and option in SEARCH_VALUE_OPTIONS:
            value = arguments[index] if index < len(arguments) else ""
            index += 1
        pattern_given = pattern_given or option in PATTERN_OPTIONS
        # `grep -d recurse` recurses like `-r`.
        recursive = recursive or value == "recurse"
    return operands, pattern_given, recursive


def judge_search(name: str, arguments: list[str], here: str, project: str) -> str | None:
    operands, pattern_given, recursive = search_parts(name, arguments)
    paths = operands if pattern_given else operands[1:]
    reason = first_store(paths, here)
    if reason:
        return reason
    roots = paths or ["."]
    if recursive and any(is_credential_dir(root, here) for root in roots):
        return f"`{' '.join(roots)}` holds credential files"
    # An option this parser does not know can shift a root into the pattern's place or the pattern into the roots, so
    # any operand outside the project counts, and every word but the roots outside it is checked for a keyword.
    outside_roots = [root for root in roots if not inside(root, here, project)]
    operand_outside = any(not inside(operand, here, project) for operand in operands)
    if not outside_roots and not operand_outside:
        return None
    hits = [word for word in arguments if word not in outside_roots and KEYWORD.search(word)]
    return f"a search outside the project for a credential (`{' '.join(hits)}`)" if hits else None


def read_operands(name: str, arguments: list[str]) -> list[str]:
    """The operands of a reading command that name files it reads."""
    value_options = READER_VALUE_OPTIONS.get(name, set())
    operands = []
    index = 0
    while index < len(arguments):
        word = arguments[index]
        index += 1
        if word in value_options:
            index += 1
        elif not word.startswith("-"):
            operands.append(word)
    if name in SCRIPT_FIRST and not SCRIPT_OPTIONS.intersection(arguments):
        operands = operands[1:]
    targeted = name == "cp" and any(CP_TARGET_OPTION.match(word) for word in arguments)
    if name in DESTINATION_LAST and not targeted:
        operands = operands[:-1]
    return operands


def judge_find(arguments: list[str], here: str) -> str | None:
    """Judges `find` like Glob: its roots, and the names its name tests spell."""
    roots = []
    for word in arguments:
        if word in FIND_LEADING_OPTIONS:
            continue
        if word.startswith(("-", "(", "!")):
            break
        roots.append(word)
    for root in roots or ["."]:
        if is_credential_dir(root, here):
            return f"`{root}` holds credential files"
    tested = [value for test, value in itertools.pairwise(arguments) if test in FIND_NAME_TESTS]
    for value in tested:
        if lists_stores(value, here):
            return f"`{value}` names credential files"
    return None


def judge_command(command: Command, here: str, project: str) -> str | None:
    redirected = [target.text for operator, target in command.redirects if operator == "<"]
    reason = first_store(redirected, here)
    if reason:
        return reason
    words = texts(runnable(command))
    if not words:
        return None
    name = command_name(words[0])
    if name in SEARCHES:
        return judge_search(name, words[1:], here, project)
    if name == "find":
        return judge_find(words[1:], here)
    if name in READERS or name in SCRIPT_FIRST:
        return first_store(read_operands(name, words[1:]), here)
    return None


def directory_after(command: Command, here: str) -> str:
    """Where the shell is after `command`, which only `cd`, `pushd` and `popd` change."""
    words = texts(runnable(command))
    if not words or words[0] not in DIRECTORY_CHANGERS:
        return here
    name = words[0]
    operands = [word for word in words[1:] if not word.startswith("-") or word == "-"]
    if name == "cd" and not operands:
        return str(Path.home())
    if name == "popd" or not operands or operands[0] == "-":
        return UNTRACKED_DIRECTORY
    return resolve(operands[0], here)


def judge_script(script: list[Command], here: str, project: str) -> str | None:
    """Judges the commands in order, each substitution before the command it feeds."""
    for command in script:
        for substitution in substituted_scripts(command):
            reason = judge_script(substitution, here, project)
            if reason:
                return reason
        reason = judge_command(command, here, project)
        if reason:
            return reason
        here = directory_after(command, here)
    return None


def judge_bash(command: str, cwd: str) -> str | None:
    try:
        script = parse(command)
    except ValueError:
        return judge_unparsed(command, cwd)
    return judge_script(script, cwd, cwd)


def judge_unparsed(command: str, cwd: str) -> str | None:
    """Judges a command the tokenizer cannot split by its raw words, since which of them are read is unknown."""
    words = raw_words(command)
    store = next((word for word in words if names_store(word, cwd)), None)
    if store:
        return f"`{store}` is a credential file, in a command that does not parse"
    searches = any(command_name(word) in SEARCHES for word in words)
    keyword = KEYWORD.search(command)
    if searches and keyword:
        return f"a search for a credential (`{keyword.group()}`), in a command that does not parse"
    return None


def judge_glob(tool_input: dict, cwd: str) -> str | None:
    path = str(tool_input.get("path") or cwd)
    pattern = str(tool_input.get("pattern", ""))
    if is_credential_dir(path, cwd) or lists_stores(pattern, resolve(path, cwd)):
        return f"`{pattern}` in `{path}` names credential files"
    return None


def judge_grep(tool_input: dict, cwd: str) -> str | None:
    path = str(tool_input.get("path") or cwd)
    glob = str(tool_input.get("glob") or "")
    pattern = str(tool_input.get("pattern", ""))
    if is_store(path, cwd) or is_credential_dir(path, cwd):
        return f"`{path}` holds credentials"
    if glob and names_store(glob, cwd):
        return f"`{glob}` names credential files"
    if KEYWORD.search(pattern) and not inside(path, cwd, cwd):
        return f"a search outside the project for a credential (`{pattern}`)"
    return None


def judge(tool: str, tool_input: dict, cwd: str) -> str | None:
    if tool in SHELL_TOOLS:
        return judge_bash(str(tool_input.get("command", "")), cwd)
    if tool == "Read":
        path = str(tool_input.get("file_path", ""))
        return f"`{path}` is a credential file" if path and is_store(path, cwd) else None
    if tool == "Glob":
        return judge_glob(tool_input, cwd)
    if tool == "Grep":
        return judge_grep(tool_input, cwd)
    return None


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
        deny(f"The credential guard failed ({type(error).__name__}), so the call is refused. Tell the user.")
        return
    if matched:
        deny(
            f"{matched}. Credentials are off-limits whatever the goal: ask the user, or have them run it with a `!`"
            " prefix. If this is not a secret (a template, a class or key name), say so and ask for an exception;"
            " running it again through another tool, wrapper or script is routing around the guard."
        )


if __name__ == "__main__":
    main()
