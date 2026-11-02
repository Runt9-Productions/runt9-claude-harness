import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from bootstrap.core import CLAUDE_DIR, CLONE, Run, Stop, answered_yes, warn
from bootstrap.files import parse_json_object
from bootstrap.git import git, git_failure, run_git

UPSTREAM = "origin/main"

HARNESS_SOURCE = "harness"
HARNESS_MANIFEST = f"{HARNESS_SOURCE}/harness.json"
# The version names a directory, so it may hold nothing that walks out of one.
VERSION_PATTERN = re.compile(r"\d+(\.\d+)*")
INSTALL_DIR = CLAUDE_DIR / "harness"
VERSIONS_DIR = INSTALL_DIR / "versions"
# Hooks and skills are reached through this link, so pointing it at another version switches all of them at once.
CURRENT = INSTALL_DIR / "current"
SOURCE_COMMIT = "SOURCE_COMMIT"
FILE_MODES = {"100644": 0o644, "100755": 0o755}
# Not installed, so changing one needs no version rise; the CI version guard exempts the same files.
NOT_SHIPPED = ("harness/*/README.md", "test_*.py", "test_*.bats", "*.test.ts", "*.test.tsx")


def check_checkout() -> None:
    changes = git(CLONE, "--no-optional-locks", "status", "--porcelain", "--untracked-files=no")
    if changes:
        raise Stop(f"{CLONE} has uncommitted changes to tracked files; commit or stash them, since only HEAD installs")
    if run_git(CLONE, "rev-parse", "--verify", "--quiet", f"refs/remotes/{UPSTREAM}^{{commit}}").returncode != 0:
        warn(f"there is no {UPSTREAM} to compare HEAD with; installing HEAD anyway")
        return
    ancestry = ("merge-base", "--is-ancestor", "HEAD", UPSTREAM)
    reachable = run_git(CLONE, *ancestry)
    if reachable.returncode == 1:
        warn(f"HEAD is not on {UPSTREAM} as of the last fetch; installing HEAD anyway")
    elif reachable.returncode != 0:
        raise git_failure(CLONE, ancestry, reachable)


def ships(path: str) -> bool:
    return not any(PurePosixPath(path).match(pattern) for pattern in NOT_SHIPPED)


@dataclass(frozen=True)
class TreeFile:
    path: str
    mode: int
    blob: str


def tree_files(commit: str, source: str) -> list[TreeFile]:
    """Every file under `source` in `commit`, empty when it has none. Raises Stop for a link or a submodule there."""
    listing = git(CLONE, "ls-tree", "-r", "-z", "--full-tree", commit, "--", source)
    files = []
    for entry in listing.split(b"\0"):
        if not entry:
            continue
        meta, raw_path = entry.split(b"\t", 1)
        mode, _, blob = meta.decode().split()
        path = os.fsdecode(raw_path)
        if mode not in FILE_MODES:
            raise Stop(f"{path} in {commit} is not a regular file (mode {mode}); only regular files install")
        files.append(TreeFile(path, FILE_MODES[mode], blob))
    return files


def export_tree(commit: str, source: str, target: Path) -> None:
    """Writes the blobs under `source` in `commit` that ship to `target`, bypassing every filter and attribute."""
    files = tree_files(commit, source)
    if not files:
        raise Stop(f"{commit} has no {source}")
    for file in files:
        if not ships(file.path):
            continue
        destination = target / Path(file.path).relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(git(CLONE, "cat-file", "blob", file.blob))
        destination.chmod(file.mode)


def harness_version(commit: str) -> str:
    origin = f"{HARNESS_MANIFEST} in {commit}"
    text = git(CLONE, "show", f"{commit}:{HARNESS_MANIFEST}")
    version = parse_json_object(text, origin).get("version")
    if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
        raise Stop(f"{origin} needs a version made of dot-separated numbers")
    return version


def install_harness(run: Run) -> None:
    commit = git(CLONE, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    version = harness_version(commit)
    target = VERSIONS_DIR / version

    replace = True
    if target.exists():
        no_stdin = f"no answer on stdin to whether to replace {target}; run bootstrap.py in a terminal"
        question = f"{version} is already installed in {target}. Replace it from {commit}? [y/N] "
        replace = answered_yes(question, no_stdin)
    if replace:
        VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
        # Staged beside where it goes, so a rename installs it whole.
        with tempfile.TemporaryDirectory(prefix=".staging-", dir=VERSIONS_DIR) as staging:
            staged = Path(staging) / version
            export_tree(commit, HARNESS_SOURCE, staged)
            (staged / SOURCE_COMMIT).write_text(f"{commit}\n", encoding="utf-8")
            if target.exists():
                shutil.rmtree(target)
            staged.rename(target)
        print(f"harness: installed {version} from {commit} into {target}")

    # A new link renamed over the old one, so `current` never names a partial version.
    link = INSTALL_DIR / ".current-new"
    link.unlink(missing_ok=True)
    link.symlink_to(Path(VERSIONS_DIR.name) / version)
    link.replace(CURRENT)
    print(f"harness: {CURRENT} points at {version}")

    for other in VERSIONS_DIR.iterdir():
        if other.name != version:
            shutil.rmtree(other)


def require_harness() -> None:
    if not CURRENT.is_dir():
        raise Stop(f"the harness is not installed in {INSTALL_DIR}; install it first")


def require_installed(relative: str) -> Path:
    path = CURRENT / relative
    if not path.is_file():
        raise Stop(f"the installed harness has no {path}; install the harness from this checkout first")
    return path


def shipped_in_head(directory: str, suffix: str) -> list[PurePosixPath]:
    """The files ending in `suffix` directly in harness/<directory>/ in HEAD, which is what the harness component
    installs."""
    source = f"{HARNESS_SOURCE}/{directory}/"
    listing = git(CLONE, "ls-tree", "--name-only", "-z", "--full-tree", "HEAD", "--", source)
    paths = [PurePosixPath(os.fsdecode(entry)) for entry in listing.split(b"\0") if entry]
    return [path for path in paths if path.suffix == suffix and ships(str(path))]
