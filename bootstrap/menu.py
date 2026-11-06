"""The menu `bootstrap.py` shows when no component is named: one curses list of every component, marked from the
`--update` survey, where the user ticks the components to install and opens any one's full description."""

import curses
import re
import sys
import textwrap
from dataclasses import dataclass, field

from bootstrap.core import Component, Run, Stop, answered_yes, lacks_repos
from bootstrap.update import component_states

NO_TERMINAL = "no answer on stdin; name the components on the command line instead"
NO_CURSES = "the menu needs a terminal curses can drive; check TERM, or name the components on the command line"
NEEDS_REPOS = "needs --repo"
NO_DESCRIPTION = "no description found"
KEYS = "Up/Down move  Space tick  a all  Right/? describe  Enter install  q quit"
ESCAPE = 27
ENTER = (curses.KEY_ENTER, ord("\n"), ord("\r"))
# How long curses waits after Escape for the rest of a key's sequence; its default is a second.
ESCAPE_DELAY_MS = 25
# A Markdown line that starts a block of its own: a list item, a heading or a table row.
BLOCK_START = re.compile(r"\s*([-*+] |\d+[.)] |#|\|)")
LIST_ITEM = re.compile(r"\s*([-*+]|\d+[.)]) ")


@dataclass(frozen=True)
class Row:
    component: Component
    # A mark from component_states, NEEDS_REPOS, or "" when the survey did not find the component.
    mark: str
    pickable: bool


@dataclass
class MenuState:
    rows: list[Row]
    cursor: int = 0
    # Indexes into `rows`.
    ticked: set[int] = field(default_factory=set)
    # The first row on screen.
    top: int = 0

    def move(self, step: int) -> None:
        self.cursor = min(max(self.cursor + step, 0), len(self.rows) - 1)

    def toggle(self) -> None:
        if self.rows[self.cursor].pickable:
            self.ticked ^= {self.cursor}

    def toggle_all(self) -> None:
        pickable = {index for index, row in enumerate(self.rows) if row.pickable}
        self.ticked = set() if self.ticked == pickable else pickable

    def scroll(self, shown: int) -> None:
        """Moves `top` just far enough that the cursor's row is among the `shown` rows on screen."""
        if self.cursor < self.top:
            self.top = self.cursor
        elif self.cursor >= self.top + shown:
            self.top = self.cursor - shown + 1

    def picked(self) -> list[Component]:
        return [row.component for index, row in enumerate(self.rows) if index in self.ticked]


def choose(components: list[Component], run: Run) -> list[Component]:
    """The components ticked in the menu, in install order, once the user confirms them after it closes; [] when the
    user quits, ticks nothing or declines."""
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise Stop(NO_TERMINAL)
    try:
        curses.setupterm()
    except curses.error as error:
        raise Stop(NO_CURSES) from error
    states = component_states(run)
    rows = []
    for component in components:
        if lacks_repos(component, run):
            rows.append(Row(component, NEEDS_REPOS, pickable=False))
        else:
            rows.append(Row(component, states.get(component.name, ""), pickable=True))

    picked = curses.wrapper(run_menu, MenuState(rows))
    if not picked:
        return []
    names = ", ".join(component.name for component in picked)
    if not answered_yes(f"Install {names}? [y/N] ", NO_TERMINAL):
        return []
    return picked


def run_menu(screen: curses.window, state: MenuState) -> list[Component]:
    curses.set_escdelay(ESCAPE_DELAY_MS)
    while True:
        draw_list(screen, state)
        key = screen.getch()
        if key in (curses.KEY_UP, ord("k")):
            state.move(-1)
        elif key in (curses.KEY_DOWN, ord("j")):
            state.move(1)
        elif key == ord(" "):
            state.toggle()
        elif key == ord("a"):
            state.toggle_all()
        elif key in (curses.KEY_RIGHT, ord("?")):
            show_description(screen, state.rows[state.cursor].component)
        elif key in ENTER:
            return state.picked()
        elif key in (ord("q"), ESCAPE):
            return []


