"""Run a batch of breaks against a test suite, each in its own copy of the working tree, and report the surprises.

Run it from inside the repository under review. Each line of the break file is one JSON object:

    {"id": "E1", "file": "src/calc.py", "old": "a + b", "new": "a - b", "expect": ["test_calc.py::test_add"]}

`file` is a path from the repository root, as `git ls-files` prints it. `old` must occur exactly once in that file as
it stands in the working tree; `expect` names the tests the break should turn red. The run command and the patterns
that read a passing and a failing test line come from the fenced `toml` block under "## Batch runs" in the profile,
so the script runs no command the profile does not name. The test paths given last replace the run command's
"{tests}" item, and the command runs from the root of each copy.

Every break runs in a fresh copy of the tracked and untracked, not ignored, files, plus the ignored paths the profile
links. One more copy runs with no break, so a test that already fails is reported once and never read as caught. The
checkout itself is never written.

Writes <out>/results.tsv (each test under the baseline and each break) and <out>/<id>.log per run. Stdout holds the
baseline counts and failures, then only the breaks whose result differs from their prediction or whose run errored.
Exit status: 0 when every break ran as predicted, 1 otherwise, 2 when the input is refused before anything runs.
"""

import argparse
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import tomllib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import StrEnum
from functools import partial
from pathlib import Path

BREAK_KEYS = frozenset({"id", "file", "old", "new", "expect"})
PROFILE_KEYS = frozenset({"link", "kinds"})
KIND_KEYS = frozenset({"run", "pass", "fail"})
# Ids become log file names.
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
BASELINE = "baseline"
TESTS_PLACEHOLDER = "{tests}"
DEFAULT_PROFILE = Path(".claude/test-review-profile.md")
DEFAULT_TIMEOUT_SECONDS = 600.0
NOT_RUN = "-"
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
SECTION = re.compile(r"^## Batch runs[ \t]*\n(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL)
TOML_FENCE = re.compile(r"^```toml[ \t]*\n(.*?)^```", re.MULTILINE | re.DOTALL)


class Refused(Exception):
    """The input cannot be run; nothing has run yet."""


class Verdict(StrEnum):
    PASSED = "pass"
    FAILED = "fail"


@dataclass(frozen=True)
class Kind:
    run: tuple[str, ...]
    passing: re.Pattern[str]
    failing: re.Pattern[str]


@dataclass(frozen=True)
class Break:
    id: str
    file: str
    old: str
    new: str
    expect: frozenset[str]


@dataclass(frozen=True)
class Batch:
    """What every run of one invocation shares."""

    root: Path
    files: frozenset[str]
    links: tuple[str, ...]
    kind: Kind
    targets: tuple[str, ...]
    out: Path
    timeout: float


@dataclass(frozen=True)
class Run:
    results: dict[str, Verdict] = field(default_factory=dict)
    error: str | None = None


def git(*args: str, cwd: Path | None = None) -> bytes:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True)
    if result.returncode != 0:
        message = result.stderr.decode(errors="replace").strip()
        raise Refused(f"git {args[0]} failed: {message}")
    return result.stdout


def load_profile(path: Path, kind_name: str) -> tuple[Kind, list[str]]:
    section = SECTION.search(path.read_text())
    block = TOML_FENCE.search(section.group(1)) if section else None
    if not block:
        raise Refused(f"{path} has no fenced toml block under '## Batch runs'")
    config = tomllib.loads(block.group(1))
    unknown = config.keys() - PROFILE_KEYS
    if unknown:
        raise Refused(f"{path}: the Batch runs block has unknown keys: {', '.join(sorted(unknown))}")
    kinds = config.get("kinds", {})
    if kind_name not in kinds:
        raise Refused(f"{path} names no batch run for kind {kind_name!r}; it has: {', '.join(kinds) or 'none'}")
    links = config.get("link", [])
    if not isinstance(links, list) or not all(isinstance(pattern, str) for pattern in links):
        raise Refused(f"{path}: link must be a list of glob strings")
    return parse_kind(kind_name, kinds[kind_name]), links


