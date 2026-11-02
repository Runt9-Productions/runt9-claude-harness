#!/usr/bin/env python3
"""Claude Code status line: model, branch and session name, then context and rate-limit meters.

Reads the session JSON Claude Code passes on stdin and prints two lines, such as:

    [Model X·high] | ⎇ main | ✳ session name
    [ctx ██░░░░░░░░ 25% (50k/200k)] | [5hr ██████░░░░ 60% (22:13)] | [1wk █████████░ 90% (11/14)]

Only stdout becomes the status line, so every field is optional. On any failure stdout is an empty line and the
traceback goes to stderr, which `claude --debug` logs.

Runs under whatever `python3` the shell finds, so it keeps to Python 3.9.
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import traceback
from collections.abc import Callable
from datetime import datetime

RESET = "\033[0m"
DIM = "\033[90m"
GREEN = "\033[32m"
GOLD = "\033[38;5;178m"
RED = "\033[31m"
CYAN = "\033[36m"

FILLED = "█"
EMPTY = "░"

# (minimum terminal columns, bar width), widest first. Each minimum fits line two at that bar width with every meter at
# 100% and its longest detail.
BAR_TIERS = ((100, 10), (91, 8), (85, 6), (0, 4))

# With less room than this, the session name is left out rather than cut to a stub.
MIN_SESSION_NAME = 12

DEFAULT_COLUMNS = 100


def columns() -> int:
    # Claude Code sets COLUMNS. The output is captured, so tput cannot see the terminal from here.
    try:
        return int(os.environ.get("COLUMNS", DEFAULT_COLUMNS))
    except ValueError:
        return DEFAULT_COLUMNS


def bar_width() -> int:
    cols = columns()
    for minimum, width in BAR_TIERS:
        if cols >= minimum:
            return width
    return BAR_TIERS[-1][1]


def colour(pct: float) -> str:
    if pct >= 80:
        return RED
    if pct >= 50:
        return GOLD
    return GREEN


def bar(pct: float, width: int) -> str:
    pct = max(0.0, min(100.0, pct))
    # Floored like the label, so neither reads full before 100%; any usage above 0 shows one block.
    filled = math.floor(pct * width / 100)
    if pct > 0 and filled == 0:
        filled = 1
    return f"{colour(pct)}{FILLED * filled}{DIM}{EMPTY * (width - filled)}{RESET}"


def human(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    if n >= 1000:
        return f"{n // 1000}k"
    return str(n)


def meter(label: str, pct: float, detail: str, width: int) -> str:
    body = f"{DIM}{label}{RESET} {bar(pct, width)} {colour(pct)}{math.floor(pct)}%{RESET}"
    if detail:
        body += f" {DIM}({detail}){RESET}"
    return f"{DIM}[{RESET}{body}{DIM}]{RESET}"


def git_branch() -> str | None:
    # The payload has no branch. This runs on every message, so a slower git call (such as status) stalls the UI.
    try:
        out = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True, timeout=2)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


def clock(when: datetime) -> str:
    return when.strftime("%H:%M")


def month_day(when: datetime) -> str:
    return f"{when.month}/{when.day}"


def reset_time(timestamp: float, show: Callable[[datetime], str]) -> str:
    try:
        when = datetime.fromtimestamp(timestamp)
    except (TypeError, ValueError, OverflowError, OSError):
        return ""
    return show(when)


def context_pct(window: dict) -> float | None:
    pct = window.get("used_percentage")
    if pct is not None:
        return float(pct)
    size = window.get("context_window_size") or 0
    used = window.get("total_input_tokens") or 0
    return used / size * 100 if size else None


def line_one(data: dict) -> str:
    # (plain, coloured) pairs: the plain text measures the width left for the session name.
    parts = []

    model = (data.get("model") or {}).get("display_name")
    if model:
        # The parenthetical names the context size, which the ctx meter already shows.
        model = re.sub(r"\s*\([^)]*\)", "", model).strip()
        effort = (data.get("effort") or {}).get("level")
        tag = f"{model}·{effort}" if effort else model
        if data.get("fast_mode"):
            tag += "·fast"
        parts.append((f"[{tag}]", f"{CYAN}[{tag}]{RESET}"))

    branch = git_branch()
    if branch:
        parts.append((f"⎇ {branch}", f"{DIM}⎇{RESET} {branch}"))

    name = data.get("session_name")
    if name:
        separators = 3 * len(parts)
        room = columns() - sum(len(plain) for plain, _ in parts) - separators - 4
        if room >= MIN_SESSION_NAME:
            if len(name) > room:
                name = name[: room - 1].rstrip() + "…"
            parts.append((f"✳ {name}", f"{DIM}✳{RESET} {name}"))

    return f" {DIM}|{RESET} ".join(coloured for _, coloured in parts)


def line_two(data: dict) -> str:
    width = bar_width()
    meters = []

    window = data.get("context_window") or {}
    pct = context_pct(window)
    if pct is not None:
        size = window.get("context_window_size") or 0
        used = window.get("total_input_tokens") or 0
        meters.append(meter("ctx", pct, f"{human(used)}/{human(size)}" if size else "", width))

    limits = data.get("rate_limits") or {}
    for key, label, show in (("five_hour", "5hr", clock), ("seven_day", "1wk", month_day)):
        limit = limits.get(key) or {}
        used_pct = limit.get("used_percentage")
        if used_pct is None:
            continue
        resets = reset_time(limit["resets_at"], show) if limit.get("resets_at") else ""
        meters.append(meter(label, float(used_pct), resets, width))

    return f" {DIM}|{RESET} ".join(meters)


def main() -> None:
    try:
        data = json.load(sys.stdin)
        lines = [line for line in (line_one(data), line_two(data)) if line]
    except Exception:
        traceback.print_exc()
        lines = [""]
    for line in lines:
        print(line)


if __name__ == "__main__":
    main()
