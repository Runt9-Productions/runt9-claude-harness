from bootstrap.core import CLONE
from bootstrap.git import git

ROOT_README = "README.md"
COMPONENT_COLUMN = "Installs"


def head_text(path: str) -> str:
    """The text of `path` in HEAD, or "" when HEAD has no file there. Raises Stop when git fails for another reason."""
    if not git(CLONE, "ls-tree", "--full-tree", "HEAD", "--", path):
        return ""
    return git(CLONE, "show", f"HEAD:{path}").decode()


def is_row(line: str) -> bool:
    row = line.strip()
    return row.startswith("|") and "|" in row[1:]


def row_cells(row: str) -> tuple[str, str]:
    """The first cell of `row`, a line `is_row` accepts, and everything after it up to the closing `|`, both
    stripped."""
    first_cell, _, rest = row.strip()[1:].partition("|")
    return first_cell.strip(), rest.removesuffix("|").strip()


def second_cell(row: str) -> str:
    return row_cells(row)[1].partition("|")[0].strip()


def table_lines(path: str, column: str) -> list[str]:
    """The lines, header first, of the first table in `path` at HEAD whose header's second cell is `column`. A table
    runs from its header row to the first line that is not a row. [] when there is none or HEAD has no `path`."""
    rows: list[str] = []
    # The trailing "" ends a table on the file's last line.
    for line in [*head_text(path).splitlines(), ""]:
        if is_row(line):
            rows.append(line)
        elif rows and second_cell(rows[0]) == column:
            return rows
        else:
            rows = []
    return []


def table(path: str, column: str) -> str:
    """The table `table_lines` finds, as its Markdown."""
    return "\n".join(table_lines(path, column))


def table_rows(path: str, column: str) -> dict[str, str]:
    """Each body row of the table `table_lines` finds, from its first cell without backticks to everything after it
    up to the row's closing `|`."""
    rows = {}
    # Past the header and the separator row.
    for line in table_lines(path, column)[2:]:
        key, rest = row_cells(line)
        rows[key.strip("`")] = rest
    return rows


def table_row(path: str, column: str, key: str) -> str:
    """The row of `key` in the table `table_rows` reads, or "" when there is none."""
    return table_rows(path, column).get(key, "")


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


def with_installs(key: str, *what_it_is: str) -> str:
    """`what_it_is`, then `Installs:` and the row of `key` in the README's components table, a blank line between
    each. "" when any of them is "", so a doc that lost its part shows no description rather than half of one."""
    row = table_row(ROOT_README, COMPONENT_COLUMN, key)
    installs = f"Installs: {row}" if row else ""
    parts = [*what_it_is, installs]
    if not all(parts):
        return ""
    return "\n\n".join(parts)
