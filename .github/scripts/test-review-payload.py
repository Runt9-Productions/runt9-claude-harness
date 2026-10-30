"""Turns a /test-review run in this checkout into a pull request review.

Writes two values to GITHUB_OUTPUT: `payload`, a review whose comments carry the test fixes as suggested changes, and
`fallback`, the report with every fix as one diff, for when GitHub rejects the payload. Fails when the run ended in an
error or wrote no report.

The fixes are the working tree's changes against HEAD to the test files and helpers, untracked ones included. The
reviewer breaks production code on purpose to prove a test fails, so a change it left to any other tracked file is
named in the body as a warning, never offered as a suggestion. GitHub takes a comment only on lines inside one hunk of
the pull request's diff, which is <base-commit>..HEAD, so a fix whose replaced lines are not all inside one hunk goes
into the body as a diff instead.
"""

import argparse
import json
import os
import re
import secrets
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# A review body holds at most 65,536 characters.
BODY_LIMIT = 60000
CUT_NOTE = "\n\n(The report was cut to fit.)"
# The test files and helpers of the "Test kinds" table in .claude/test-review-profile.md, as git glob pathspecs.
TEST_GLOBS = ("**/*.bats", "**/test_*.py", "plugins/**/*.test.ts", "plugins/**/*.test.tsx")
TEST_HELPERS = (".github/scripts/tests/helpers.bash",)
# Fixed prefixes, so the headers parse the same whatever diff.noprefix or diff.mnemonicPrefix say.
DIFF_OPTIONS = ("--no-color", "--no-renames", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/")
HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class Hunk:
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[str] = field(default_factory=list)

    @property
    def replaced(self) -> tuple[int, int]:
        """The first and last old-side line the hunk replaces; last < first when it only inserts.

        A fix's old side is HEAD, which is the pull request's new side, so these are RIGHT-side lines of its review.
        """
        return self.old_start, self.old_start + self.old_count - 1

    def new_text(self) -> str:
        kept = [line[1:] for line in self.lines if line[:1] in (" ", "+")]
        return "".join(f"{line}\n" for line in kept)


@dataclass
class FileDiff:
    header: list[str]
    # The path after the change, None for a deleted file or a path git quoted.
    new_path: str | None = None
    # The path on both sides, None for a file added or deleted, or a path git quoted: those have no lines a
    # suggestion can replace.
    path: str | None = None
    hunks: list[Hunk] = field(default_factory=list)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-c", "core.quotePath=false", *args], check=True, capture_output=True, text=True
    ).stdout


def test_pathspecs() -> list[str]:
    return [f":(glob){glob}" for glob in TEST_GLOBS] + list(TEST_HELPERS)


def parse_diff(text: str) -> list[FileDiff]:
    files: list[FileDiff] = []
    old_path = None
    # Only "\n" ends a diff line; splitlines() would also split one at a form feed or a Unicode line separator.
    lines = text.split("\n")
    if lines[-1] == "":
        lines.pop()
    for line in lines:
        if line.startswith("diff --git "):
            files.append(FileDiff(header=[line]))
            old_path = None
            continue
        current = files[-1]
        match = HUNK_HEADER.match(line)
        if match:
            old_start, old_count, new_start, new_count = match.groups()
            hunk = Hunk(int(old_start), int(old_count or 1), int(new_start), int(new_count or 1), [line])
            current.hunks.append(hunk)
        elif current.hunks:
            current.hunks[-1].lines.append(line)
        else:
            current.header.append(line)
            if line.startswith("--- a/"):
                old_path = line.removeprefix("--- a/")
            elif line.startswith("+++ b/"):
                current.new_path = line.removeprefix("+++ b/")
                if current.new_path == old_path:
                    current.path = old_path
    return files


def pr_spans(pr_diff: list[FileDiff]) -> dict[str, list[tuple[int, int]]]:
    """For each file the pull request changes, the new-side line spans of its hunks."""
    spans: dict[str, list[tuple[int, int]]] = {}
    for file_diff in pr_diff:
        if file_diff.new_path is None:
            continue
        for hunk in file_diff.hunks:
            if hunk.new_count > 0:
                spans.setdefault(file_diff.new_path, []).append((hunk.new_start, hunk.new_start + hunk.new_count - 1))
    return spans


def fence_for(text: str, info: str) -> str:
    """A code fence one backtick longer than any run of backticks in the text, and at least three."""
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}{info}\n{text}{fence}"


