---
name: python-style
description: Python rules for writing and reviewing Python code, covering tooling, layout, type hints, comprehension density, failure handling, rounding, unsafe calls, pytest and docstrings. Use it whenever writing, editing or reviewing a .py file or a Python script, and when someone asks to "write a Python script", "review this Python", "make this more Pythonic", "add type hints" or "write pytest tests". Loads together with code-style, which it applies to Python.
allowed-tools: Read(~/.claude/local/python-style/**)
---

# Python style

This skill applies code-style to Python. Both load together; principle numbers below refer to code-style. A
repository's own style guide wins wherever it differs.

Scripts and hooks tend to be read by people whose main language is something else. Write for them: a plain loop they
follow at once is better than a clever one-liner they have to decode.

## Tooling

- When the repository configures a formatter or linter, its output is final. Leave its formatting alone, and fix
  what a rule flags instead of reshaping code to slip past it.
- A suppression names the rule and gives a reason someone can check: `# noqa: S603  (arguments are a fixed list)`.
- With nothing configured, follow PEP 8 and the shape of the existing files. Suggest a new tool; do not add one.
- Ask before installing anything. Pin every new dependency to one exact version.

## Layout

- Imports first: standard library, then third-party packages, then the project's own modules, alphabetical within each
  block.
- `UPPER_CASE` constants come next, before any function.
- Paths are `pathlib.Path`, not string joins.
- A script guards its entry point and puts the work in `main()`, so importing it runs nothing:

```python
def main() -> None:
    export_reports(Path("reports"))


if __name__ == "__main__":
    main()
```

## Types

- Annotate parameters and return types in anything beyond throwaway code. Use built-in generics (`list[str]`,
  `dict[str, int]`) and `X | None`.
- A record passed between functions is a `TypedDict` when it is also read from or written to JSON, and a frozen
  dataclass when it lives only in code. Either way a wrong key fails early instead of becoming a silent `KeyError`
  later.
- Values drawn from a fixed list are `Enum` members, `StrEnum` when they are written out as text (principle 7).

## Density

Principle 8, in Python terms:

- A comprehension has one `for` and at most one simple `if`. Anything more is a plain loop.
- `x if cond else y` is for picking a plain value, such as a label or a default. Nested ones, and ones whose branches
  call something that changes state, become an `if` statement.
- Give a function a name with `def`; `name = lambda ...` hides it from tracebacks. Inline lambdas (`key=lambda o:
  o.total`) are fine. Bind a loop variable into a callback with `functools.partial`.
- No walrus operator (`:=`).
- `any(o.overdue for o in orders)` style checks with one condition are encouraged.

Avoid:

```python
totals = {c.id: sum(l.amount for o in c.orders if o.paid for l in o.lines) for c in customers if c.active}
```

Prefer:

```python
totals = {}
for customer in customers:
    if not customer.active:
        continue
    paid_orders = [order for order in customer.orders if order.paid]
    order_totals = [order_total(order) for order in paid_orders]
    totals[customer.id] = sum(order_totals)
```

## Failure

Principle 16, in Python terms:

- Index with `[]` where a missing key is a bug. Use `.get()` with a sensible default only where absence is expected.
- Functions below `main()` raise; `main()` alone turns an exception into an exit code and a message.
- Catch a named exception class and do something about it. `except:` on its own, or a handler that ignores the
  error, hides bugs.
- No mutable default arguments (`def add(item, basket=[])`); default to `None` and create the value inside.

## Rounding

Principle 14, in Python terms:

- `/` always returns a float, even for `6 / 3`.
- `//` floors toward negative infinity, not toward zero: `-7 // 2` is `-4`.
- `round()` rounds halves to the nearest even number: `round(2.5)` is `2`, `round(3.5)` is `4`.
- Round with `math.floor` or `math.ceil`, or `math.floor(value + 0.5)` for half up, and say which rule you meant.

## Safety

- Text this program did not write itself never reaches `eval`, `exec` or `compile`.
- Deserialise outside data with a format that cannot run code (JSON, TOML), never `pickle`, `marshal` or `shelve`.
- YAML is read with `yaml.safe_load`, never `yaml.load`.
- Before input from outside becomes a filename, an import or part of a command, match it against an allowlist
  pattern; it is never executed.
- Subprocesses take a list of arguments. Never pass a shell a string with values interpolated into it.
- Secrets never reach disk, logs or exception messages. Read them with `getpass` or from the environment.
- A repository's stricter rules apply on top of these.

## Tests

- pytest functions with plain `assert`, unless the repository has its own framework.
- Shared setup goes in `conftest.py`.
- No network access. Use a trimmed recorded response instead.
- Tests write only under `tmp_path`.

## Strings and docstrings

- The docstring at the top of a script doubles as its `--help`: purpose, inputs, outputs and options. Pass it to
  `argparse` as the description.
- Other docstrings only where a caller could go wrong. One summary line, a blank line, then the detail.
- Format with f-strings. The exception is a `logging` call, which takes `%s` placeholders
  and its arguments separately (`log.info("loaded %s", path)`), so the message is only built when the level is on.
- Print the answer on stdout and everything else (progress, warnings) on stderr, so the answer pipes cleanly.

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/python-style/additions.md 2>/dev/null || echo "(none)"`
