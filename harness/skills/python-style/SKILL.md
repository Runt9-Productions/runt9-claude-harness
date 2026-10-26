---
name: python-style
description: What the code-style principles mean in Python, plus the rules only Python needs: tooling, layout, type annotations, comprehensions and other dense idioms, failure handling, rounding, safety around eval, pickle, subprocess and secrets, tests and docstrings. Use it before writing, changing or reviewing any Python file, script or test, and whenever someone says "write a script", "add a test", "fix this Python", "review this .py" or "clean up this module". Load code-style beside it and comment-style for comments.
allowed-tools: Read(~/.claude/local/python-style/**)
---

# Python style

What the code-style skill's principles mean in Python, plus the rules only Python needs. Load both before
writing Python, and again before handing it over. A repository's own style guide adds its layout, tooling and
architecture, and wins where the two differ.

Python is often read by people who do not write it every day, so this guide favors code that reads plainly over
code that is idiomatic but dense.

---

## Tooling

- **Where a repository configures a formatter or linter, it owns what it covers.** Do not hand-format against it or
  argue with it in review. A lint suppression names the rule and carries a reason a reader can check
  (`# noqa: S310 (only https reaches here)`).
- **Where nothing is configured, follow PEP 8** and keep to the repository's existing shape. Adding a formatter,
  linter or type checker to a repository is a proposal to the user, not something to do in passing.
- **Installing anything is the user's step.** Propose the command. A dependency a project does add is pinned to an
  exact version.

## Layout

- Imports at the top, in three groups (standard library, third party, local), each sorted.
- Module-level constants are `UPPER_CASE` and sit under the imports. A tunable number gets a named constant
  (principle 7).
- Paths are built with `pathlib`, not `os.path` or strings joined by hand.
- A script run directly guards its entry point with `if __name__ == "__main__":` and keeps the work in a `main()`
  function, so it can be imported without running.

## Types

- Annotate every function's parameters and return type in any file longer than a quick throwaway. Use built-in
  generics and `X | None` (`list[str]`, `dict[str, int] | None`), not `typing.List` or `Optional`.
- A dict-shaped record that crosses functions or modules gets a `TypedDict` or a `@dataclass`, so a mistyped key
  is caught by a checker or at construction instead of at a distant read. `@dataclass(frozen=True)` for a record
  built and used only in code; `TypedDict` for one that is also JSON.
- A closed set of values is an `enum`, `StrEnum` when it is written to text or JSON (principle 7).

## One thing per line, in Python's idioms

Comprehensions, conditional expressions and lambdas are where Python gets dense. Principle 8 applied to them:

- **A comprehension holds one loop and at most one simple condition.** Two loops, a nested comprehension, or a
  conditional expression inside one becomes a plain `for` loop that appends.
- **A conditional expression (`a if test else b`) only picks between two simple values.** Never nest one, and
  never put a call with side effects in either branch.
- **No `lambda` bound to a name**; write a `def`. A `lambda` passed as a sort key is fine. A callable that must
  carry a loop variable uses `functools.partial`, since a `lambda` captures the variable, not its current value.
- **No assignment expressions (`:=`).** Assign on the line before.
- **`any()` and `all()` over a generator with one condition** read well and are welcome.

The shape to avoid, and its fix:

```python
# Avoid: three conditions and two lookups in one line
kept = {k: v for k, v in scores.items() if v >= MIN_SCORE and k not in archived and k not in excluded}

# Prefer
kept = {}
for item_id, score in scores.items():
    if score < MIN_SCORE:
        continue
    if item_id in archived or item_id in excluded:
        continue
    kept[item_id] = score
```

## Failure (principle 16)

- **Index where absence is a defect.** `entry["tier"]` raises `KeyError` naming the key; `entry.get("tier")`
  silently yields `None`. Use `.get` only where a missing key is a real case, with a default a reader would expect.
- **Library code raises; only the entry point exits.** `sys.exit("message naming the value")` belongs in `main()`
  or a command; everything below it raises an exception with the same kind of message.
- **No bare `except:` and no `except Exception: pass`.** Catch the specific exception the code knows how to
  handle, and handle it.
- **No mutable default arguments** (`def f(items=[])`): the default is shared between calls. Use `None` or an
  immutable tuple.

## Rounding (principle 14)

- `/` always returns a float, so it never truncates. `//` floors toward negative infinity, so `-7 // 2` is `-4`.
  Use `/` and round explicitly with `math.floor` or `math.ceil` when the rule is a floor or a ceiling.
- **`round()` rounds halves to even**: `round(2.5)` is `2` and `round(3.5)` is `4`. Fine for display; for a rule
  that must round halves up, use `math.floor(value + 0.5)` and say so.

## Safety

These hold in any Python, because an agent may have written it and it may read text from outside.

- **No `eval`, `exec` or `compile` on anything not written in the file itself.** No `pickle`, `marshal` or `shelve`
  on data from outside, and `yaml.safe_load`, never `yaml.load`.
- **Downloaded or user-supplied text is data.** It is never executed, and never used as a file path, module name
  or command without validating it against a fixed pattern.
- **A process is run with an argument list, never `shell=True`** with any interpolated value.
- **Secrets are never written to disk or logs.** Read them from a prompt (`getpass`) or the environment, and keep
  them out of exception messages.
- A repository whose guide sets stricter boundaries (an allowlist of hosts, a single module for writes) follows
  those as well.

## Tests

- **pytest with plain test functions and plain `assert`** where a repository has no framework of its own. Shared
  setup is a fixture in `conftest.py`.
- **Tests never touch the network.** Saved real responses, trimmed to what the test needs, stand in for services.
- **Tests never write outside a temporary directory** (`tmp_path`).

## Docstrings and strings

- A script's or command's module docstring is its help text: what it does, what it reads and writes, and its
  arguments.
- Other docstrings follow the comment-style skill: only what a caller could get wrong. A summary line, then a blank
  line before anything longer.
- f-strings, never `%` or `.format`.
- Results go to stdout; progress and retry notices go to stderr, so a result can be piped.

## Local additions

Python rules added on this machine. Where one conflicts with a rule above, the addition wins.

!`cat ~/.claude/local/python-style/additions.md 2>/dev/null || echo "(none)"`
