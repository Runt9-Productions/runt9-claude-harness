"""run_breaks.py run as a subprocess against a synthetic pytest suite in a temporary git repository.

Needs pytest, git and sleep.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "run_breaks.py"
GIT_ISOLATION = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
CALC = "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n"
TESTS = (
    "from calc import add, sub\n\n\n"
    "def test_add():\n    assert add(2, 3) == 5\n\n\n"
    "def test_sub():\n    assert sub(5, 3) == 2\n"
)
ADD = "test_calc.py::test_add"
SUB = "test_calc.py::test_sub"
# Ends a test whose script hangs, well before the 60-second sleep the timeout test starts would let it finish.
SCRIPT_TIMEOUT_SECONDS = 30


def profile_text(links: tuple[str, ...] = (), pytest_options: tuple[str, ...] = ()) -> str:
    run = json.dumps([sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-v", *pytest_options, "{tests}"])
    return (
        "# Test review profile\n\n## Batch runs\n\n```toml\n"
        f"link = {json.dumps(list(links))}\n\n"
        f"[kinds.pytest]\nrun = {run}\n"
        "pass = '^(?P<name>\\S+::\\S+) PASSED'\n"
        "fail = '^(?P<name>\\S+::\\S+) FAILED'\n"
        "```\n\n## Suite policy\n"
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "example-repo"
    root.mkdir()
    (root / "calc.py").write_text(CALC)
    (root / "test_calc.py").write_text(TESTS)
    (root / "profile.md").write_text(profile_text())
    env = {**os.environ, **GIT_ISOLATION}
    subprocess.run(["git", "init", "-q"], cwd=root, check=True, env=env)
    subprocess.run(["git", "add", "."], cwd=root, check=True, env=env)
    commit = ["git", "-c", "user.name=Example", "-c", "user.email=dev@example.com", "commit", "-qm", "suite"]
    subprocess.run(commit, cwd=root, check=True, env=env)
    return root


def run_breaks(
    repo: Path, breaks: list[dict], targets: tuple[str, ...] = ("test_calc.py",), options: tuple[str, ...] = ()
) -> subprocess.CompletedProcess[str]:
    breaks_file = repo.parent / "breaks.jsonl"
    breaks_file.write_text("".join(json.dumps(entry) + "\n" for entry in breaks))
    argv = [sys.executable, str(SCRIPT), "--profile", "profile.md", "--kind", "pytest", *options]
    argv += ["--breaks", str(breaks_file), "--out", str(repo.parent / "out"), *targets]
    env = {**os.environ, **GIT_ISOLATION}
    return subprocess.run(argv, cwd=repo, capture_output=True, text=True, env=env, timeout=SCRIPT_TIMEOUT_SECONDS)


def git_status(repo: Path) -> str:
    return subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout


def test_predicted_breaks_print_no_detail_and_leave_the_checkout_alone(repo: Path):
    result = run_breaks(
        repo,
        [
            {"id": "E1", "file": "calc.py", "old": "a + b", "new": "a - b", "expect": [ADD]},
            {"id": "E2", "file": "calc.py", "old": "a - b", "new": "a + b", "expect": [SUB]},
        ],
    )

    assert result.returncode == 0, result.stderr
    assert "baseline: 2 passed, 0 failed" in result.stdout
    assert "E1:" not in result.stdout
    assert "2 of 2 breaks ran as predicted" in result.stdout
    table = (repo.parent / "out" / "results.tsv").read_text().splitlines()
    assert table == ["test\tbaseline\tE1\tE2", f"{ADD}\tpass\tfail\tpass", f"{SUB}\tpass\tpass\tfail"]
    assert (repo / "calc.py").read_text() == CALC
    assert git_status(repo) == ""


def test_a_misprediction_names_the_break_and_both_directions(repo: Path):
    result = run_breaks(repo, [{"id": "E1", "file": "calc.py", "old": "a + b", "new": "a - b", "expect": [SUB]}])

    assert result.returncode == 1
    assert f"E1:\n  expected red but green: {SUB}\n  red but not expected: {ADD}\n" in result.stdout


def test_an_already_failing_untracked_test_is_reported_once_and_never_read_as_caught(repo: Path):
    (repo / "test_extra.py").write_text("def test_broken():\n    assert False\n")

    breaks = [{"id": "E1", "file": "calc.py", "old": "a + b", "new": "a - b", "expect": [ADD]}]
    result = run_breaks(repo, breaks, ("test_calc.py", "test_extra.py"))

    assert result.returncode == 0, result.stdout
    assert "baseline: 2 passed, 1 failed\n  already red: test_extra.py::test_broken\n" in result.stdout


def test_an_old_string_that_does_not_occur_once_is_refused_before_anything_runs(repo: Path):
    result = run_breaks(
        repo,
        [
            {"id": "E1", "file": "calc.py", "old": "a * b", "new": "a", "expect": []},
            {"id": "E2", "file": "calc.py", "old": "return", "new": "yield", "expect": []},
        ],
    )

    assert result.returncode == 2
    assert "(E1): old occurs 0 times in calc.py" in result.stderr
    assert "(E2): old occurs 2 times in calc.py" in result.stderr
    assert not (repo.parent / "out").exists()


def test_a_break_to_a_file_the_copies_link_rather_than_hold_is_refused(repo: Path):
    rates = "RATE = 2\n"
    (repo / ".gitignore").write_text("vendor/\n")
    (repo / "vendor").mkdir()
    (repo / "vendor" / "rates.py").write_text(rates)
    (repo / "profile.md").write_text(profile_text(links=("vendor",)))

    result = run_breaks(repo, [{"id": "E1", "file": "vendor/rates.py", "old": "2", "new": "3", "expect": []}])

    assert result.returncode == 2, result.stdout
    assert "(E1): vendor/rates.py is not a tracked or untracked, not ignored, file" in result.stderr
    assert (repo / "vendor" / "rates.py").read_text() == rates


def test_a_run_past_the_timeout_is_reported_without_waiting_on_the_processes_it_started(repo: Path):
    # Without -s pytest hands a test's children a capture file, so only the runner itself would hold the output open.
    (repo / "profile.md").write_text(profile_text(pytest_options=("-s",)))
    hang = "return __import__('subprocess').run(['sleep', '60'])"
    breaks = [{"id": "E1", "file": "calc.py", "old": "return a + b", "new": hang, "expect": [ADD]}]

    result = run_breaks(repo, breaks, options=("--timeout", "3"))

    assert result.returncode == 1
    assert "E1:\n  error: timed out after 3s\n" in result.stdout
