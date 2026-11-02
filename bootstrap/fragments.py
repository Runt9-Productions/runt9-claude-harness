import functools
from pathlib import Path

from bootstrap.core import CLAUDE_DIR, Component, Run, Stop
from bootstrap.files import write_after_asking
from bootstrap.harness import CURRENT, require_installed, shipped_in_head

FRAGMENTS = "fragments"
USER_CLAUDE_MD = CLAUDE_DIR / "CLAUDE.md"
# Inside the installed harness; a missing ~/.claude/CLAUDE.md starts from it. Not named CLAUDE.md, which Claude Code
# would load as instructions for sessions working in harness/.
CLAUDE_MD_TEMPLATE = "claude-md-template.md"
BLOCK_START = "<!-- runt9-claude-harness: bootstrap.py keeps the lines from here to the end marker -->"
BLOCK_END = "<!-- runt9-claude-harness: end -->"


def check_fragment(name: str, run: Run) -> None:
    # A harness installed in this run comes from HEAD, which is where the fragment was listed from.
    if "harness" not in run.picked:
        require_installed(f"{FRAGMENTS}/{name}.md")
    if USER_CLAUDE_MD.exists():
        block_bounds(USER_CLAUDE_MD.read_bytes().decode().splitlines())


def block_bounds(lines: list[str]) -> tuple[int, int] | None:
    """The indexes of the block's start and end marker lines, or None when `lines` has neither marker. Raises Stop
    when the markers are not one start line followed by one end line, which `check_fragment` relies on."""
    starts = [index for index, line in enumerate(lines) if line.rstrip() == BLOCK_START]
    ends = [index for index, line in enumerate(lines) if line.rstrip() == BLOCK_END]
    if not starts and not ends:
        return None
    if len(starts) != 1 or len(ends) != 1 or ends[0] < starts[0]:
        raise Stop(f"{USER_CLAUDE_MD} needs one {BLOCK_START} line, then one {BLOCK_END} line; fix the markers by hand")
    return starts[0], ends[0]


def with_import(text: str, import_line: str) -> str:
    """`text` with `import_line` added at the end of the block, or with a new block holding it appended. Returns
    `text` unchanged when any line already imports it, inside the block or not."""
    lines = text.splitlines(keepends=True)
    bounds = block_bounds(lines)
    if any(line.strip() == import_line for line in lines):
        return text
    if bounds is None:
        if text and not text.endswith("\n"):
            text += "\n"
        separator = "\n" if text else ""
        return f"{text}{separator}{BLOCK_START}\n{import_line}\n{BLOCK_END}\n"
    _, end = bounds
    lines.insert(end, f"{import_line}\n")
    return "".join(lines)


def install_fragment(name: str, run: Run) -> None:
    fragment = require_installed(f"{FRAGMENTS}/{name}.md")
    import_line = f"@~/{fragment.relative_to(Path.home())}"
    # Resolved so a CLAUDE.md that links elsewhere keeps its link and the file it names changes.
    target = USER_CLAUDE_MD.resolve()
    template = CURRENT / CLAUDE_MD_TEMPLATE
    if USER_CLAUDE_MD.exists():
        # Bytes, so line endings outside the block survive the round trip.
        before = USER_CLAUDE_MD.read_bytes().decode()
        base_text = before
    else:
        before = ""
        base_text = template.read_bytes().decode() if template.is_file() else ""
    after = with_import(base_text, import_line)
    if after == before:
        print(f"fragment:{name}: {USER_CLAUDE_MD} already imports {fragment}")
        return
    write_after_asking(target, before, after)
    print(f"fragment:{name}: {target} imports {fragment}")


def fragment_components() -> list[Component]:
    components = []
    for path in shipped_in_head(FRAGMENTS, ".md"):
        components.append(
            Component(
                name=f"fragment:{path.stem}",
                summary=f"import ~/.claude/harness/current/{FRAGMENTS}/{path.name} in ~/.claude/CLAUDE.md",
                install=functools.partial(install_fragment, path.stem),
                check=functools.partial(check_fragment, path.stem),
            )
        )
    return components
