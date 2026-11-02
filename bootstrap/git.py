import functools
import os
import subprocess
from pathlib import Path

from bootstrap.core import Stop


@functools.cache
def git_environment() -> dict[str, str]:
    """The caller's environment without the variables that point git at another repository or add config to it, so
    each call acts on the directory it names."""
    listed = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True)
    if listed.returncode != 0:
        raise Stop(f"git rev-parse --local-env-vars exited {listed.returncode}")
    redirecting = set(listed.stdout.split())
    return {name: value for name, value in os.environ.items() if name not in redirecting}


def run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, env=git_environment())


def git_failure(cwd: Path, args: tuple[str, ...], result: subprocess.CompletedProcess[bytes]) -> Stop:
    lines = result.stderr.decode(errors="replace").strip().splitlines()
    reason = lines[-1] if lines else f"exit {result.returncode}"
    return Stop(f"git {' '.join(args)} failed in {cwd}: {reason}")


def git(cwd: Path, *args: str) -> bytes:
    result = run_git(cwd, *args)
    if result.returncode != 0:
        raise git_failure(cwd, args, result)
    return result.stdout


def git_config(repo: Path, *args: str) -> str | None:
    """The value of `git config <args>`, or None when the key is unset."""
    result = run_git(repo, "config", *args)
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        raise git_failure(repo, ("config", *args), result)
    return os.fsdecode(result.stdout).strip()
