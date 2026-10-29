"""Runs test-review-payload.py as the workflow does, in a scratch repository whose base commit holds a 20-line test
file, example.bats, and a production file, tool.sh, and whose HEAD, the pull request, changes line 3 of the test file.
Every git call runs without the machine's global and system config. Needs git and pytest.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "test-review-payload.py"
GIT_ISOLATION = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
IDENTITY = ("-c", "user.name=Example", "-c", "user.email=example@example.com")


class Checkout:
    def __init__(self, root: Path) -> None:
        self.repo = root / "repo"
        self.output = root / "output"
        self.review = root / "review.json"
        self.env = {**os.environ, **GIT_ISOLATION, "GITHUB_OUTPUT": str(self.output)}
        self.repo.mkdir()
        self.git("init", "-q")
        self.write("example.bats", "".join(f"line {n}\n" for n in range(1, 21)))
        self.write("tool.sh", "exit 0\n")
        self.git("add", "-A")
        self.git(*IDENTITY, "commit", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.replace_line("example.bats", 3, "line three")
        self.git(*IDENTITY, "commit", "-qam", "pr")
        self.review.write_text(json.dumps({"result": "the report"}))

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=self.repo, env=self.env, check=True, capture_output=True, text=True
        ).stdout

    def write(self, path: str, text: str) -> None:
        (self.repo / path).write_text(text)

    def replace_line(self, path: str, number: int, text: str) -> None:
        lines = (self.repo / path).read_text().splitlines()
        lines[number - 1] = text
        self.write(path, "".join(f"{line}\n" for line in lines))

    def run(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.review), self.base],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            text=True,
        )

    def output_value(self, name: str) -> str:
        lines = self.output.read_text().splitlines()
        start = next(i for i, line in enumerate(lines) if line.startswith(f"{name}<<"))
        delimiter = lines[start].removeprefix(f"{name}<<")
        end = lines.index(delimiter, start + 1)
        return "\n".join(lines[start + 1 : end])

    def payload(self) -> dict:
        return json.loads(self.output_value("payload"))


@pytest.fixture
def checkout(tmp_path: Path) -> Checkout:
    return Checkout(tmp_path)


def test_fix_inside_one_pr_hunk_is_a_suggestion_and_one_reaching_past_it_is_in_the_body(checkout: Checkout) -> None:
    # The PR's hunk spans lines 1 to 6. The first fix turns line 3 into two lines, so its hunk replaces lines 2 to 4;
    # the second, on line 7, has a hunk of lines 6 to 8, which starts inside the PR's hunk and ends past it.
    checkout.replace_line("example.bats", 3, "line 3, fixed\nline 3, continued")
    checkout.replace_line("example.bats", 8, "line 7, fixed")

    result = checkout.run()

    assert result.returncode == 0, result.stdout + result.stderr
    payload = checkout.payload()
    assert payload["comments"] == [
        {
            "path": "example.bats",
            "line": 4,
            "side": "RIGHT",
            "body": "```suggestion\nline 2\nline 3, fixed\nline 3, continued\nline 4\n```",
            "start_line": 2,
            "start_side": "RIGHT",
        }
    ]
    assert payload["body"].startswith("the report")
    assert "Changes left outside the tests" not in payload["body"]
    assert "+line 7, fixed" in payload["body"]
    assert "line 3, fixed" not in payload["body"]
    fallback = checkout.output_value("fallback")
    assert "+line 3, fixed" in fallback
    assert "+line 7, fixed" in fallback


def test_test_file_the_review_added_is_a_diff_in_the_body(checkout: Checkout) -> None:
    checkout.write("new.bats", "a new test\n")

    result = checkout.run()

    assert result.returncode == 0, result.stdout + result.stderr
    payload = checkout.payload()
    assert payload["comments"] == []
    assert "+a new test" in payload["body"]


def test_change_to_production_is_named_and_never_suggested_and_untracked_files_are_ignored(checkout: Checkout) -> None:
    checkout.write("tool.sh", "exit 1\n")
    checkout.write("notes.txt", "a copy set aside\n")

    result = checkout.run()

    assert result.returncode == 0, result.stdout + result.stderr
    payload = checkout.payload()
    assert payload["comments"] == []
    assert "## Changes left outside the tests" in payload["body"]
    assert "- `tool.sh`" in payload["body"]
    assert "notes.txt" not in payload["body"]
    assert "exit 1" not in payload["body"]
    assert "exit 1" not in checkout.output_value("fallback")


def test_long_report_is_cut_and_the_unplaced_fixes_survive(checkout: Checkout) -> None:
    checkout.review.write_text(json.dumps({"result": "x" * 70000}))
    checkout.replace_line("example.bats", 15, "line 15, fixed")

    result = checkout.run()

    assert result.returncode == 0, result.stdout + result.stderr
    body = checkout.payload()["body"]
    assert len(body) <= 60000
    assert "(The report was cut to fit.)" in body
    assert body.endswith("+line 15, fixed\n line 16\n```")


@pytest.mark.parametrize("run", [{"result": ""}, {"is_error": True, "result": "the report"}])
def test_run_with_no_report_or_an_error_fails(checkout: Checkout, run: dict) -> None:
    checkout.review.write_text(json.dumps(run))

    result = checkout.run()

    assert result.returncode == 1
    assert "no report" in result.stdout
    assert not checkout.output.exists()
