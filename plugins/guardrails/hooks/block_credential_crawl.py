"""PreToolUse hook for Bash, Read, Grep and Glob: denies reading a credential store, and searching outside the
project for credential values.

Credentials are off-limits whatever the goal. The hook judges the paths a call actually reads, never names that only
appear in the command:

- Read reads `file_path`; Glob lists `path` and the names its `pattern` spells; Grep reads `path` and the files its
  `glob` names.
- In Bash, a known file-reading command reads its file operands (after the script or pattern for `sed`, `awk`, `jq`
  and the search commands), and any command reads the target of a `<` redirect. A recursive search reads its roots,
  the working directory when it names none.

A path is a store when it is a well-known credential file, a private key or keystore, a `.env` file, or a config file
whose name says it holds secrets; a recursive search rooted in a credential directory such as `~/.ssh` reads stores
too. A search whose pattern names a credential (password, api_key, jdbc: and the like) is denied only when it reaches
outside the working directory, where it reads as a hunt rather than work on the project.

Allowed: `.env.example`, `.env.sample` and `.env.template`, and the path suffixes listed one per line in
`~/.claude/local/guardrails/credential-allowed-suffixes.txt` (blank lines and `#` comments skipped). A command the
shell tokenizer cannot split is denied only when its raw text names a store. Any error inside the hook denies, so the
guard fails closed.

Known gaps: a path built at run time (`$FILE`), a file read by a script or interpreter, a reading command not on the
list, and a credential file with an unremarkable name. The sandbox's `credentials` setting covers interpreters.
"""

import fnmatch
import json
import os
import re
import shlex
import sys
from pathlib import Path

LOCAL_DIR = Path.home() / ".claude" / "local" / "guardrails"
ALLOWED_SUFFIXES_FILE = "credential-allowed-suffixes.txt"

STORE_NAMES = {
    ".pgpass", ".netrc", ".git-credentials", ".pypirc", ".my.cnf", ".htpasswd", ".envrc",
    "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
    "id_rsa.pub", "id_ed25519.pub", "id_ecdsa.pub", "id_dsa.pub",
}  # fmt: skip
# Stores known by their directory as well as their name.
STORE_PATHS = (".aws/credentials", ".aws/config", ".docker/config.json", ".config/gh/hosts.yml", "etc/shadow")
# Only the per-user copy holds a registry token; a project's own file sets options.
HOME_STORES = (".npmrc",)
KEY_EXTENSIONS = (".jks", ".p12", ".pfx", ".pem", ".keytab", ".keystore", ".truststore")
CREDENTIAL_DIRS = (".ssh", ".aws", ".docker", ".gnupg", ".config/gh")
ENV_TEMPLATES = {".env.example", ".env.sample", ".env.template"}
SECRET_CONFIG = re.compile(
    r"(database|datasource|credentials?|secrets?|passwords?)[^/]*\.(properties|ya?ml|xml|json|conf|cnf|ini|toml|env)$"
)
ENV_FILE = re.compile(r"\.env(\.[^/]+)?$")

KEYWORD = re.compile(
    r"passw(or)?d|passphrase|credential|(api|access|secret|private)[_-]?key|client[_-]?secret|auth[_-]?token"
    r"|bearer|jdbc:",
    re.IGNORECASE,
)

