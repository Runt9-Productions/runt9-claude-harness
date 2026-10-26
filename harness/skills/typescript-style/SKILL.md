---
name: typescript-style
description: What the code-style principles mean in TypeScript, plus the rules only TypeScript needs: the type checker and linter, types (no any, unknown at the edges, string-literal unions for closed sets, readonly inputs), undefined and the non-null assertion, promises that are always awaited or handled, chained array methods and ternaries, failure, number rounding, safety around eval and child processes, and tests. Use it before writing, changing or reviewing any TypeScript file or test, including Claude Code mods, and whenever someone says "write this in TypeScript", "add a test", "fix this mod", "review this .ts" or "clean up this module". Load code-style beside it and comment-style for comments.
allowed-tools: Read(~/.claude/local/typescript-style/**)
---

# TypeScript style

What the code-style skill's principles mean in TypeScript, plus the rules only TypeScript needs. Load both before
writing TypeScript, and again before handing it over. A repository's own style guide adds its layout, tooling and
architecture, and wins where the two differ.

---

## Tooling

- **Where a repository configures a type checker, linter or formatter, it owns what it covers.** Code is done when
  `tsc` reports nothing and the linter passes; do not hand-format against a configured formatter. A suppression
  names the one rule it turns off, on the one line it applies to, with a comment giving a reason a reader can check.
- **Where no formatter is configured, match the existing files** (quotes, semicolons, indentation) rather than
  introducing a style. Adding a tool is a proposal to the user.
- **Installing anything is the user's step.** A dependency a project adds is pinned to an exact version.

## Types

- **`strict` is assumed.** Write code that passes it; never loosen a compiler option to make an error go away.
- **No `any`.** Text from outside (JSON, a tool's output, a caught error) arrives as `unknown` and is narrowed with a
  check before use, so a wrong shape fails where it enters instead of far downstream (principle 16).
- **A closed set of values is a union of string literals** (`'open' | 'closed'`), not a raw `string` and not an
  `enum`, which emits runtime code and is not supported where TypeScript is run by stripping types (principle 7).
- **Inputs a function does not change are `readonly`** (`readonly Item[]`, `Readonly<Options>`), so the signature says
  so and the checker enforces it.
- **`import type` for imports used only as types**, so nothing is loaded at run time for them.
- **Annotate exported functions' parameters and return types.** Inside a function, let inference work.

## Absence

- **Absent is `undefined`.** Use `null` only where an API you call or a format you write requires it.
- **Test absence explicitly** (`value === undefined`), never by truthiness, which also rejects `0`, `''` and `false`.
- **`??` for a default, never `||`**, for the same reason.
- **The non-null assertion `!` carries a comment naming the guarantee** that makes the value present. Without one,
  narrow with a check instead.

## Promises

- **Every promise is awaited, returned, or given a `.catch` that handles the failure.** A floating promise loses its
  error, and nothing reports it. Where the linter has `no-floating-promises` and `no-misused-promises`, they enforce
  this; elsewhere it is review's job.
- **No `async` callback where the caller does not await it** (`forEach`, an event handler expecting `void`): the
  caller drops the promise. Use a `for...of` loop with `await`, or `Promise.all` over a `map`.
- **A `catch` binds `unknown`** (`catch (error: unknown)`) and either handles a case it knows or rethrows.

## One thing per line, in TypeScript's idioms

Chained array methods, ternaries and inline arrow functions are where TypeScript gets dense. Principle 8 applied:

- **One array method per line in a chain**, each callback holding one simple condition. A callback with two or more
  terms gets a named predicate.
- **A ternary only picks between two simple values.** Never nest one, and never put a call with side effects in a
  branch.
- **Top-level functions are `function` declarations**, so they read as definitions and hoist. Arrow functions are for
  callbacks and small local helpers.
- **No assignment inside a condition or an expression.** Assign on the line before.

```ts
// Avoid: three terms and a lookup in one callback
const due = orders.filter(order => order.isPaid && !order.isArchived && customers.get(order.customerId)?.wantsEmail)

// Prefer
function wantsNotice(order: Order): boolean {
  if (!order.isPaid) return false
  if (order.isArchived) return false
  return customers.get(order.customerId)?.wantsEmail === true
}
const due = orders.filter(wantsNotice)
```

## Failure (principle 16)

- **Throw an `Error` whose message names the value**, never a string or a plain object.
- **No empty `catch`** and no `catch` that only logs and carries on, unless carrying on is the documented behaviour,
  with a comment saying so.
- **A lookup where absence is a defect fails there**: check the `Map.get` or `find` result and throw, rather than
  passing `undefined` on.

## Numbers and rounding (principle 14)

- Every `number` is a float, so `/` never truncates and integers above `Number.MAX_SAFE_INTEGER` lose precision; use
  `bigint` for those.
- **`Math.round` rounds halves toward positive infinity**: `Math.round(2.5)` is `3` and `Math.round(-2.5)` is `-2`.
  Use `Math.floor`, `Math.ceil` or `Math.trunc` when the rule is one of those, and say which.
- **No bitwise tricks for rounding** (`x | 0`, `~~x`): they truncate and wrap above 32 bits.
- **`toFixed` is for display only**: it rounds the binary value, so `(1.005).toFixed(2)` is `'1.00'`.

## Safety

These hold in any TypeScript, because an agent may have written it and it may read text from outside.

- **No `eval`, `new Function` or string `setTimeout`** on anything not written in the file itself.
- **A process is started with an argument list** (`execFile`, `spawn`), never `exec` or `shell: true` with any
  interpolated value.
- **Text from outside is data.** It is never executed, and never used as a path, module name or command without
  validating it against a fixed pattern.
- **Secrets are never written to disk or logs**, and stay out of error messages.

## Tests

- **Use the framework the repository runs**; a Claude Code mod is tested with the plugin kit (`*.test.ts` beside the
  module, run by `claude plugin test`).
- **A test drives the module the way its real caller does** (for a mod, through the engine events it registers on)
  and asserts what crosses back out.
- **Tests never touch the network and never write outside a temporary directory.**

## Strings

- Template literals for interpolation; never `+` concatenation of several parts.
- Prose and help text in one multiline template literal or an array of lines joined, not fragments added together.

## Local additions

TypeScript rules added on this machine. Where one conflicts with a rule above, the addition wins.

!`cat ~/.claude/local/typescript-style/additions.md 2>/dev/null || echo "(none)"`
