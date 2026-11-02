"""statusline.py run as a subprocess in a clean environment, with synthetic session JSON on stdin."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("statusline.py")
ANSI = re.compile(r"\033\[[0-9;]*m")
RESET_AT = 1_700_000_000  # 2023-11-14 22:13:20 UTC


def clean_env(cwd: Path, columns: int) -> dict[str, str]:
    # No git setting or repository from the caller reaches git: discovery stops above the test's directory.
    return {
        "PATH": os.environ["PATH"],
        "HOME": str(cwd),
        "COLUMNS": str(columns),
        "TZ": "UTC",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CEILING_DIRECTORIES": str(cwd.parent),
    }


def run(stdin: str, cwd: Path, columns: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=stdin,
        capture_output=True,
        encoding="utf-8",
        cwd=cwd,
        env=clean_env(cwd, columns),
        check=False,
    )


def plain_lines(result: subprocess.CompletedProcess) -> list[str]:
    assert result.returncode == 0, result.stderr
    return ANSI.sub("", result.stdout).splitlines()


def test_input_that_is_not_a_session_prints_an_empty_line(tmp_path: Path) -> None:
    for stdin in ("not json", "[1, 2]"):
        result = run(stdin, tmp_path)
        assert result.returncode == 0
        assert result.stdout == "\n"


def test_a_model_alone_prints_one_line_without_its_parenthetical(tmp_path: Path) -> None:
    session = {"model": {"display_name": "Model X (2M context)"}, "effort": {"level": "high"}}
    assert plain_lines(run(json.dumps(session), tmp_path)) == ["[Model X·high]"]


def test_inside_a_git_repository_the_branch_and_a_session_name_that_fits_are_shown(tmp_path: Path) -> None:
    git_init = ["git", "init", "--quiet", "--initial-branch", "feature-x"]
    subprocess.run(git_init, cwd=tmp_path, env=clean_env(tmp_path, 120), check=True)
    session = {"model": {"display_name": "Model X"}, "session_name": "synthetic session"}
    assert plain_lines(run(json.dumps(session), tmp_path)) == ["[Model X] | ⎇ feature-x | ✳ synthetic session"]


def test_a_session_name_with_part_of_the_room_it_needs_is_cut_to_fit(tmp_path: Path) -> None:
    name = "a session name too long to fit"
    session = {"model": {"display_name": "Model X"}, "session_name": name}
    (line,) = plain_lines(run(json.dumps(session), tmp_path, columns=36))
    shown = line.removeprefix("[Model X] | ✳ ")
    assert len(line) <= 36
    assert shown.endswith("…")
    assert len(shown) > 1
    assert name.startswith(shown[:-1])


def test_meters_show_usage_and_reset_times(tmp_path: Path) -> None:
    session = {
        "context_window": {"used_percentage": 25, "context_window_size": 200_000, "total_input_tokens": 50_000},
        "rate_limits": {
            "five_hour": {"used_percentage": 60, "resets_at": RESET_AT},
            "seven_day": {"used_percentage": 90, "resets_at": RESET_AT},
        },
    }
    (line,) = plain_lines(run(json.dumps(session), tmp_path))
    assert line == "[ctx ██░░░░░░░░ 25% (50k/200k)] | [5hr ██████░░░░ 60% (22:13)] | [1wk █████████░ 90% (11/14)]"


def test_without_a_used_percentage_context_is_tokens_over_the_window_floored(tmp_path: Path) -> None:
    session = {
        "context_window": {"used_percentage": None, "context_window_size": 200_000, "total_input_tokens": 199_000}
    }
    (line,) = plain_lines(run(json.dumps(session), tmp_path))
    assert line == "[ctx █████████░ 99% (199k/200k)]"


def test_at_80_columns_the_widest_meter_line_fits(tmp_path: Path) -> None:
    full = {"used_percentage": 100, "resets_at": RESET_AT}
    session = {
        "context_window": {"used_percentage": 100, "context_window_size": 200_000, "total_input_tokens": 200_000},
        "rate_limits": {"five_hour": full, "seven_day": full},
    }
    (line,) = plain_lines(run(json.dumps(session), tmp_path, columns=80))
    assert len(line) <= 80


def test_a_narrow_terminal_shrinks_the_bars_and_drops_a_long_session_name(tmp_path: Path) -> None:
    session = {
        "model": {"display_name": "Model X"},
        "session_name": "a session name too long to fit",
        "context_window": {"used_percentage": 50},
    }
    first, second = plain_lines(run(json.dumps(session), tmp_path, columns=20))
    assert first == "[Model X]"
    assert second == "[ctx ██░░ 50%]"
