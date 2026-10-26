---
name: kotlin-style
description: What the code-style principles mean in Kotlin, plus the rules only Kotlin needs: one guard per line and early returns, expression bodies, standard-library idioms and scope functions, extension functions, integer division, failing fast with first, getValue and error(), and KDoc syntax. Use it before writing, changing or reviewing any Kotlin file or test, and whenever someone says "write this in Kotlin", "add a test", "fix this Kotlin", "review this .kt", "clean up this class" or "write the KDoc". Load code-style beside it and comment-style for comments.
allowed-tools: Read(~/.claude/local/kotlin-style/**)
---

# Kotlin style

What the code-style skill's principles mean in Kotlin, plus the rules only Kotlin needs. Load both before
writing Kotlin, and again before handing it over. A repository's own style guide adds its layout, tooling and
architecture, and wins where the two differ.

---

## One thing per line, in Kotlin

Principle 8 applied. Guards go one per line and return early; inside a lambda, each is a `return@label` line.

```kotlin
// Avoid: three conditions and a query in one expression body
fun shouldNotify(order: Order) = order.isPaid && !order.isArchived && customers.getValue(order.customerId).wantsEmail

// Prefer
fun shouldNotify(order: Order): Boolean {
    if (!order.isPaid) return false
    if (order.isArchived) return false
    val customer = customers.getValue(order.customerId)
    return customer.wantsEmail
}
```

Helpers widen as usage widens (principle 10): a local `fun` or local extension, then a private member, then
file-level, then a themed shared file once more than one place uses it.

## Expression bodies only for genuine one-liners

Use `=` bodies for pure delegation, property getters, a single call taking a trailing lambda, and an `if`/`when`
that returns a value. Anything with more than one statement or a branch gets a block body.

## Idiomatic Kotlin is welcome

Use the standard library as intended: `map`, `fold`, `zip`, `buildList`, `groupBy`, the scope functions
(`apply`, `also`, `let`, `run`, `with`), extension functions and properties. Building a list imperatively where
one of these fits is not a style to copy. Choose the idiom that reads most plainly for the case, and keep
principle 8: an idiom that packs three steps into one line still breaks it.

- Extension properties and functions over free functions: `order.total`, not `totalOf(order)`.
- `Unit`, not `Nothing`, for a function that returns normally with no value.
- No explicit type arguments the compiler infers (`listOf<Foo>()` where the type is obvious).
- An exhaustive `when` whose branches all just `error()` collapses into `else`.
- Non-null types by default; nullability only where absence means something.
- Tunable numbers get a named `val` (principle 7).

## Never divide two integers

Principle 14 in Kotlin: `Int / Int` truncates silently. Divide as `Double` and round explicitly:
`ceil(itemCount / pageSize.toDouble()).toInt()`, or `roundToInt()` when the rule rounds to nearest. The same
holds for `%` used to round, and for integer division hidden in a helper.

## Fail fast, in Kotlin

Principle 16 in Kotlin: `first`, `getValue` and `error()` over `firstOrNull`, `getOrDefault` and a quiet
fallback, wherever absence is a defect rather than a case.

## KDoc

KDoc is valuable where a caller could get something wrong, and not required elsewhere (the comment-style skill
decides which). Editors show it on hover, so a fact scoped to one declaration belongs in its KDoc rather than in a
separate document, where it cannot drift from the code.

KDoc is markdown. Javadoc syntax is not an error; it renders literally as visible noise, the same silent failure
as opening with `/*` instead of `/**`.

| Use | Not |
|---|---|
| `[Type]` and `[Type.member]` | `{@link Type}` |
| backticks | `{@code x}` |
| a blank line | `<p>` |
| `@param` / `@return` / `@throws` | the HTML-wrapped forms |

Still true from javadoc: open with `/**`, never `/*`. Summary sentence, blank line, then a **contiguous** tag block
with no blank lines between tags.

## Local additions

Kotlin rules added on this machine. Where one conflicts with a rule above, the addition wins.

!`cat ~/.claude/local/kotlin-style/additions.md 2>/dev/null || echo "(none)"`
