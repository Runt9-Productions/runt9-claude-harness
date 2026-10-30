"""Shell parsing shared by the guardrails hooks that judge Bash and Monitor commands.

`parse` splits a command into simple commands the way the shell would, including those inside `$(...)`, backticks,
`<(...)`, subshells, `{ ...; }` groups and compound statements. Quoted text stays text, apart from a `$(...)` or
backtick substitution inside double quotes, and arithmetic (`$((...))`, `((...))`) is skipped whole. A heredoc's body
is read from the lines after the one that opens it and becomes the text of its `<<` redirect's target, with the
substitutions in it when its delimiter is unquoted, since the shell runs those. It raises
ValueError on a command it cannot split, such as one with an unterminated quote. `runnable` finds the program a simple
command runs, past leading assignments, reserved words and wrappers (`sudo`, `env`, `timeout`, `nice` and the like,
with the values their options take).
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass, field

# The tools whose `command` is a shell command.
SHELL_TOOLS = {"Bash", "Monitor"}

# Wrappers that run the command after them, each with its options that take a separate value.
WRAPPERS = {
    "sudo": {"-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-T", "-U", "--user", "--group", "--host", "--prompt",
             "--chdir", "--role", "--type", "--command-timeout", "--other-user", "--close-from"},
    "doas": {"-u", "-C"},
    "env": {"-u", "-C", "-S", "--unset", "--chdir", "--split-string"},
    "command": set(),
    "exec": {"-a"},
    "nohup": set(),
    "nice": {"-n", "--adjustment"},
    "time": {"-f", "-o", "--format", "--output"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"},
    "xargs": {"-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s", "--arg-file", "--delimiter", "--eof", "--replace",
              "--max-lines", "--max-args", "--max-procs", "--max-chars"},
    "pkexec": {"--user"},
    "arch": {"-arch", "-d", "-e"},
    "watch": {"-n", "-q", "--interval", "--equexit"},
    "ionice": {"-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid", "--pgid", "--uid"},
}  # fmt: skip
# Operands a wrapper takes before the command it runs: the duration of `timeout`.
WRAPPER_OPERANDS = {"timeout": 1}
# `command -v` and `command -V` describe a program rather than run it.
DESCRIBE_OPTIONS = {"-v", "-V"}
RESERVED_WORDS = {"!", "{", "}", "if", "then", "else", "elif", "fi", "do", "done", "while", "until"}
ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=")

# Longest first, so `&&` is not read as two `&`.
OPERATORS = (
    "&&", "||", "|&", ";;", "&>>", "&>", "<<<", "<<-", "<<", ">>", ">&", "<&", ">|", "<>",
    "|", "&", ";", "\n", "<", ">",
)  # fmt: skip
CONTROL_OPERATORS = {"&&", "||", "|&", ";;", "|", "&", ";", "\n"}
HEREDOC_OPERATORS = {"<<", "<<-"}
PIPES = {"|", "|&"}
METACHARACTERS = set(" \t\n;&|<>()")
DOUBLE_QUOTE_ESCAPES = set('"\\$`\n')
FD_PREFIX = re.compile(r"\d+(?=[<>])")
RAW_WORD_SEPARATORS = re.compile(r"[\s'\"`;|&<>()]+")
# A heredoc delimiter with any of these in it is quoted, and its body is not expanded.
DELIMITER_QUOTES = set("'\"\\")


@dataclass
class Word:
    """A shell word with its quotes removed, and the scripts substituted into it."""

    text: str
    substitutions: list[list[Command]] = field(default_factory=list)


@dataclass
class Command:
    """A simple command; `piped` when its stdin is the previous command's stdout."""

    words: list[Word] = field(default_factory=list)
    redirects: list[tuple[str, Word]] = field(default_factory=list)
    piped: bool = False


