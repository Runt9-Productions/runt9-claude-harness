"""PreToolUse hook for Bash, Monitor, Read, Grep and Glob: denies reading a credential store, and searching outside
the project for credential values.

Credentials are off-limits whatever the goal. The hook judges the paths a call actually reads, never names that only
appear in the command:

- Read reads `file_path`; Glob lists `path` and the names its `pattern` spells; Grep reads `path` and the files its
  `glob` names.
- A Bash or Monitor command is split into simple commands by `shell_words`, which finds each one's program past
  assignments and wrappers, inside substitutions, subshells and compound statements too. A known file-reading command
  reads its file operands (after the script or pattern for `sed`, `awk`, `jq` and the search commands, and before the
  destination for `cp`), and any command reads the target of a `<` redirect. A recursive search reads its roots, the
  working directory when it names none. Relative paths resolve from wherever a `cd` or `pushd` before them moved to.

A path is a store when it is a well-known credential file, a file in a credential directory such as `~/.ssh` (apart
from the non-secret files listed for it), a private key or keystore, a `.env` file, or a config file whose name says
it holds secrets; a recursive search rooted in a credential directory reads stores too. A brace list is judged by each
spelling, and a wildcard counts when the path as written is a store, or when it matches a store's name and holds a
literal run of at least three characters (`id_*` and `.env*` do; `.*` and `*rc` do not). A search whose pattern names
a credential (password, secret, token, api_key, jdbc: and the like) is denied when it reaches outside the working
directory, where it reads as a hunt rather than work on the project, and in Grep when its `glob` covers config files
named for secrets.

Allowed: `.env.example`, `.env.sample` and `.env.template`, and the path suffixes listed one per line in
`~/.claude/local/guardrails/credential-allowed-suffixes.txt` (blank lines and `#` comments skipped). A command the
shell tokenizer cannot split is denied only when its raw text names a store. Any error inside the hook denies, so the
guard fails closed.

Known gaps: a path built at run time (`$FILE`); a file read by a script or interpreter, including a command inside a
quoted string (`sh -c '...'`); a reading command not on the list; a credential file with an unremarkable name; a
recursive search inside the project, which prints the matching lines of any store it passes, with Bash's `--include`
and `--glob` values unjudged; and a session started in the home directory, where every path is inside the project.
The sandbox's `credentials` setting covers interpreters.
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
# Files in a credential directory that hold no secret.
CREDENTIAL_DIR_EXCEPTIONS = ("/.ssh/known_hosts", "/.ssh/known_hosts.old", "/.ssh/config", "/.ssh/authorized_keys")
ENV_TEMPLATES = {".env.example", ".env.sample", ".env.template"}
SECRET_WORDS = ("database", "datasource", "credential", "secret", "password")
SECRET_EXTENSIONS = ("properties", "yml", "yaml", "xml", "json", "conf", "cnf", "ini", "toml", "env")
SECRET_CONFIG = re.compile(rf"({'|'.join(SECRET_WORDS)})[^/]*\.({'|'.join(SECRET_EXTENSIONS)})$")
ENV_FILE = re.compile(r"\.env(\.[^/]+)?$")

# Names a wildcard is matched against, so `id_*` and `*.pem` count; a file in a credential directory is caught by
# its path instead.
GLOB_CANDIDATES = [*STORE_NAMES, ".env", *(f"x{extension}" for extension in KEY_EXTENSIONS)]
SECRET_CONFIG_CANDIDATES = [
    f"{word}.{extension}" for word, extension in itertools.product(SECRET_WORDS, SECRET_EXTENSIONS)
]
GLOB_CHARACTERS = re.compile(r"[*?\[]")
GLOB_WILDCARDS = re.compile(r"\[[^\]]*\]|[*?]")
# Below this, a wildcard's literal part is too generic to say which file it is after: `.*` and `*rc` also spell
# `.pgpass` and `.envrc`.
MIN_LITERAL_RUN = 3
BRACE_LIST = re.compile(r"\{([^{}]*,[^{}]*)\}")

KEYWORD = re.compile(
    r"passw(or)?d|passphrase|credential|secret|token|(api|access|private)[\s_-]?key|bearer|jdbc:", re.IGNORECASE
)

# Commands that read their file operands, and those whose first operand is a script or pattern rather than a file.
READERS = {
    "cat", "tac", "nl", "head", "tail", "less", "more", "bat", "cut", "sort", "uniq", "wc", "strings", "xxd", "od",
    "hexdump", "base64", "diff", "cmp", "cp", "tar", "zip", "source", ".", "vi", "vim", "nano", "yq",
}  # fmt: skip
SCRIPT_FIRST = {"sed", "awk", "jq"}
# With one of these the script arrives through the option, so every operand is a file.
SCRIPT_OPTIONS = {"-e", "-f", "--expression", "--file"}
# `cp` writes its last operand, unless the destination arrives through `-t`.
CP_TARGET_OPTION = re.compile(r"-t|--target-directory")
DIRECTORY_CHANGERS = {"cd", "pushd"}
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
    """Whether a lowercased absolute path is a file below a credential directory that may hold a secret."""
    if lowered.endswith(CREDENTIAL_DIR_EXCEPTIONS):
        return False
    return any(f"/{directory}/" in lowered for directory in CREDENTIAL_DIRS)


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


def covers_secret_config(glob: str) -> bool:
    """Whether a glob's last component matches a config file named for secrets, such as `*.properties`."""
    last = glob.rsplit("/", 1)[-1].lower()
    pairs = itertools.product(SECRET_CONFIG_CANDIDATES, expand_braces(last))
    return any(fnmatch.fnmatchcase(candidate, spelling) for candidate, spelling in pairs)


