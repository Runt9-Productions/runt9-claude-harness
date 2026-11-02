#!/usr/bin/env python3
"""Index a lens-review run directory's patch.diff without anyone reading it, and place findings against that index.

    diff_index.py index <run directory>
    diff_index.py place <run directory>

index writes manifest.tsv (per file: lines added, lines removed, the file's line span inside patch.diff, and the
path) and hunks.txt (per file: the new-side line spans its hunks cover, comma separated, or `-` for none, then the
path), both in patch order, and prints the patch's line count. It writes nothing and exits 1 with the reason on
stderr when the patch cannot be indexed exactly, as for a combined diff of a merge commit or a path holding a tab or
newline.

place reads locations.tsv, one finding per line: a new-side line number, a tab, then a path as hunks.txt gives it.
It prints each line back prefixed with `inline` and a tab when the line falls inside a span hunks.txt lists for that
path, and with `body` and a tab otherwise. It exits 1 on a line not in that shape.

Needs Python 3.12 and git.
"""

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

HUNK_HEADER = re.compile(r"@@+ ")
NEW_SIDE_RANGE = re.compile(r"\+([0-9]+)(?:,([0-9]+))?")
LINE_NUMBER = re.compile(r"[0-9]+")


class RefusalError(Exception):
    """The run directory cannot be indexed or placed exactly; the message says why."""


@dataclass
class Section:
    """One `diff --git` section: its first and last line in patch.diff, and the new-side spans of its hunks."""

    start: int
    end: int = 0
    spans: list[str] = field(default_factory=list)


# Paths in a patch are bytes, not always UTF-8. surrogateescape carries every byte through to the output unchanged.
def read_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8", "surrogateescape")


def write_lines(path: Path, lines: list[str]) -> None:
    text = "".join(f"{line}\n" for line in lines)
    path.write_bytes(text.encode("utf-8", "surrogateescape"))


def split_terminated(text: str, terminator: str) -> list[str]:
    """Split text into the records each terminator ends, keeping a last record that lacks one."""
    records = text.split(terminator)
    if records[-1] == "":
        records.pop()
    return records


def numstat_records(run_dir: Path) -> list[str]:
    # git apply reads a patch without applying it and prints each file's raw path, NUL-terminated, so quoting and the
    # tab git adds after a path with a space never reach the parsing below. Its records come in patch order. Inside a
    # work tree it drops every path outside the current directory, so the ceiling keeps it from finding one above the
    # run directory. --whitespace=nowarn keeps an apply.whitespace=error setting from refusing a patch that adds
    # trailing whitespace.
    environment = {**os.environ, "GIT_CEILING_DIRECTORIES": str(run_dir.resolve().parent)}
    with (run_dir / "patch.diff").open("rb") as patch:
        numstat = subprocess.run(
            ["git", "apply", "--numstat", "-z", "--whitespace=nowarn"],
            cwd=run_dir,
            env=environment,
            stdin=patch,
            stdout=subprocess.PIPE,
            check=False,
        )
    if numstat.returncode != 0:
        raise RefusalError("git apply could not read patch.diff")
    return split_terminated(numstat.stdout.decode("utf-8", "surrogateescape"), "\0")


def patch_sections(lines: list[str]) -> list[Section]:
    sections: list[Section] = []
    for number, line in enumerate(lines, start=1):
        if line.startswith("diff --git "):
            if sections:
                sections[-1].end = number - 1
            sections.append(Section(start=number))
            continue
        if not sections or not HUNK_HEADER.match(line):
            continue
        new_range = NEW_SIDE_RANGE.search(line)
        if new_range is None:
            continue
        first = int(new_range[1])
        count = 1 if new_range[2] is None else int(new_range[2])
        if count > 0:
            sections[-1].spans.append(f"{first}-{first + count - 1}")
    if sections:
        sections[-1].end = len(lines)
    return sections


def index(run_dir: Path) -> None:
    records = numstat_records(run_dir)
    patch = read_text(run_dir / "patch.diff")
    sections = patch_sections(split_terminated(patch, "\n"))
    if len(records) != len(sections):
        raise RefusalError(f"git apply found {len(records)} files but the patch has {len(sections)} sections")
    manifest = []
    hunks = []
    for record, section in zip(records, sections, strict=True):
        added, removed, path = record.split("\t", 2)
        # Both files hold one tab-separated record per line, so such a path could forge a record of its own.
        if "\t" in path or "\n" in path:
            raise RefusalError(f"a path holds a tab or newline, which the index cannot carry: {path!r}")
        manifest.append(f"{added}\t{removed}\t{section.start}-{section.end}\t{path}")
        spans = ",".join(section.spans) or "-"
        hunks.append(f"{spans}\t{path}")
    write_lines(run_dir / "manifest.tsv", manifest)
    write_lines(run_dir / "hunks.txt", hunks)
    print(patch.count("\n"))


def hunk_spans(run_dir: Path) -> dict[str, list[tuple[int, int]]]:
    spans_by_path = {}
    for line in split_terminated(read_text(run_dir / "hunks.txt"), "\n"):
        spans, path = line.split("\t", 1)
        if spans == "-":
            continue
        bounds = [span.split("-") for span in spans.split(",")]
        spans_by_path[path] = [(int(first), int(last)) for first, last in bounds]
    return spans_by_path


def place(run_dir: Path) -> None:
    spans_by_path = hunk_spans(run_dir)
    for location in split_terminated(read_text(run_dir / "locations.tsv"), "\n"):
        number, tab, path = location.partition("\t")
        if not tab or not LINE_NUMBER.fullmatch(number):
            raise RefusalError(f"a locations.tsv line is not a line number, a tab and a path: {location!r}")
        line = int(number)
        # A path outside the diff, or with no new-side lines, has no spans: its findings go in the body.
        spans = spans_by_path.get(path, [])
        inside = any(first <= line <= last for first, last in spans)
        placement = "inline" if inside else "body"
        print(f"{placement}\t{location}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in (index, place):
        subparser = commands.add_parser(command.__name__)
        subparser.add_argument("run_dir", type=Path, metavar="run directory")
        subparser.set_defaults(run=command)
    args = parser.parse_args()
    try:
        args.run(args.run_dir)
    except RefusalError as error:
        print(f"{args.command}: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
