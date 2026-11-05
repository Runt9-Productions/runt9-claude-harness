from bootstrap.core import CLONE
from bootstrap.git import git


def head_text(path: str) -> str:
    """The text of `path` in HEAD, or "" when HEAD has no file there. Raises Stop when git fails for another reason."""
    if not git(CLONE, "ls-tree", "--full-tree", "HEAD", "--", path):
        return ""
    return git(CLONE, "show", f"HEAD:{path}").decode()


def row_cells(line: str) -> tuple[str, str] | None:
    """A table row's first cell and everything after it up to the closing `|`, both stripped, or None when `line` is
    not a table row."""
    row = line.strip()
    if not row.startswith("|"):
        return None
    first_cell, separator, rest = row[1:].partition("|")
    if not separator:
        return None
    return first_cell.strip(), rest.removesuffix("|").strip()


def table_row(path: str, column: str, key: str) -> str:
    """Everything after the first cell of the row whose first cell is `key` in backticks, up to the row's closing
    `|`, in the table of `path` at HEAD whose header's second cell is `column`. A table runs from its header row to
    the first line that is not a row. "" when there is no such row or HEAD has no `path`."""
    # The second header cell of the table the walk is in, or None between tables.
    heading = None
    for line in head_text(path).splitlines():
        cells = row_cells(line)
        if cells is None:
            heading = None
            continue
        first_cell, rest = cells
        if heading is None:
            heading = rest.partition("|")[0].strip()
            continue
        if heading == column and first_cell == f"`{key}`":
            return rest
    return ""


def first_paragraph(path: str) -> str:
    """The first paragraph after the H1 of `path` at HEAD, its lines joined by spaces. "" when there is none or HEAD
    has no `path`."""
    lines = head_text(path).splitlines()
    headings = [index for index, line in enumerate(lines) if line.startswith("# ")]
    if not headings:
        return ""
    paragraph = []
    for line in lines[headings[0] + 1 :]:
        if line.strip():
            paragraph.append(line.strip())
        elif paragraph:
            break
    return " ".join(paragraph)