class ShellParser:
    """Splits a command into simple commands as the shell would, far enough to find every program it runs."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.position = 0
        # Heredocs opened on the current line, as (delimiter, strips leading tabs, expands, target); bodies follow the
        # newline.
        self.heredocs: list[tuple[str, bool, bool, Word]] = []

    def at(self, prefix: str) -> bool:
        return self.text.startswith(prefix, self.position)

    def script(self, closer: str | None) -> list[Command]:
        """The commands up to `closer`, which is consumed, or to the end; ValueError when `closer` never comes."""
        commands: list[Command] = []
        current = Command()
        while True:
            self.skip_blanks()
            if self.position >= len(self.text):
                if closer:
                    raise ValueError(f"no closing {closer}")
                break
            char = self.text[self.position]
            if char == closer:
                self.position += 1
                break
            if char == "#":
                self.skip_comment()
                continue
            if self.at("(("):
                current.words.append(Word(self.arithmetic()))
                continue
            if char in "()":
                # A `)` with no `(` ends a `case` pattern.
                self.position += 1
                current = finish(commands, current, piped=False)
                if char == "(":
                    commands.extend(self.script(")"))
                continue
            descriptor = FD_PREFIX.match(self.text, self.position)
            if descriptor:
                # `2>` redirects a file descriptor; the digits are not an argument.
                self.position = descriptor.end()
                continue
            operator = self.operator()
            if operator in CONTROL_OPERATORS:
                current = finish(commands, current, piped=operator in PIPES)
                if operator == "\n":
                    self.heredoc_bodies()
            elif operator in HEREDOC_OPERATORS:
                self.skip_blanks()
                start = self.position
                delimiter = self.word(closer).text
                expands = not DELIMITER_QUOTES.intersection(self.text[start : self.position])
                body = Word("")
                self.heredocs.append((delimiter, operator == "<<-", expands, body))
                current.redirects.append((operator, body))
            elif operator:
                self.skip_blanks()
                current.redirects.append((operator, self.word(closer)))
            else:
                current.words.append(self.word(closer))
        finish(commands, current, piped=False)
        return commands

    def skip_blanks(self) -> None:
        while True:
            if self.at("\\\n"):
                self.position += 2
            elif self.at(" ") or self.at("\t"):
                self.position += 1
            else:
                return

    def skip_comment(self) -> None:
        end = self.text.find("\n", self.position)
        self.position = len(self.text) if end < 0 else end

    def heredoc_bodies(self) -> None:
        """Reads the bodies of the heredocs opened on the line just ended, each up to its delimiter line or the end."""
        for delimiter, strips_tabs, expands, body in self.heredocs:
            lines = []
            while self.position < len(self.text):
                end = self.text.find("\n", self.position)
                if end < 0:
                    end = len(self.text)
                line = self.text[self.position : end]
                self.position = min(end + 1, len(self.text))
                if strips_tabs:
                    line = line.lstrip("\t")
                if line == delimiter:
                    break
                lines.append(line)
            body.text = "\n".join(lines)
            if expands:
                ShellParser(body.text).expanded(body.substitutions, closer=None)
        self.heredocs.clear()

    def arithmetic(self) -> str:
        """Skips `$((...))` or `((...))` whole, since a `<<` inside is a shift, not a heredoc."""
        start = self.position
        self.position += 3 if self.at("$") else 2
        depth = 2
        while depth:
            if self.position >= len(self.text):
                raise ValueError("unterminated arithmetic")
            char = self.text[self.position]
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            self.position += 1
        return self.text[start : self.position]

    def operator(self) -> str | None:
        if self.at("<(") or self.at(">("):
            return None
        for operator in OPERATORS:
            if self.at(operator):
                self.position += len(operator)
                return operator
        return None

    def word(self, closer: str | None) -> Word:
        start = self.position
        if self.at("<(") or self.at(">("):
            self.position += 2
            substituted = self.script(")")
            return Word(self.text[start : self.position], [substituted])
        text: list[str] = []
        substitutions: list[list[Command]] = []
        while self.position < len(self.text):
            char = self.text[self.position]
            if char in METACHARACTERS or char == closer:
                break
            if char == "'":
                text.append(self.single_quoted())
            elif char == '"':
                text.append(self.double_quoted(substitutions))
            elif char == "\\":
                text.append(self.text[self.position + 1 : self.position + 2].strip("\n"))
                self.position += 2
            elif self.at("$(("):
                text.append(self.arithmetic())
            elif self.at("$(") or char == "`":
                begin = self.position
                substitutions.append(self.substitution())
                text.append(self.text[begin : self.position])
            else:
                text.append(char)
                self.position += 1
        return Word("".join(text), substitutions)

    def single_quoted(self) -> str:
        end = self.text.find("'", self.position + 1)
        if end < 0:
            raise ValueError("unterminated single quote")
        quoted = self.text[self.position + 1 : end]
        self.position = end + 1
        return quoted

    def double_quoted(self, substitutions: list[list[Command]]) -> str:
        self.position += 1
        return self.expanded(substitutions, closer='"')

    def expanded(self, substitutions: list[list[Command]], closer: str | None) -> str:
        """Text in which only substitutions and arithmetic expand, up to `closer`, which is consumed, or to the end.

        A substitution inside it still runs, so it is added to `substitutions`."""
        text: list[str] = []
        while True:
            if self.position >= len(self.text):
                if closer:
                    raise ValueError(f"no closing {closer}")
                return "".join(text)
            char = self.text[self.position]
            following = self.text[self.position + 1 : self.position + 2]
            if char == closer:
                self.position += 1
                return "".join(text)
            if char == "\\" and following in DOUBLE_QUOTE_ESCAPES:
                text.append(following.strip("\n"))
                self.position += 2
            elif self.at("$(("):
                text.append(self.arithmetic())
            elif self.at("$(") or char == "`":
                begin = self.position
                substitutions.append(self.substitution())
                text.append(self.text[begin : self.position])
            else:
                text.append(char)
                self.position += 1

    def substitution(self) -> list[Command]:
        if self.at("`"):
            self.position += 1
            return self.script("`")
        self.position += 2
        return self.script(")")


def finish(commands: list[Command], current: Command, piped: bool) -> Command:
    """Adds `current` to `commands` unless it is empty, and starts the next command."""
    if current.words or current.redirects:
        commands.append(current)
    return Command(piped=piped)


def parse(command: str) -> list[Command]:
    return ShellParser(command).script(None)


def raw_words(command: str) -> list[str]:
    """The words of a command `parse` cannot split, cut at every shell metacharacter and quote."""
    return [word for word in RAW_WORD_SEPARATORS.split(command) if word]


def substituted_scripts(command: Command) -> Iterator[list[Command]]:
    """The scripts substituted into the command's words and redirect targets, one level deep."""
    for word in [*command.words, *(target for _, target in command.redirects)]:
        yield from word.substitutions


