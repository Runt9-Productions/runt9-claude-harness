import difflib
import json
import shutil
import tempfile
from pathlib import Path

from bootstrap.core import Stop, answered_yes


def parse_json_object(text: str | bytes, origin: str) -> dict:
    try:
        value = json.loads(text)
    except ValueError as error:
        raise Stop(f"{origin} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise Stop(f"{origin} is not a JSON object")
    return value


def read_json_object(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise Stop(f"cannot read {path}: {error.strerror}") from error
    return parse_json_object(text, str(path))


def write_after_asking(target: Path, before: str, after: str) -> None:
    """Shows the diff from `before` to `after` and writes `after` to `target` on yes. Raises Stop on no."""
    diff = difflib.unified_diff(
        before.splitlines(), after.splitlines(), fromfile=str(target), tofile=str(target), lineterm=""
    )
    print("\n".join(diff))
    no_stdin = f"no answer on stdin to whether to write {target}; run bootstrap.py in a terminal"
    if not answered_yes(f"Write this to {target}? [y/N] ", no_stdin):
        raise Stop(f"not written, so {target} is unchanged")

    target.parent.mkdir(parents=True, exist_ok=True)
    # Staged beside the file and renamed over it, so a failed write leaves the old one whole.
    with tempfile.TemporaryDirectory(prefix=".staging-", dir=target.parent) as staging:
        staged = Path(staging) / target.name
        staged.write_bytes(after.encode())
        if target.exists():
            shutil.copymode(target, staged)
        staged.replace(target)