def put(screen: curses.window, line: int, text: str, attribute: int = curses.A_NORMAL) -> None:
    """Writes `text` on `line`, cut to leave the last column empty, since curses raises after writing the bottom-right
    cell."""
    width = screen.getmaxyx()[1]
    screen.addnstr(line, 0, text, max(width - 1, 0), attribute)


def draw_list(screen: curses.window, state: MenuState) -> None:
    """Draws, for example:

    [x] harness                     installed     install harness/ from HEAD as ~/.claude/har
    [ ] hooks-path                  needs --repo  set core.hooksPath to ~/.claude/harness/cur
    [ ] plugin:example-one          behind        first example
    1 ticked  Up/Down move  Space tick  a all  Right/? describe  Enter install  q quit
    """
    height = screen.getmaxyx()[0]
    # One line is the footer's.
    shown = max(height - 1, 1)
    state.scroll(shown)
    name_width = max(len(row.component.name) for row in state.rows)
    mark_width = max(len(row.mark) for row in state.rows)
    screen.erase()
    on_screen = state.rows[state.top : state.top + shown]
    for line, row in enumerate(on_screen):
        index = state.top + line
        box = "[x]" if index in state.ticked else "[ ]"
        text = f"{box} {row.component.name:<{name_width}}  {row.mark:<{mark_width}}  {row.component.summary}"
        attribute = curses.A_REVERSE if index == state.cursor else curses.A_NORMAL
        put(screen, line, text, attribute)
    put(screen, height - 1, f"{len(state.ticked)} ticked  {KEYS}")
    # The terminal's own cursor sits on the highlighted row's tick box, where a screen reader follows it.
    screen.move(state.cursor - state.top, 1)
    screen.refresh()


def continues(previous: str, line: str) -> bool:
    """Whether `line` carries on the paragraph or list item of `previous` in Markdown hard-wrapped to some width."""
    if not previous.strip() or not line.strip():
        return False
    # A heading or a table row is one line, whatever follows it.
    if previous.lstrip().startswith(("#", "|")):
        return False
    return BLOCK_START.match(line) is None


def unwrapped(text: str) -> list[str]:
    """The lines of Markdown `text`, each paragraph and list item joined onto one line."""
    lines: list[str] = []
    for line in text.splitlines():
        if lines and continues(lines[-1], line):
            lines[-1] = f"{lines[-1]} {line.strip()}"
        else:
            lines.append(line)
    return lines


def wrapped(line: str, width: int) -> list[str]:
    """`line` wrapped to `width`, its continuation lines indented under its text, past any Markdown list marker."""
    if not line.strip():
        return [""]
    item = LIST_ITEM.match(line)
    indent = item.end() if item else len(line) - len(line.lstrip())
    return textwrap.wrap(line, width, subsequent_indent=" " * indent)


def show_description(screen: curses.window, component: Component) -> None:
    """Shows the component's name, summary and full description until a key other than a scrolling one is pressed."""
    try:
        description = component.description()
    except (Stop, OSError):
        description = ""
    top = 0
    while True:
        height, width = screen.getmaxyx()
        text_width = max(width - 1, 1)
        lines = [component.name, *wrapped(component.summary, text_width), ""]
        for line in unwrapped(description or NO_DESCRIPTION):
            lines.extend(wrapped(line, text_width))
        top = min(top, max(len(lines) - height, 0))
        screen.erase()
        for line, text in enumerate(lines[top : top + height]):
            put(screen, line, text)
        screen.move(0, 0)
        screen.refresh()

        key = screen.getch()
        if key == curses.KEY_UP:
            top = max(top - 1, 0)
        elif key == curses.KEY_DOWN:
            top += 1
        elif key == curses.KEY_PPAGE:
            top = max(top - height, 0)
        elif key == curses.KEY_NPAGE:
            top += height
        elif key != curses.KEY_RESIZE:
            return
