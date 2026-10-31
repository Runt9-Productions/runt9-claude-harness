"""diff_index.py run as a subprocess over patches git writes from a scratch repository.

Needs pytest and git.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "diff_index.py"
# The test's own git calls get this too: a machine's diff or commit settings would otherwise reach them.
GIT_ISOLATION = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
IDENTITY = ["-c", "user.name=Example", "-c", "user.email=example@example.com"]
# The patch lists dir/inner.txt on lines 1 to 15, with its first line changed and a line added after its last, in two
# hunks far enough apart that git keeps them separate; then top.txt on lines 16 to 24, with one line changed.
EXPECTED_MANIFEST = "2\t1\t1-15\tdir/inner.txt\n1\t1\t16-24\ttop.txt\n"
EXPECTED_HUNKS = "1-4,10-13\tdir/inner.txt\n1-3\ttop.txt\n"
HUNKS = "3-5,10-12\tsrc/with space.txt\n-\tgone.txt\n"


def git(directory: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    env = {**os.environ, **GIT_ISOLATION}
    command = ["git", "-C", str(directory), *IDENTITY, *args]
    return subprocess.run(command, env=env, capture_output=True, check=check)


def commit(repo: Path, message: str) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)


def run_script(command: str, run_dir: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, **GIT_ISOLATION}
    arguments = [sys.executable, str(SCRIPT), command, str(run_dir)]
    return subprocess.run(arguments, cwd=run_dir.parent, env=env, capture_output=True, text=True, check=False)


def diff_into(repo: Path, run_dir: Path) -> None:
    """Write the working tree's change against HEAD into a new run directory, as the skill's fetch does."""
    run_dir.mkdir(parents=True)
    git(repo, "add", "-A")
    (run_dir / "patch.diff").write_bytes(git(repo, "diff", "HEAD").stdout)


def edit_both_files(repo: Path) -> None:
    (repo / "top.txt").write_text("one\nTWO\nthree\n")
    inner_lines = ["LINE 1", *(f"line {number}" for number in range(2, 14))]
    (repo / "dir" / "inner.txt").write_text("".join(f"{line}\n" for line in inner_lines))


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    git(tmp_path, "init", "-q", "-b", "main", str(repo))
    (repo / "dir").mkdir()
    (repo / "top.txt").write_text("one\ntwo\nthree\n")
    (repo / "dir" / "inner.txt").write_text("".join(f"line {number}\n" for number in range(1, 13)))
    commit(repo, "base")
    return repo


def test_a_run_directory_inside_the_work_tree_below_none_of_the_patched_paths_indexes_every_file(repo: Path) -> None:
    edit_both_files(repo)
    run_dir = repo / ".claude" / "output" / "code-review" / "run"
    diff_into(repo, run_dir)
    result = run_script("index", run_dir)
    assert result.returncode == 0, result.stderr
    assert result.stdout == "24\n"
    assert (run_dir / "manifest.tsv").read_text() == EXPECTED_MANIFEST
    assert (run_dir / "hunks.txt").read_text() == EXPECTED_HUNKS


def test_a_run_directory_outside_any_repository_indexes_every_file(repo: Path, tmp_path: Path) -> None:
    edit_both_files(repo)
    run_dir = tmp_path / "outside" / "run"
    diff_into(repo, run_dir)
    assert git(run_dir, "rev-parse", "--git-dir", check=False).returncode != 0
    result = run_script("index", run_dir)
    assert result.returncode == 0, result.stderr
    assert (run_dir / "manifest.tsv").read_text() == EXPECTED_MANIFEST
    assert (run_dir / "hunks.txt").read_text() == EXPECTED_HUNKS


# git quotes such a path in the patch, as "b/dir/with space \303\274.txt", so the raw path shows the quoting was undone.
def test_a_path_with_a_space_and_non_ascii_characters_is_indexed_as_the_raw_path(repo: Path, tmp_path: Path) -> None:
    (repo / "dir" / "with space ü.txt").write_text("new\n")
    run_dir = tmp_path / "run"
    diff_into(repo, run_dir)
    result = run_script("index", run_dir)
    assert result.returncode == 0, result.stderr
    assert (run_dir / "manifest.tsv").read_text() == "1\t0\t1-7\tdir/with space ü.txt\n"
    assert (run_dir / "hunks.txt").read_text() == "1-1\tdir/with space ü.txt\n"


@pytest.mark.parametrize("character", ["\t", "\n"], ids=["tab", "newline"])
def test_a_path_holding_a_tab_or_a_newline_is_refused(repo: Path, tmp_path: Path, character: str) -> None:
    (repo / "dir" / f"odd{character}name.txt").write_text("new\n")
    run_dir = tmp_path / "run"
    diff_into(repo, run_dir)
    result = run_script("index", run_dir)
    assert result.returncode == 1
    assert "index: a path holds a tab or newline" in result.stderr
    assert not (run_dir / "manifest.tsv").exists()


def test_a_file_deleted_whole_has_no_new_side_span(repo: Path, tmp_path: Path) -> None:
    git(repo, "rm", "-q", "top.txt")
    run_dir = tmp_path / "run"
    diff_into(repo, run_dir)
    result = run_script("index", run_dir)
    assert result.returncode == 0, result.stderr
    assert (run_dir / "manifest.tsv").read_text() == "0\t3\t1-9\ttop.txt\n"
    assert (run_dir / "hunks.txt").read_text() == "-\ttop.txt\n"


def test_the_combined_diff_of_a_merge_commit_is_refused_rather_than_indexed_as_empty(
    repo: Path, tmp_path: Path
) -> None:
    git(repo, "switch", "-q", "-c", "side")
    with (repo / "top.txt").open("a") as top:
        top.write("side\n")
    commit(repo, "side")
    git(repo, "switch", "-q", "main")
    with (repo / "top.txt").open("a") as top:
        top.write("main\n")
    commit(repo, "main")
    git(repo, "merge", "-q", "side", check=False)
    (repo / "top.txt").write_text("one\ntwo\nthree\nmain\nside\n")
    commit(repo, "merge")
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    patch = git(repo, "show", "HEAD").stdout
    assert b"\ndiff --cc top.txt\n" in patch
    (run_dir / "patch.diff").write_bytes(patch)
    result = run_script("index", run_dir)
    assert result.returncode == 1
    assert "index: git apply could not read patch.diff" in result.stderr
    assert not (run_dir / "manifest.tsv").exists()


def place(tmp_path: Path, locations: str) -> subprocess.CompletedProcess[str]:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "hunks.txt").write_text(HUNKS)
    (run_dir / "locations.tsv").write_text(locations)
    return run_script("place", run_dir)


def test_a_line_inside_a_span_its_ends_included_is_inline_and_a_line_between_spans_is_body(tmp_path: Path) -> None:
    result = place(tmp_path, "3\tsrc/with space.txt\n12\tsrc/with space.txt\n7\tsrc/with space.txt\n")
    assert result.returncode == 0, result.stderr
    assert result.stdout == (
        "inline\t3\tsrc/with space.txt\ninline\t12\tsrc/with space.txt\nbody\t7\tsrc/with space.txt\n"
    )


def test_a_line_in_a_file_with_no_new_side_span_or_in_a_file_outside_the_diff_is_body(tmp_path: Path) -> None:
    result = place(tmp_path, "1\tgone.txt\n4\telsewhere.txt\n")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "body\t1\tgone.txt\nbody\t4\telsewhere.txt\n"


@pytest.mark.parametrize("location", ["seven\tgone.txt", "7 gone.txt"], ids=["word for a number", "no tab"])
def test_a_location_that_is_not_a_line_number_a_tab_and_a_path_is_refused(tmp_path: Path, location: str) -> None:
    result = place(tmp_path, f"{location}\n")
    assert result.returncode == 1
    assert "place: a locations.tsv line is not a line number" in result.stderr
    assert result.stdout == ""