def parse_kind(name: str, entry: dict) -> Kind:
    where = f"kind {name!r}"
    if set(entry) != KIND_KEYS:
        wanted = ", ".join(sorted(KIND_KEYS))
        raise Refused(f"{where} needs exactly the keys {wanted}; it has {', '.join(sorted(entry)) or 'none'}")
    run = entry["run"]
    if not isinstance(run, list) or TESTS_PLACEHOLDER not in run:
        raise Refused(f"{where}: run must be a list holding the item {TESTS_PLACEHOLDER!r}")
    if not all(isinstance(item, str) for item in run):
        raise Refused(f"{where}: every item of run must be a string")
    passing = name_pattern(where, entry, "pass")
    failing = name_pattern(where, entry, "fail")
    return Kind(tuple(run), passing, failing)


def name_pattern(where: str, entry: dict, key: str) -> re.Pattern[str]:
    if not isinstance(entry[key], str):
        raise Refused(f"{where}: {key} must be a string")
    try:
        pattern = re.compile(entry[key])
    except re.error as error:
        raise Refused(f"{where}: the {key} pattern does not compile: {error}") from error
    if "name" not in pattern.groupindex:
        raise Refused(f"{where}: the {key} pattern has no (?P<name>...) group")
    return pattern


def tree_files(root: Path) -> frozenset[str]:
    listing = git("ls-files", "-z", "--cached", "--others", "--exclude-standard", cwd=root)
    return frozenset(name for name in os.fsdecode(listing).split("\0") if name)


def expand_links(root: Path, patterns: list[str]) -> tuple[str, ...]:
    links: list[str] = []
    for pattern in patterns:
        if Path(pattern).is_absolute():
            raise Refused(f"link {pattern!r} must be relative to the repository root")
        for source in sorted(root.glob(pattern)):
            links.append(str(source.relative_to(root)))
    return tuple(links)


def load_breaks(path: Path, root: Path, files: frozenset[str]) -> list[Break]:
    breaks: list[Break] = []
    problems: list[str] = []
    seen: set[str] = set()
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        where = f"{path.name}:{number}"
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as error:
            problems.append(f"{where}: not JSON ({error.msg})")
            continue
        if not isinstance(entry, dict) or set(entry) != BREAK_KEYS:
            problems.append(f"{where}: needs exactly the keys {', '.join(sorted(BREAK_KEYS))}")
            continue
        problem = check_break(entry, root, files, seen)
        if problem:
            problems.append(f"{where} ({entry['id']}): {problem}")
            continue
        seen.add(entry["id"])
        breaks.append(Break(entry["id"], entry["file"], entry["old"], entry["new"], frozenset(entry["expect"])))
    if problems:
        raise Refused("\n".join(problems))
    return breaks


def check_break(entry: dict, root: Path, files: frozenset[str], seen: set[str]) -> str | None:
    if not isinstance(entry["id"], str) or not ID_PATTERN.fullmatch(entry["id"]):
        return f"id must match {ID_PATTERN.pattern}"
    if entry["id"] == BASELINE:
        return f"id {BASELINE!r} is taken by the unbroken run"
    if entry["id"] in seen:
        return "duplicate id"
    if not all(isinstance(entry[key], str) for key in ("file", "old", "new")):
        return "file, old and new must be strings"
    if not entry["old"]:
        return "old is empty"
    if entry["old"] == entry["new"]:
        return "old and new are the same, so nothing breaks"
    if not isinstance(entry["expect"], list) or not all(isinstance(name, str) for name in entry["expect"]):
        return "expect must be a list of test names"
    # A file outside this list is missing from the copies or linked into them, and a break written through a link
    # lands in the checkout.
    if entry["file"] not in files:
        return f"{entry['file']} is not a tracked or untracked, not ignored, file, named from the repository root"
    source = root / entry["file"]
    if source.is_symlink():
        return f"{entry['file']} is a symlink; name the file it points to"
    if not source.is_file():
        return f"{entry['file']} is not a regular file in the working tree"
    old = entry["old"].encode()
    count = source.read_bytes().count(old)
    if count != 1:
        return f"old occurs {count} times in {entry['file']}; it must occur exactly once"
    return None