def suggestion(path: str, hunk: Hunk) -> dict[str, object]:
    first, last = hunk.replaced
    comment: dict[str, object] = {
        "path": path,
        "line": last,
        "side": "RIGHT",
        "body": fence_for(hunk.new_text(), "suggestion"),
    }
    if first < last:
        comment["start_line"] = first
        comment["start_side"] = "RIGHT"
    return comment


def split_fixes(fixes: list[FileDiff], spans: dict[str, list[tuple[int, int]]]) -> tuple[list[dict[str, object]], str]:
    """The suggestion comments, and a diff of every fix that does not fit inside one hunk of the PR's diff."""
    comments = []
    unplaced = []
    for file_diff in fixes:
        left_out = []
        for hunk in file_diff.hunks:
            first, last = hunk.replaced
            fits = any(start <= first <= last <= end for start, end in spans.get(file_diff.path or "", []))
            if file_diff.path is not None and fits:
                comments.append(suggestion(file_diff.path, hunk))
            else:
                left_out.append(hunk)
        if left_out or not file_diff.hunks:
            unplaced += file_diff.header
            for hunk in left_out:
                unplaced += hunk.lines
    return comments, "".join(f"{line}\n" for line in unplaced)


def fit(report: str, sections: str) -> str:
    """The report followed by the sections, with the report cut first.

    The sections are cut only when they alone pass the limit.
    """
    room = BODY_LIMIT - len(sections)
    if len(report) > room:
        report = report[: max(room - len(CUT_NOTE), 0)] + CUT_NOTE
    return (report + sections)[:BODY_LIMIT]


def write_output(name: str, value: str) -> None:
    delimiter = secrets.token_hex(16)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"{name}<<{delimiter}\n{value}\n{delimiter}\n")


def build(report: str, base: str) -> tuple[str, str]:
    """The payload as JSON and the fallback text."""
    not_tests = [f":(exclude,glob){glob}" for glob in TEST_GLOBS] + [f":(exclude){path}" for path in TEST_HELPERS]
    # Only tracked files count as stray: the sandbox leaves empty stand-ins for dotfiles it protects in the checkout.
    stray = git("diff", "--name-only", "HEAD", "--", ".", *not_tests).splitlines()
    untracked = git("ls-files", "-z", "--others", "--exclude-standard", "--", *test_pathspecs()).split("\0")
    untracked = [path for path in untracked if path]
    if untracked:
        git("add", "-N", "--", *untracked)
    fixes_text = git("diff", *DIFF_OPTIONS, "-U1", "HEAD", "--", *test_pathspecs())
    pr_text = git("diff", *DIFF_OPTIONS, base, "HEAD")
    # Stopped, so a line of the diff that starts with "::" is printed rather than run as a workflow command.
    token = secrets.token_hex(16)
    print(f"::group::The fixes\n::stop-commands::{token}\n{fixes_text}::{token}::\n::endgroup::")

    stray_section = ""
    if stray:
        print(f"::warning::Changes outside the test files, not suggested: {' '.join(stray)}")
        listed = "\n".join(f"- `{path}`" for path in stray)
        stray_section = (
            "\n\n## Changes left outside the tests\n\nThe review changed these files, which are not test files or "
            "helpers, so nothing here suggests them. Check that its deliberate breaks were all restored.\n\n" + listed
        )

    comments, unplaced = split_fixes(parse_diff(fixes_text), pr_spans(parse_diff(pr_text)))
    body_sections = stray_section
    if unplaced:
        body_sections += (
            "\n\n## Fixes outside the diff\n\nGitHub takes a suggestion only on lines this pull request changes, so "
            "these fixes are a diff to apply by hand.\n\n" + fence_for(unplaced, "diff")
        )
    fallback_sections = stray_section
    if fixes_text:
        fallback_sections += (
            "\n\n## Fixes\n\nThe suggested changes could not be posted, so every fix is in this diff.\n\n"
            + fence_for(fixes_text, "diff")
        )
    payload = json.dumps({"body": fit(report, body_sections), "comments": comments})
    return payload, fit(report, fallback_sections)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("claude_json", type=Path, help="the run's `claude -p --output-format json` output")
    parser.add_argument("base", help="the commit the pull request's diff starts from")
    args = parser.parse_args()

    run = json.loads(args.claude_json.read_text())
    report = run.get("result") or ""
    if not report or run.get("is_error"):
        print("::error::The test review wrote no report.")
        sys.exit(1)
    payload, fallback = build(report, args.base)
    write_output("payload", payload)
    write_output("fallback", fallback)


if __name__ == "__main__":
    main()
