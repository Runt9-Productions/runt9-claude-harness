import os
import shlex
from pathlib import Path

from bootstrap.core import Run, Stop, warn
from bootstrap.git import git, git_config, run_git
from bootstrap.harness import CURRENT, require_harness


def check_hooks_path(run: Run) -> None:
    if not run.repos:
        raise Stop("hooks-path needs --repo <path>, once for each repository")
    for repo in run.repos:
        result = run_git(repo, "rev-parse", "--show-toplevel")
        if result.returncode != 0:
            raise Stop(f"{repo} is not a git repository")
        top_level = Path(os.fsdecode(result.stdout).strip())
        if not top_level.samefile(repo):
            raise Stop(f"{repo} is inside the repository {top_level}, not its top level")


def report_replaced_hooks(repo: Path, hooks: str) -> None:
    """Says what setting core.hooksPath to `hooks` turns off in `repo`: the value git uses now, from whichever
    scope, and each hook in the directory git runs hooks from now."""
    configured = git_config(repo, "--show-scope", "--get", "core.hooksPath")
    if configured is not None:
        scope, previous = configured.split("\t", 1)
        if previous == hooks:
            return
        if scope == "local":
            restore = ["git", "-C", str(repo), "config", "core.hooksPath", previous]
        else:
            # A value from another scope applies again once the repository's own is gone.
            restore = ["git", "-C", str(repo), "config", "--unset", "core.hooksPath"]
        print(f"hooks-path: {repo} had core.hooksPath {previous} from its {scope} config")
        print(f"hooks-path: to restore it: {shlex.join(restore)}")

    hooks_dir = repo / os.fsdecode(git(repo, "rev-parse", "--git-path", "hooks")).strip()
    if not hooks_dir.is_dir():
        return
    disabled = []
    for path in sorted(hooks_dir.iterdir()):
        if path.suffix == ".sample":
            continue
        if path.is_file() and os.access(path, os.X_OK):
            disabled.append(path.name)
    if disabled:
        warn(f"{repo} stops running {', '.join(disabled)} from {hooks_dir}")


def install_hooks_path(run: Run) -> None:
    require_harness()
    hooks = str(CURRENT / "githooks")
    for repo in run.repos:
        report_replaced_hooks(repo, hooks)
        git(repo, "config", "--local", "core.hooksPath", hooks)
        effective = git_config(repo, "--get", "core.hooksPath")
        if effective != hooks:
            raise Stop(f"{repo} reads core.hooksPath as {effective}, not {hooks}; a config.worktree or include sets it")
        print(f"hooks-path: {repo} uses {hooks}")
        if not git_config(repo, "--get", "claude.botEmail"):
            warn(f"{repo} sets no claude.botEmail, so only the leak gate runs there")