def make_copy(batch: Batch, dest: Path) -> None:
    for name in batch.files:
        source = batch.root / name
        if not source.exists(follow_symlinks=False):
            continue  # deleted in the working tree but still tracked
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink():
            target.symlink_to(source.readlink())
        else:
            shutil.copy2(source, target)
    for name in batch.links:
        target = dest / name
        if target.exists(follow_symlinks=False):
            continue  # a copied file is never swapped for a link, which a break would write through
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(batch.root / name)


def apply_break(tree: Path, item: Break) -> None:
    """Edits bytes, so the file's encoding and line endings reach the copy unchanged."""
    target = tree / item.file
    old = item.old.encode()
    new = item.new.encode()
    broken = target.read_bytes().replace(old, new, 1)
    target.write_bytes(broken)


def run_in_copy(batch: Batch, item: Break | None) -> Run:
    log = log_path(batch, item.id if item else BASELINE)
    with tempfile.TemporaryDirectory(prefix="run-breaks-") as scratch:
        tree = Path(scratch) / batch.root.name
        try:
            make_copy(batch, tree)
            if item:
                apply_break(tree, item)
        except OSError as error:
            return failed_run(log, f"could not build the copy: {error}")
        return run_suite(batch, tree, log)


def run_suite(batch: Batch, tree: Path, log: Path) -> Run:
    argv: list[str] = []
    for item in batch.kind.run:
        if item == TESTS_PLACEHOLDER:
            argv.extend(batch.targets)
        else:
            argv.append(item)
    try:
        process = subprocess.Popen(
            argv, cwd=tree, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True
        )
    except OSError as error:
        return failed_run(log, f"could not start {argv[0]}: {error.strerror}")
    try:
        output, _ = process.communicate(timeout=batch.timeout)
    except subprocess.TimeoutExpired:
        # The whole group, since a child of the runner still holding the output pipe would keep communicate waiting.
        os.killpg(process.pid, signal.SIGKILL)
        output, _ = process.communicate()
        log.write_bytes(output)
        return Run(error=f"timed out after {batch.timeout:g}s")
    log.write_bytes(output)
    results = read_results(batch.kind, output)
    if not results:
        return Run(error=f"no test lines matched (exit {process.returncode})")
    return Run(results)


def read_results(kind: Kind, output: bytes) -> dict[str, Verdict]:
    results: dict[str, Verdict] = {}
    for line in output.decode(errors="replace").splitlines():
        line = ANSI_ESCAPE.sub("", line).rstrip()
        for verdict, pattern in ((Verdict.PASSED, kind.passing), (Verdict.FAILED, kind.failing)):
            match = pattern.search(line)
            if match:
                name = match.group("name").strip()
                record(results, name, verdict)
                break
    return results


def record(results: dict[str, Verdict], name: str, verdict: Verdict) -> None:
    """Keep same-named tests apart, as two bats files can hold one name."""
    key = name
    copy_number = 2
    while key in results:
        key = f"{name} ({copy_number})"
        copy_number += 1
    results[key] = verdict


def log_path(batch: Batch, run_id: str) -> Path:
    return batch.out / f"{run_id}.log"


def failed_run(log: Path, message: str) -> Run:
    """Writes the message as the run's log, so every run named on stdout has one."""
    log.write_text(message + "\n")
    return Run(error=message)


def tests_with(run: Run, verdict: Verdict) -> set[str]:
    return {name for name, result in run.results.items() if result == verdict}


def surprises(item: Break, run: Run, baseline: Run) -> list[str]:
    if run.error:
        return [f"error: {run.error}"]
    baseline_red = tests_with(baseline, Verdict.FAILED)
    red = tests_with(run, Verdict.FAILED) - baseline_red
    stayed_green = tests_with(run, Verdict.PASSED) & tests_with(baseline, Verdict.PASSED)
    findings = {
        "expected red but green": item.expect & stayed_green,
        "red but not expected": red - item.expect,
        "missing from the run": baseline.results.keys() - run.results.keys(),
        "expected but already red in the baseline": item.expect & baseline_red,
        "expected but not in the baseline": item.expect - baseline.results.keys(),
    }
    return [f"{label}: {', '.join(sorted(names))}" for label, names in findings.items() if names]


