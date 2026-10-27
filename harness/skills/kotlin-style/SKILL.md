---
name: kotlin-style
description: Kotlin rules for writing and reviewing Kotlin code, covering guard density, expression bodies, standard library idioms, integer division, fail-fast lookups and KDoc. Use it whenever writing, editing or reviewing a .kt or .kts file, including Gradle Kotlin build scripts, and when someone asks to "write this in Kotlin", "review this Kotlin", "make this idiomatic Kotlin" or "add KDoc". Loads together with code-style, which it applies to Kotlin.
allowed-tools: Read(~/.claude/local/kotlin-style/**)
---

# Kotlin style

This skill applies code-style to Kotlin. Both load together; principle numbers below refer to code-style. A
repository's own style guide wins wherever it differs.

## Density

Principle 8, in Kotlin terms: guards go one per line, each returning early. Inside a lambda, return early with
`return@label`.

Avoid:

```kotlin
fun refund(order: Order): Refund? {
    if (order.status == Status.PAID && order.lines.isNotEmpty() && !order.locked) {
        return Refund(order.id, order.lines.sumOf { it.price * it.quantity })
    }
    return null
}
```

Prefer:

```kotlin
fun refund(order: Order): Refund? {
    if (order.status != Status.PAID) return null
    if (order.lines.isEmpty()) return null
    if (order.locked) return null

    val amount = order.lines.sumOf { it.price * it.quantity }
    return Refund(order.id, amount)
}
```

Principle 10, in Kotlin terms: a helper starts as a local function or a private extension, then becomes a private
member, then moves to file level, then to a shared file, widening only as its callers do.

## Expression bodies

Use `=` only for a true one-liner:

- delegation to another function
- a getter
- a single call with a trailing lambda
- an `if` or `when` that produces a value

Anything else gets a block body.

## Standard library idioms

- Use collection operations, builders (`buildList`, `buildMap`, `buildString`), scope functions and extensions rather
  than building lists by hand. Pick whichever reads plainest, and keep one step per line in a chain.
- Prefer an extension to a free function that takes the receiver as its first argument.
- Return `Unit` for functions that produce no value.
- Omit type arguments the compiler can infer.
- Types are non-null by default. A nullable type needs a reason.
- Tunables are named `val`s (principle 7).
- In an exhaustive `when`, fold the branches that only throw into one `else`:

```kotlin
val rate = when (currency) {
    Currency.EUR -> euroRate
    Currency.USD -> dollarRate
    else -> error("No exchange rate for $currency")
}
```

## Integer division

Principle 14, in Kotlin terms: `/` and `%` on integers truncate toward zero without warning, so `7 / 2` is `3` and
`-7 / 2` is `-3`. Convert to `Double`, divide, then round explicitly with `ceil`, `floor` or `roundToInt`. That applies
inside helpers too, where the truncation is easiest to miss.

```kotlin
val exactPages = itemCount.toDouble() / pageSize
val pages = ceil(exactPages).toInt()
```

## Fail fast

Principle 16, in Kotlin terms: wherever absence is a bug, use the throwing form (`first`, `single`, `getValue`,
`error()`, `requireNotNull`) over the defaulting one (`firstOrNull`, `getOrDefault`, `?: fallback`).

## KDoc

- Write KDoc where a caller could go wrong; comment-style decides where that is.
- KDoc is markdown. Link with brackets (`[Invoice.total]`), mark code with backticks, and separate paragraphs with a
  blank line. Use plain `@param`, `@return` and `@throws`. Javadoc tags such as `{@link}` and HTML such as `<p>` show up
  as literal noise.
- Open with `/**`. Write the summary, a blank line, then the tags with no blank lines between them.
- A fact about one declaration belongs in its KDoc, beside the code, not in a separate document that drifts from it.

```kotlin
/**
 * Splits [order] into one shipment per warehouse.
 *
 * @param order must already be paid.
 * @return shipments in the order their warehouses appear in [Order.lines].
 * @throws IllegalStateException if a line names a warehouse that no longer exists.
 */
```

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/kotlin-style/additions.md 2>/dev/null || echo "(none)"`
