"""statusline.py run as a subprocess, outside any git repository, with synthetic session JSON on stdin."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("statusline.py")
ANSI = re.compile(r"\033\[[0-9;]*m")
RESET_AT = 1_700_000_000  # 2023-11-14 22:13:20 UTC


def run(stdin: str, cwd: Path, columns: int = 120) -> subprocess.CompletedProcess:
    env = {**os.environ, "COLUMNS": str(columns), "TZ": "UTC"}
    return subprocess.run(
        [sys.executable, str(SCRIPT)], input=stdin, capture_output=True, text=True, cwd=cwd, env=env, check=False
    )


def plain_lines(result: subprocess.CompletedProcess) -> list[str]:
    return ANSI.sub("", result.stdout).splitlines()


def test_input_that_is_not_a_session_prints_an_empty_line(tmp_path: Path) -> None:
    for stdin in ("not json", "[1, 2]"):
        result = run(stdin, tmp_path)
        assert result.returncode == 0
        assert result.stdout == "\n"
        assert result.stderr == ""


def test_a_model_alone_prints_one_line_without_its_parenthetical(tmp_path: Path) -> None:
    session = {"model": {"display_name": "Model X (2M context)"}, "effort": {"level": "high"}}
    assert plain_lines(run(json.dumps(session), tmp_path)) == ["[Model X·high]"]


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


def test_a_narrow_terminal_shrinks_the_bars_and_drops_a_long_session_name(tmp_path: Path) -> None:
    session = {
        "model": {"display_name": "Model X"},
        "session_name": "a session name too long to fit",
        "context_window": {"used_percentage": 50},
    }
    first, second = plain_lines(run(json.dumps(session), tmp_path, columns=20))
    assert first == "[Model X]"
    assert second == "[ctx ███░░░ 50%]"