def write_table(path: Path, baseline: Run, breaks: list[Break], runs: list[Run]) -> None:
    names = set(baseline.results)
    for run in runs:
        names |= run.results.keys()
    lines = ["\t".join(["test", BASELINE, *(item.id for item in breaks)])]
    for name in sorted(names):
        cells = [baseline.results.get(name, NOT_RUN), *(run.results.get(name, NOT_RUN) for run in runs)]
        lines.append("\t".join([name, *cells]))
    path.write_text("\n".join(lines) + "\n")


def prepare(args: argparse.Namespace) -> tuple[Batch, list[Break]]:
    top = git("rev-parse", "--show-toplevel").decode().strip()
    root = Path(top).resolve()
    out = args.out.resolve()
    if out.is_relative_to(root):
        raise Refused(f"--out {args.out} is inside the repository, where the next copy would pick it up")
    kind, link_patterns = load_profile(args.profile or root / DEFAULT_PROFILE, args.kind)
    files = tree_files(root)
    breaks = load_breaks(args.breaks, root, files)
    links = expand_links(root, link_patterns)
    out.mkdir(parents=True, exist_ok=True)
    return Batch(root, files, links, kind, tuple(args.targets), out, args.timeout), breaks


def parse_args() -> argparse.Namespace:
    half_the_cpus = math.floor((os.cpu_count() or 1) / 2)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", type=Path, help=f"the profile (default: {DEFAULT_PROFILE} in the root)")
    parser.add_argument("--kind", required=True, help="a kind from the profile's Batch runs block")
    parser.add_argument("--breaks", type=Path, required=True, help="the JSON Lines break file")
    parser.add_argument("--out", type=Path, required=True, help="a directory outside the repository for the results")
    parser.add_argument("--jobs", type=int, default=max(1, half_the_cpus), help="runs at once (default: half the CPUs)")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS, help="seconds per run")
    parser.add_argument("targets", nargs="+", help="test paths from the repository root, for the {tests} item")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("--jobs must be at least 1")
    if args.timeout <= 0:
        parser.error("--timeout must be above 0")
    return args


def print_breaks(breaks: list[Break], runs: list[Run], baseline: Run) -> int:
    """Prints each break that did not run as predicted, and returns how many did."""
    as_predicted = 0
    for item, run in zip(breaks, runs, strict=True):
        found = surprises(item, run, baseline)
        if not found:
            as_predicted += 1
            continue
        print(f"{item.id}:")
        for line in found:
            print(f"  {line}")
    return as_predicted


def main() -> None:
    args = parse_args()
    try:
        batch, breaks = prepare(args)
    except (Refused, OSError, tomllib.TOMLDecodeError) as error:
        print(f"refused: {error}", file=sys.stderr)
        sys.exit(2)

    baseline = run_in_copy(batch, None)
    if baseline.error:
        print(f"baseline: {baseline.error}; see {log_path(batch, BASELINE)}. No break was run.")
        sys.exit(1)
    failed = sorted(tests_with(baseline, Verdict.FAILED))
    print(f"baseline: {len(baseline.results) - len(failed)} passed, {len(failed)} failed")
    for name in failed:
        print(f"  already red: {name}")

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        runs = list(pool.map(partial(run_in_copy, batch), breaks))
    table = batch.out / "results.tsv"
    write_table(table, baseline, breaks, runs)

    as_predicted = print_breaks(breaks, runs, baseline)
    print(f"{as_predicted} of {len(breaks)} breaks ran as predicted. Table: {table}; logs: {batch.out}")
    sys.exit(0 if as_predicted == len(breaks) else 1)


if __name__ == "__main__":
    main()