def nested_scripts(script: list[Command]) -> Iterator[list[Command]]:
    """`script` and every script substituted into its words or redirect targets, at any depth."""
    yield script
    for command in script:
        for substitution in substituted_scripts(command):
            yield from nested_scripts(substitution)


def command_name(word: str) -> str:
    """The program a word runs, without its directory; `.` stays `.`, which `Path.name` would empty."""
    return word.rsplit("/", 1)[-1]


def texts(words: list[Word]) -> list[str]:
    return [word.text for word in words]


def takes_value(option: str, value_options: set[str]) -> bool:
    """Whether the word after `option` is its value: a listed option, or a cluster of short ones (`-iu`) ending in one.

    A value option earlier in a cluster takes the rest of the cluster as its value, as `-uroot` does."""
    if option in value_options:
        return True
    if option.startswith("--"):
        return False
    letters = option[1:]
    for index, letter in enumerate(letters):
        if f"-{letter}" in value_options:
            return index == len(letters) - 1
    return False


def prefix_length(words: list[str]) -> int:
    """How many leading words are assignments, reserved words, and wrappers with their options and operands.

    Returns `len(words)` when the command only describes a program (`command -v`)."""
    index = 0
    while index < len(words):
        word = words[index]
        name = command_name(word)
        if ASSIGNMENT.match(word) or word in RESERVED_WORDS:
            index += 1
            continue
        if name not in WRAPPERS:
            return index
        index += 1
        options = []
        while index < len(words) and words[index].startswith("-"):
            option = words[index]
            index += 1
            if option == "--":
                break
            options.append(option)
            if takes_value(option, WRAPPERS[name]):
                index += 1
        if name == "command" and DESCRIBE_OPTIONS.intersection(options):
            return len(words)
        index += WRAPPER_OPERANDS.get(name, 0)
    return index


def runnable(command: Command) -> list[Word]:
    """The command's words from the program it runs; empty when it runs none."""
    return command.words[prefix_length(texts(command.words)) :]