# Commands that read their file operands, and those whose first operand is a script or pattern rather than a file.
READERS = {
    "cat", "tac", "nl", "head", "tail", "less", "more", "bat", "cut", "sort", "uniq", "wc", "strings", "xxd", "od",
    "hexdump", "base64", "diff", "cmp", "cp", "tar", "zip", "source", ".", "vi", "vim", "nano", "yq",
}  # fmt: skip
SCRIPT_FIRST = {"sed", "awk", "jq"}
# With one of these the script arrives through the option, so every operand is a file.
SCRIPT_OPTIONS = {"-e", "-f", "--expression", "--file"}
SEARCHES = {"grep", "egrep", "fgrep", "rg", "ag", "ack"}
# rg, ag and ack recurse by default; grep only when told to.
RECURSIVE_BY_DEFAULT = {"rg", "ag", "ack"}
GREP_RECURSIVE = re.compile(r"^-[A-Za-z]*[rR]|^--(recursive|dereference-recursive)$")
# Options of the search commands that take a separate value, so the value is not mistaken for an operand.
SEARCH_VALUE_OPTIONS = {
    "-e", "-f", "-g", "-t", "-T", "-m", "-A", "-B", "-C", "--glob", "--type", "--type-not", "--max-count",
    "--include", "--exclude", "--exclude-dir", "--regexp", "--file",
}  # fmt: skip
PATTERN_OPTIONS = {"-e", "--regexp"}
WRAPPERS = {"sudo", "doas", "env", "command", "time", "nohup", "nice", "timeout", "xargs", "stdbuf"}
SEPARATORS = {";", "&&", "||", "|", "|&", "&", "\n"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def allowed_suffixes() -> list[str]:
    """The local exemptions; a missing or unreadable file is no exemptions, which keeps the restrictive default."""
    try:
        text = (LOCAL_DIR / ALLOWED_SUFFIXES_FILE).read_text()
    except (OSError, UnicodeDecodeError):
        return []
    lines = [line.strip() for line in text.splitlines()]
    return [line for line in lines if line and not line.startswith("#")]


def resolve(path: str, cwd: str) -> str:
    expanded = Path(path.replace("$HOME", str(Path.home()))).expanduser()
    return os.path.normpath(Path(cwd) / expanded)


def command_name(word: str) -> str:
    """The command a word runs, without its directory; `.` stays `.`, which `Path.name` would empty."""
    return word.rsplit("/", 1)[-1]


def is_store(path: str, cwd: str) -> bool:
    full = resolve(path, cwd)
    lowered = full.lower()
    name = Path(lowered).name
    if name in ENV_TEMPLATES:
        return False
    if any(full.endswith("/" + suffix.lstrip("/")) or full == suffix for suffix in allowed_suffixes()):
        return False
    if name in STORE_NAMES or name.endswith(KEY_EXTENSIONS):
        return True
    if any(lowered.endswith("/" + store) for store in STORE_PATHS):
        return True
    if any(full == str(Path.home() / store) for store in HOME_STORES):
        return True
    return bool(ENV_FILE.fullmatch(name) or SECRET_CONFIG.search(name))


def is_credential_dir(path: str, cwd: str) -> bool:
    full = resolve(path, cwd)
    return any(full == str(Path.home() / directory) or full.endswith("/" + directory) for directory in CREDENTIAL_DIRS)


def inside(path: str, cwd: str) -> bool:
    full = resolve(path, cwd)
    root = os.path.normpath(cwd)
    return full == root or full.startswith(root + os.sep)


def glob_names_store(pattern: str, cwd: str) -> bool:
    """Whether a glob's last component, taken literally or as a wildcard over the known names, names a store."""
    last = pattern.rstrip("/").rsplit("/", 1)[-1]
    if not last.strip("*?[]{}!"):
        return False
    if "*" not in last and "?" not in last and "[" not in last:
        return is_store(pattern, cwd)
    candidates = [*STORE_NAMES, ".env", *(f"x{extension}" for extension in KEY_EXTENSIONS)]
    return any(fnmatch.fnmatchcase(candidate, last.lower()) for candidate in candidates)


def segments(command: str) -> list[list[str]]:
    """The command's simple commands as word lists, split at the shell's control operators."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|<>")
    lexer.whitespace_split = True
    lexer.commenters = ""
    result: list[list[str]] = [[]]
    for token in lexer:
        if token in SEPARATORS or "\n" in token:
            result.append([])
        else:
            result[-1].append(token)
    return [words for words in result if words]


def strip_prefix(words: list[str]) -> list[str]:
    """`words` from the command they run, past assignments and wrappers with their options."""
    index = 0
    while index < len(words):
        word = words[index]
        if ASSIGNMENT.match(word) or (index > 0 and word.startswith("-")) or command_name(word) in WRAPPERS:
            index += 1
        else:
            break
    return words[index:]


def redirect_reads(words: list[str]) -> tuple[list[str], list[str]]:
    """The targets of `<` redirects, and the words with every redirect and its target removed."""
    reads = []
    kept = []
    skip = False
    for index, word in enumerate(words):
        if skip:
            skip = False
            continue
        if word in ("<", ">", ">>", "<<", "<<<", ">&", "<&") or (word.endswith((">", "<")) and word[:-1].isdigit()):
            skip = True
            if word == "<" and index + 1 < len(words):
                reads.append(words[index + 1])
            continue
        kept.append(word)
    return reads, kept


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
            if word in PATTERN_OPTIONS and index + 1 < len(arguments):
                patterns.append(arguments[index + 1])
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


def judge_segment(words: list[str], cwd: str) -> str | None:
    reads, words = redirect_reads(words)
    words = strip_prefix(words)
    for path in reads:
        if is_store(path, cwd):
            return f"`{path}` is a credential file"
    if not words:
        return None
    name = command_name(words[0])
    arguments = words[1:]
    if name in SEARCHES:
        patterns, operands, recursive = search_parts(name, arguments)
        roots = operands or ["."]
        for path in operands:
            if is_store(path, cwd):
                return f"`{path}` is a credential file"
        if recursive and any(is_credential_dir(root, cwd) for root in roots):
            return f"`{' '.join(roots)}` holds credential files"
        outside = [root for root in roots if not inside(root, cwd)]
        if outside and any(KEYWORD.search(pattern) for pattern in patterns):
            return f"a search outside the project for a credential (`{' '.join(patterns)}`)"
        return None
    operands = [word for word in arguments if not word.startswith("-")]
    if name in SCRIPT_FIRST and operands and not any(word in SCRIPT_OPTIONS for word in arguments):
        operands = operands[1:]
    if name in READERS or name in SCRIPT_FIRST:
        for path in operands:
            if is_store(path, cwd):
                return f"`{path}` is a credential file"
    return None


def judge_bash(command: str, cwd: str) -> str | None:
    try:
        parsed = segments(command)
    except ValueError:
        # Unparseable: deny only when a word of the raw text names a store.
        hits = [word for word in re.split(r"[\s'\"`;|&<>()]+", command) if word and is_store(word, cwd)]
        return f"`{hits[0]}` is a credential file, in a command that does not parse" if hits else None
    for words in parsed:
        reason = judge_segment(words, cwd)
        if reason:
            return reason
    return None


def judge(tool: str, tool_input: dict, cwd: str) -> str | None:
    if tool == "Bash":
        return judge_bash(str(tool_input.get("command", "")), cwd)
    if tool == "Read":
        path = str(tool_input.get("file_path", ""))
        return f"`{path}` is a credential file" if path and is_store(path, cwd) else None
    if tool == "Glob":
        path = str(tool_input.get("path") or cwd)
        pattern = str(tool_input.get("pattern", ""))
        if is_credential_dir(path, cwd) or glob_names_store(pattern, cwd):
            return f"`{pattern}` in `{path}` names credential files"
        return None
    if tool == "Grep":
        path = str(tool_input.get("path") or cwd)
        if is_store(path, cwd) or is_credential_dir(path, cwd):
            return f"`{path}` holds credentials"
        if glob_names_store(str(tool_input.get("glob", "")), cwd):
            return f"`{tool_input.get('glob')}` names credential files"
        if not inside(path, cwd) and KEYWORD.search(str(tool_input.get("pattern", ""))):
            return f"a search outside the project for a credential (`{tool_input.get('pattern')}`)"
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