def first_store(paths: list[str], here: str) -> str | None:
    for path in paths:
        if names_store(path, here):
            return f"`{path}` is a credential file"
    return None


def search_parts(name: str, arguments: list[str]) -> tuple[list[str], list[str], bool]:
    """A search command's patterns, its path operands, and whether it recurses."""
    patterns = []
    operands = []
    recursive = name in RECURSIVE_BY_DEFAULT
    index = 0
    while index < len(arguments):
        word = arguments[index]
        if word == "--":
            operands += arguments[index + 1 :]
            break
        if word in SEARCH_VALUE_OPTIONS:
            value = arguments[index + 1] if index + 1 < len(arguments) else ""
            if word in PATTERN_OPTIONS:
                patterns.append(value)
            # `grep -d recurse` recurses like `-r`.
            recursive = recursive or value == "recurse"
            index += 2
            continue
        if word.startswith("-"):
            recursive = recursive or bool(GREP_RECURSIVE.match(word))
            index += 1
            continue
        operands.append(word)
        index += 1
    if not patterns and operands:
        patterns.append(operands.pop(0))
    return patterns, operands, recursive


def judge_search(name: str, arguments: list[str], here: str, project: str) -> str | None:
    patterns, operands, recursive = search_parts(name, arguments)
    reason = first_store(operands, here)
    if reason:
        return reason
    roots = operands or ["."]
    if recursive and any(is_credential_dir(root, here) for root in roots):
        return f"`{' '.join(roots)}` holds credential files"
    outside = [root for root in roots if not inside(root, here, project)]
    if outside and any(KEYWORD.search(pattern) for pattern in patterns):
        return f"a search outside the project for a credential (`{' '.join(patterns)}`)"
    return None


def read_operands(name: str, arguments: list[str]) -> list[str]:
    """The operands of a reading command that name files it reads."""
    operands = [word for word in arguments if not word.startswith("-")]
    if name in SCRIPT_FIRST and not SCRIPT_OPTIONS.intersection(arguments):
        operands = operands[1:]
    if name == "cp" and not any(CP_TARGET_OPTION.match(word) for word in arguments):
        operands = operands[:-1]
    return operands


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
    if name in READERS or name in SCRIPT_FIRST:
        return first_store(read_operands(name, words[1:]), here)
    return None


def directory_after(command: Command, here: str) -> str:
    """Where the shell is after `command`: moved by `cd` or `pushd`, and left alone by `cd -` and anything else."""
    words = texts(runnable(command))
    if not words or words[0] not in DIRECTORY_CHANGERS:
        return here
    operands = [word for word in words[1:] if not word.startswith("-") or word == "-"]
    if not operands:
        return str(Path.home())
    if operands[0] == "-":
        return here
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
        # Unparseable: deny only when a word of the raw text names a store.
        hits = [word for word in raw_words(command) if is_store(word, cwd)]
        return f"`{hits[0]}` is a credential file, in a command that does not parse" if hits else None
    return judge_script(script, cwd, cwd)


def judge_glob(tool_input: dict, cwd: str) -> str | None:
    path = str(tool_input.get("path") or cwd)
    pattern = str(tool_input.get("pattern", ""))
    if is_credential_dir(path, cwd) or names_store(pattern, resolve(path, cwd)):
        return f"`{pattern}` in `{path}` names credential files"
    return None


def judge_grep(tool_input: dict, cwd: str) -> str | None:
    path = str(tool_input.get("path") or cwd)
    glob = str(tool_input.get("glob") or "")
    pattern = str(tool_input.get("pattern", ""))
    hunting = bool(KEYWORD.search(pattern))
    if is_store(path, cwd) or is_credential_dir(path, cwd):
        return f"`{path}` holds credentials"
    if glob and names_store(glob, cwd):
        return f"`{glob}` names credential files"
    if hunting and covers_secret_config(glob):
        return f"a search for a credential through config files (`{pattern}` in `{glob}`)"
    if hunting and not inside(path, cwd, cwd):
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
