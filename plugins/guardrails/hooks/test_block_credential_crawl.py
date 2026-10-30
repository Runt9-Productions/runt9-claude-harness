"""block_credential_crawl.py run as a subprocess, with HOME and the project in a temporary directory and no other
variable of the machine's environment. Needs pytest.

The hook judges paths, never file contents, so no fixture file needs to exist except the local allowed-suffixes file.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent / "block_credential_crawl.py"
# Follows every decision's reason and no error's, so a crash that denies cannot pass for a decision.
GUIDANCE = ". Credentials are off-limits"


def run_hook(stdin: str, home: Path) -> str | None:
    """The hook's deny reason for one call, or None when it lets the call through."""
    result = subprocess.run(
        [sys.executable, str(HOOK)], input=stdin, env={"HOME": str(home)}, capture_output=True, text=True
    )
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


def assert_denied_for(reason: str | None, expected: str) -> None:
    assert reason is not None
    assert reason.startswith(f"{expected}{GUIDANCE}"), reason


@pytest.mark.parametrize(
    ("tool", "tool_input", "expected"),
    [
        pytest.param("Read", {"file_path": "~/.pgpass"}, "`~/.pgpass` is a credential file", id="read-store-name"),
        pytest.param("Read", {"file_path": "config/.env"}, "`config/.env` is a credential file", id="read-env-file"),
        pytest.param(
            "Read",
            {"file_path": "src/main/resources/database.properties"},
            "`src/main/resources/database.properties` is a credential file",
            id="read-secret-config",
        ),
        pytest.param("Read", {"file_path": "~/.npmrc"}, "`~/.npmrc` is a credential file", id="read-home-npmrc"),
        pytest.param(
            "Bash",
            {"command": "cat ~/.aws/credentials"},
            "`~/.aws/credentials` is a credential file",
            id="reader-of-store-path",
        ),
        pytest.param("Bash", {"command": "sed -n 1p .env"}, "`.env` is a credential file", id="file-after-script"),
        pytest.param("Bash", {"command": "wc -l < ~/.netrc"}, "`~/.netrc` is a credential file", id="input-redirect"),
        pytest.param(
            "Bash",
            {"command": "LC_ALL=C sudo -n cat /etc/shadow"},
            "`/etc/shadow` is a credential file",
            id="assignment-and-wrapper",
        ),
        pytest.param(
            "Bash",
            {"command": "ls && head -1 keys/server.p12"},
            "`keys/server.p12` is a credential file",
            id="key-file-in-a-later-command",
        ),
        pytest.param("Bash", {"command": ". ~/.envrc"}, "`~/.envrc` is a credential file", id="dot-source"),
        pytest.param(
            "Bash",
            {"command": "grep -r token ~/.ssh"},
            "`~/.ssh` holds credential files",
            id="recursive-search-of-credential-dir",
        ),
        pytest.param(
            "Bash",
            {"command": "rg password ~"},
            "a search outside the project for a credential (`password`)",
            id="keyword-search-of-home",
        ),
        pytest.param(
            "Bash",
            {"command": "rg -i api_key ../sibling-project"},
            "a search outside the project for a credential (`api_key`)",
            id="keyword-search-of-relative-sibling",
        ),
        pytest.param(
            "Bash",
            {"command": "cat ~/.pgpass 'unterminated"},
            "`~/.pgpass` is a credential file, in a command that does not parse",
            id="unparseable-naming-store",
        ),
        pytest.param(
            "Grep",
            {"pattern": "client_secret", "path": "~/work"},
            "a search outside the project for a credential (`client_secret`)",
            id="grep-keyword-outside",
        ),
        pytest.param(
            "Grep", {"pattern": "TODO", "path": "~/.aws"}, "`~/.aws` holds credentials", id="grep-credential-dir"
        ),
        pytest.param(
            "Grep", {"pattern": "TODO", "glob": "*.env"}, "`*.env` names credential files", id="grep-glob-env-file"
        ),
        pytest.param(
            "Glob", {"pattern": "**/*.pem"}, "`**/*.pem` in `{project}` names credential files", id="glob-key-extension"
        ),
        pytest.param(
            "Glob", {"pattern": "**/id_*"}, "`**/id_*` in `{project}` names credential files", id="glob-store-name"
        ),
        pytest.param(
            "Glob",
            {"pattern": "*", "path": "~/.ssh"},
            "`*` in `~/.ssh` names credential files",
            id="glob-credential-dir",
        ),
    ],
)
def test_denies_reading_a_store_or_hunting_outside_the_project(
    tool: str, tool_input: dict, expected: str, tmp_path: Path
) -> None:
    reason = judge(tool, tool_input, tmp_path)

    assert_denied_for(reason, expected.format(project=tmp_path / "project"))


@pytest.mark.parametrize(
    ("tool", "tool_input"),
    [
        pytest.param("Bash", {"command": "sed -n 1,20p notes/credential-rotation.md"}, id="keyword-in-file-name"),
        pytest.param("Bash", {"command": "jq '.env' package.json"}, id="script-naming-a-store"),
        pytest.param("Bash", {"command": "rg password src"}, id="keyword-search-inside"),
        pytest.param("Bash", {"command": "grep -n TODO ~/.ssh"}, id="non-recursive-search-of-credential-dir"),
        pytest.param("Bash", {"command": "printf 'A=1\\n' > .env"}, id="output-redirect"),
        pytest.param("Bash", {"command": "echo 'unterminated"}, id="unparseable-naming-nothing"),
        pytest.param("Read", {"file_path": "config/.env.template"}, id="env-template"),
        pytest.param("Read", {"file_path": ".npmrc"}, id="project-npmrc"),
        pytest.param("Grep", {"pattern": "PasswordEncoder", "path": "src"}, id="grep-keyword-inside"),
        pytest.param("Glob", {"pattern": "**/*.py"}, id="glob-other-extension"),
        pytest.param("Glob", {"pattern": "**/*"}, id="glob-wildcard-only"),
    ],
)
def test_allows_project_work_that_only_mentions_a_credential(tool: str, tool_input: dict, tmp_path: Path) -> None:
    assert judge(tool, tool_input, tmp_path) is None


def test_allowed_suffix_file_exempts_only_the_paths_it_lists(tmp_path: Path) -> None:
    fixture = {"file_path": "tests/fixtures/sample.pem"}
    assert_denied_for(judge("Read", fixture, tmp_path), "`tests/fixtures/sample.pem` is a credential file")

    local = tmp_path / "home" / ".claude" / "local" / "guardrails"
    local.mkdir(parents=True)
    (local / "credential-allowed-suffixes.txt").write_text("# test keys\n\ntests/fixtures/sample.pem\n")
    assert judge("Read", fixture, tmp_path) is None
    other = judge("Read", {"file_path": "tests/fixtures/other.pem"}, tmp_path)
    assert_denied_for(other, "`tests/fixtures/other.pem` is a credential file")


@pytest.mark.parametrize(
    "stdin",
    [
        pytest.param("not json", id="unparseable-payload"),
        pytest.param(json.dumps({"tool_name": "Read", "tool_input": ["a list"]}), id="tool-input-not-an-object"),
    ],
)
def test_an_error_inside_the_hook_denies(stdin: str, tmp_path: Path) -> None:
    reason = run_hook(stdin, tmp_path / "home")

    assert reason is not None
    assert reason.startswith("The credential guard failed ("), reason
