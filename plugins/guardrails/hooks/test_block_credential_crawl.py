"""block_credential_crawl.py run as a subprocess, with HOME and the project in a temporary directory.

The hook judges paths, never file contents, so no fixture file needs to exist except the local allowed-suffixes file.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent / "block_credential_crawl.py"


def run_hook(stdin: str, home: Path) -> str | None:
    """The hook's deny reason for one call, or None when it lets the call through."""
    env = {**os.environ, "HOME": str(home)}
    result = subprocess.run([sys.executable, str(HOOK)], input=stdin, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    if not result.stdout.strip():
        return None
    output = json.loads(result.stdout)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    return output["permissionDecisionReason"]


def judge(tool: str, tool_input: dict, tmp_path: Path) -> str | None:
    project = tmp_path / "project"
    payload = {"tool_name": tool, "tool_input": tool_input, "cwd": str(project)}
    return run_hook(json.dumps(payload), tmp_path / "home")


@pytest.mark.parametrize(
    ("tool", "tool_input"),
    [
        ("Read", {"file_path": "~/.pgpass"}),
        ("Read", {"file_path": "config/.env"}),
        ("Read", {"file_path": "src/main/resources/database.properties"}),
        ("Read", {"file_path": "~/.npmrc"}),
        ("Bash", {"command": "cat ~/.aws/credentials"}),
        ("Bash", {"command": "sed -n 1p .env"}),
        ("Bash", {"command": "wc -l < ~/.netrc"}),
        ("Bash", {"command": "LC_ALL=C sudo -n cat /etc/shadow"}),
        ("Bash", {"command": "ls && head -1 keys/server.p12"}),
        ("Bash", {"command": ". ~/.envrc"}),
        ("Bash", {"command": "grep -r token ~/.ssh"}),
        ("Bash", {"command": "rg password ~"}),
        ("Bash", {"command": "rg -i api_key ../sibling-project"}),
        ("Bash", {"command": "cat ~/.pgpass 'unterminated"}),
        ("Grep", {"pattern": "client_secret", "path": "~/work"}),
        ("Grep", {"pattern": "TODO", "path": "~/.aws"}),
        ("Grep", {"pattern": "TODO", "glob": "*.env"}),
        ("Glob", {"pattern": "**/*.pem"}),
        ("Glob", {"pattern": "**/id_*"}),
        ("Glob", {"pattern": "*", "path": "~/.ssh"}),
    ],
)
def test_denies_reading_a_store_or_hunting_outside_the_project(tool: str, tool_input: dict, tmp_path: Path) -> None:
    assert judge(tool, tool_input, tmp_path)


@pytest.mark.parametrize(
    ("tool", "tool_input"),
    [
        ("Bash", {"command": "sed -n 1,20p notes/credential-rotation.md"}),
        ("Bash", {"command": "jq '.env' package.json"}),
        ("Bash", {"command": "grep -n credential plugins/guardrails/hooks/block_credential_crawl.py"}),
        ("Bash", {"command": "rg password src"}),
        ("Bash", {"command": "grep -n TODO ~/.ssh"}),
        ("Bash", {"command": "printf 'A=1\\n' > .env"}),
        ("Bash", {"command": "echo 'unterminated"}),
        ("Bash", {"command": "cat .env.sample"}),
        ("Read", {"file_path": ".env.example"}),
        ("Read", {"file_path": "config/.env.template"}),
        ("Read", {"file_path": ".npmrc"}),
        ("Grep", {"pattern": "PasswordEncoder", "path": "src"}),
        ("Glob", {"pattern": "**/*.py"}),
    ],
)
def test_allows_project_work_that_only_mentions_a_credential(tool: str, tool_input: dict, tmp_path: Path) -> None:
    assert judge(tool, tool_input, tmp_path) is None


def test_allowed_suffix_file_exempts_only_the_paths_it_lists(tmp_path: Path) -> None:
    fixture = {"file_path": "tests/fixtures/sample.pem"}
    assert judge("Read", fixture, tmp_path)

    local = tmp_path / "home" / ".claude" / "local" / "guardrails"
    local.mkdir(parents=True)
    (local / "credential-allowed-suffixes.txt").write_text("# test keys\n\ntests/fixtures/sample.pem\n")
    assert judge("Read", fixture, tmp_path) is None
    assert judge("Read", {"file_path": "tests/fixtures/other.pem"}, tmp_path)


@pytest.mark.parametrize("stdin", ["not json", json.dumps({"tool_name": "Read", "tool_input": ["a list"]})])
def test_an_error_inside_the_hook_denies(stdin: str, tmp_path: Path) -> None:
    assert run_hook(stdin, tmp_path / "home")
