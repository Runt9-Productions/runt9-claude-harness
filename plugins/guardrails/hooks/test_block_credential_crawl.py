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
PGPASS = "`~/.pgpass` is a credential file"
ENV_LOCAL = "`.env.production` is a credential file"


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
        pytest.param("Bash", {"command": "TOKEN=$(cat ~/.pgpass)"}, PGPASS, id="command-substitution"),
        pytest.param("Bash", {"command": 'echo "$(cat ~/.pgpass)"'}, PGPASS, id="substitution-in-double-quotes"),
        pytest.param("Bash", {"command": "echo `cat ~/.pgpass`"}, PGPASS, id="backtick-substitution"),
        pytest.param("Bash", {"command": "(cat ~/.pgpass)"}, PGPASS, id="subshell"),
        pytest.param("Bash", {"command": "{ cat ~/.pgpass; }"}, PGPASS, id="brace-group"),
        pytest.param("Bash", {"command": "ls\ncat ~/.pgpass"}, PGPASS, id="newline-between-commands"),
        pytest.param("Bash", {"command": "if true; then cat .env.production; fi"}, ENV_LOCAL, id="then-branch"),
        pytest.param(
            "Bash",
            {"command": "for f in a; do cat ~/.netrc; done"},
            "`~/.netrc` is a credential file",
            id="loop-body",
        ),
        pytest.param(
            "Bash",
            {"command": "sudo -u root cat /etc/shadow"},
            "`/etc/shadow` is a credential file",
            id="wrapper-option-value",
        ),
        pytest.param("Bash", {"command": "timeout 5 cat ~/.pgpass"}, PGPASS, id="wrapper-operand"),
        pytest.param("Bash", {"command": "nice -n 5 cat .env.production"}, ENV_LOCAL, id="nice-adjustment"),
        pytest.param("Bash", {"command": "exec cat ~/.pgpass"}, PGPASS, id="exec"),
        pytest.param("Bash", {"command": "cat .env*"}, "`.env*` is a credential file", id="bash-wildcard-name"),
        pytest.param(
            "Bash", {"command": "cat ~/.ssh/*"}, "`~/.ssh/*` is a credential file", id="bash-wildcard-credential-dir"
        ),
        pytest.param(
            "Bash",
            {"command": "cd ~/.aws && cat credentials"},
            "`credentials` is a credential file",
            id="relative-after-cd",
        ),
        pytest.param(
            "Bash",
            {"command": "cd ~ && rg -i api_key"},
            "a search outside the project for a credential (`api_key`)",
            id="search-after-cd",
        ),
        pytest.param(
            "Read",
            {"file_path": "~/.ssh/work_key"},
            "`~/.ssh/work_key` is a credential file",
            id="read-in-credential-dir",
        ),
        pytest.param(
            "Bash",
            {"command": "cat ~/.ssh/id_ed25519_work"},
            "`~/.ssh/id_ed25519_work` is a credential file",
            id="non-default-ssh-key",
        ),
        pytest.param(
            "Bash",
            {"command": "cat ~/.gnupg/private-keys-v1.d/ABC.key"},
            "`~/.gnupg/private-keys-v1.d/ABC.key` is a credential file",
            id="gnupg-private-key",
        ),
        pytest.param(
            "Bash", {"command": "cat certs/server.key"}, "`certs/server.key` is a credential file", id="key-extension"
        ),
        pytest.param(
            "Glob", {"pattern": "**/*.key"}, "`**/*.key` in `{project}` names credential files", id="glob-key-files"
        ),
        pytest.param(
            "Bash", {"command": "cat ~/.kube/config"}, "`~/.kube/config` is a credential file", id="kube-config"
        ),
        pytest.param(
            "Bash",
            {"command": "rg --max-depth 3 password ~"},
            "a search outside the project for a credential (`password`)",
            id="max-depth-value",
        ),
        pytest.param(
            "Bash",
            {"command": "rg --context 2 api_key ~/work"},
            "a search outside the project for a credential (`api_key`)",
            id="context-value",
        ),
        pytest.param(
            "Bash",
            {"command": "grep -rn --after-context 2 password /etc"},
            "a search outside the project for a credential (`password`)",
            id="after-context-value",
        ),
        pytest.param(
            "Bash",
            {"command": "grep -d recurse password ~"},
            "a search outside the project for a credential (`password`)",
            id="directories-value",
        ),
        pytest.param(
            "Bash",
            {"command": "grep -rl 'PRIVATE KEY' ~"},
            "a search outside the project for a credential (`PRIVATE KEY`)",
            id="keyword-with-space",
        ),
        pytest.param(
            "Bash",
            {"command": "rg -i secret ~"},
            "a search outside the project for a credential (`secret`)",
            id="keyword-secret",
        ),
        pytest.param(
            "Bash",
            {"command": "grep -ri token ~/.config"},
            "a search outside the project for a credential (`token`)",
            id="keyword-token",
        ),
        pytest.param(
            "Grep",
            {"pattern": "TODO", "glob": "*.{pem,p12}"},
            "`*.{pem,p12}` names credential files",
            id="grep-glob-brace-list",
        ),
        pytest.param(
            "Grep",
            {"pattern": "password", "glob": "*.properties"},
            "a search for a credential through config files (`password` in `*.properties`)",
            id="grep-keyword-through-config-files",
        ),
        pytest.param(
            "Monitor",
            {"command": "cat ~/.aws/credentials"},
            "`~/.aws/credentials` is a credential file",
            id="monitor-command",
        ),
        pytest.param("Bash", {"command": "cp .env /tmp/backup"}, "`.env` is a credential file", id="cp-source"),
        pytest.param(
            "Bash", {"command": "cat ${HOME}/.npmrc"}, "`${HOME}/.npmrc` is a credential file", id="braced-home"
        ),
    ],
)
def test_denies_reading_a_store_or_hunting_outside_the_project(
    tool: str, tool_input: dict, expected: str, tmp_path: Path
) -> None:
    reason = judge(tool, tool_input, tmp_path)

    # `replace`, since `format` would read the braces of `${HOME}` and `*.{pem,p12}` as fields.
    assert_denied_for(reason, expected.replace("{project}", str(tmp_path / "project")))


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
        pytest.param("Glob", {"pattern": ".*"}, id="glob-dot-files"),
        pytest.param("Glob", {"pattern": "**/.*rc"}, id="glob-rc-files"),
        pytest.param("Bash", {"command": "cp .env.example .env"}, id="cp-destination"),
        pytest.param("Bash", {"command": "cat ~/.ssh/known_hosts"}, id="non-secret-in-credential-dir"),
        pytest.param("Bash", {"command": "cat <<EOF\ncat ~/.pgpass\nEOF"}, id="heredoc-body"),
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
