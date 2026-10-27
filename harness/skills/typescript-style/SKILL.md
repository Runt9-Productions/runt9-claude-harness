---
name: typescript-style
description: TypeScript rules for writing and reviewing TypeScript code, covering tooling, strict types, absent values, promise handling, chain density, failure handling, number precision, unsafe calls and tests, including Claude Code mods. Use it whenever writing, editing or reviewing a .ts or .tsx file, and when someone asks to "write this in TypeScript", "review this TypeScript", "fix the type errors", "write a mod" or "add tests for this module". Loads together with code-style, which it applies to TypeScript.
allowed-tools: Read(~/.claude/local/typescript-style/**)
---

# TypeScript style

This skill applies code-style to TypeScript. Both load together; principle numbers below refer to code-style. A
repository's own style guide wins wherever it differs.

## Tooling

- A configured type checker, linter and formatter each own their area. Work is done when `tsc` and the linter both
  pass clean.
- A suppression covers one rule on one line and gives a reason:

```ts
// The payment SDK declares this callback's argument as any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReceiptHandler = (receipt: any) => void;
```

- With no formatter configured, match the existing files.
- Adding a tool is a proposal to the user. Installing is the user's step, and versions are pinned exactly.

## Types

- Assume `strict` is on, and never relax a compiler option to make an error go away.
- No `any`. Data from outside the program (JSON, files, process input) enters as `unknown` and is narrowed at the
  boundary where it arrives.
- Model a fixed set of options as string literal types (`type Status = "draft" | "sent" | "paid"`). Avoid `enum`: it
  emits JavaScript of its own, and Node's type stripping rejects it.
- Inputs a function does not change are `readonly`.
- Type-only imports use `import type`.
- Annotate exported signatures; let inference handle the rest.

## Absence

- `undefined` is the absent value. Use `null` only where an external API or file format requires it.
- Compare to `undefined` explicitly. Truthiness treats `0` and `""` as absent too.
- Default with `??`, not `||`, for the same reason: `discount || 10` replaces a real discount of `0`.
- A non-null assertion (`!`) carries a comment naming what guarantees the value is present. Without such a guarantee,
  narrow instead.

## Promises

- Every promise is awaited, returned, or given a `catch` that handles the failure.
- No async callback where the caller ignores the returned promise, as with `forEach`. Use `for...of` with `await`, or
  `Promise.all` for work that can run in parallel.
- A `catch` binds `unknown` and either handles the error or rethrows it.
- Where the lint rules for floating and misused promises are configured, they enforce this.

## Density

Principle 8, in TypeScript terms:

- One array method per line in a chain. A callback with more than one term becomes a named predicate.
- A ternary only picks between two simple values.
- Top-level functions are `function` declarations. Arrow functions are for callbacks and small local helpers.
- No assignment inside an expression.

Avoid:

```ts
const due = invoices.filter((i) => i.status === "sent" && i.dueDate < today && !i.disputed).map((i) => i.total);
```

Prefer:

```ts
function isOverdue(invoice: Invoice): boolean {
  if (invoice.status !== "sent") return false;
  if (invoice.disputed) return false;
  return invoice.dueDate < today;
}

const overdueTotals = invoices
  .filter(isOverdue)
  .map((invoice) => invoice.total);
```

## Failure

Principle 16, in TypeScript terms:

- Throw `Error` objects whose message names the offending value: ``throw new Error(`unknown currency ${code}`)``.
- No empty `catch` and no `catch` that logs and carries on, unless a comment documents why that is correct.
- A failed lookup that can only mean a bug throws on the spot rather than returning `undefined` for someone else to
  trip over.

## Numbers

Principle 14, in TypeScript terms:

- Every number is a float. `/` never truncates: `7 / 2` is `3.5`.
- Integers are exact only up to `Number.MAX_SAFE_INTEGER`. Use `bigint` beyond it.
- `Math.round` rounds halves upward, toward positive infinity: `Math.round(2.5)` is `3` and `Math.round(-2.5)` is `-2`.
- Choose `Math.floor`, `Math.ceil` or `Math.trunc` explicitly for the rule you mean.
- No bitwise rounding (`value | 0`). It truncates and wraps at 32 bits: `2 ** 31 | 0` is `-2147483648`.
- `toFixed` is for display only. It rounds the binary value, not the decimal you see: `(1.005).toFixed(2)` is
  `"1.00"`.

## Safety

- No `eval`, `new Function` or string arguments to `setTimeout` and `setInterval` on outside text.
- Run processes with an argument list (`execFile`, `spawn`). Never pass a shell a string with values interpolated
  into it.
- Outside text is never run, or used as a path, module or command, until it has been validated.
- Secrets never reach disk, logs or error messages.

## Tests

- Use the repository's test framework.
- A Claude Code mod is tested with the plugin kit: a `*.test.ts` file beside the module, run by `claude plugin test`.
- Drive a module the way its real caller does (a mod through the events it registers) and assert on what comes out,
  not on its internals.
- No network access, and writes only inside temporary directories.

## Strings

- Template literals instead of `+` chains.
- Prose is one multiline template literal, or an array of lines joined with `"\n"`.

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/typescript-style/additions.md 2>/dev/null || echo "(none)"`
