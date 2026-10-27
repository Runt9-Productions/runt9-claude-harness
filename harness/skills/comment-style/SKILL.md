---
name: comment-style
description: Rules for when a code comment earns its place and how it should read, with worked bad and good examples and a sweep to run over every added or changed comment before handing work over. Use it whenever writing, editing or reviewing comments, docstrings, KDoc or JSDoc in any language, and when someone asks to "sweep the comments", "check these comments", "tighten the comments", "is this comment needed" or "add documentation to this function".
allowed-tools: Read(~/.claude/local/comment-style/**)
---

# Comment style

## The test

A comment belongs only where a reader would otherwise misunderstand the code. It is not documentation for its own
sake, and it is not a record of the effort that went into the code.

Echoing the code is not free. Every such line pads the file, hides the few lines worth reading, and teaches readers
that comments here can be skipped.

## Length

- Size a comment by how unexpected its fact is. The hours spent finding the fact do not count.
- Usually one clause is enough to prevent the mistake.
- Five lines of comment over two lines of code is a smell; it needs a fact that big.

## Consequences, not history

Tell the next editor the damage a change would do, not the road the code took to get here. A sentence like "this used to call
the tax service directly" is a signal: rewrite it as "calling the tax service here bypasses the rate cache", or delete
it if the consequence is obvious.

History is allowed only when the code would otherwise look like an error to a careful reader, such as a check that
appears to repeat another or two calls that appear safe to swap.

Design rationale aimed at reviewers ("I chose a map over a list because...") goes in a pull request comment, where the
reviewer reads it, not in the code, where every later reader pays for it.

## Worth writing down

- a precondition or guarantee the types cannot express
- a parameter the function changes in place
- an empty, `null` or sentinel result with a specific meaning
- a failure the caller must catch or check for
- steps whose order cannot be changed
- the reason this overload or variant, and not its near twin
- code that stops working if "tidied" the obvious way
- a trap that would take a newcomer a long debugging session to find

## A comment that explains a name

When the comment is the only place that says what a function does, the fix is a better name, after which the comment
can go.

Bad:

```python
# Returns invoices past their due date that have not been paid.
def get_invoices(account):
```

Good:

```python
def unpaid_overdue_invoices(account):
```

## Pointing at code and files

- Refer to code by symbol name, never by line number. Line numbers drift silently as the file changes, and the
  reference keeps looking correct. A document that checks its own references for staleness may cite lines.
- Never point at an untracked or scratch file from code, tests or a lasting document. On any other machine or checkout
  the file is gone, while the pointer still reads as authoritative. Inline the fact, or cite a tracked file.

## Libraries and frameworks

A library cannot know who will call it, so its comments mention no particular caller and illustrate with the
library's own concepts. Anything true for only one caller is documented where that caller lives.

## Voice

- State each thing once.
- No dash constructions of any kind (em dash, en dash, double hyphen, or a hyphen with spaces around it used to break
  a clause). Restructure instead: split the sentence, or join the parts with punctuation that is not a dash.
- No hedging and no preamble ("Note that", "It is worth mentioning"). Assert the fact directly.

## Worked examples

### Restating the signature

Bad:

```python
def apply_discount(order: Order, percent: float) -> Order:
    """Apply a discount to an order.

    Args:
        order: The order.
        percent: The discount percent.

    Returns:
        The order.
    """
```

Good:

```python
def apply_discount(order: Order, percent: float) -> Order:
    """Mutates and returns order; percent is 0 to 100, not 0 to 1."""
```

The signature already says what the arguments are. The two facts a caller could get wrong (the mutation and the scale
of `percent`) were missing.

### Burying the surprise

Bad:

```python
# Here we go through each line on the invoice and add up the amounts so that we can
# work out the total. We use Decimal for the amounts, and the currency is taken from
# the first line, which works because every line on an invoice shares a currency.
```

Good:

```python
# Currency comes from the first line; mixed-currency invoices are rejected upstream in parse_invoice.
```

The only surprise was where the currency comes from and what guarantees it is safe. It is now the whole comment.

### Irrelevant history

Bad:

```python
# Originally this read the config with a hand-written parser, which was replaced by
# tomllib after the parser mishandled quoted keys.
settings = tomllib.loads(text)
```

Good: no comment. The code is ordinary, and nothing about its shape needs explaining.

### Mechanism instead of consequence

Bad:

```python
# Sort by creation time before writing.
rows.sort(key=lambda row: row.created_at)
```

Good:

```python
# The importer replays rows in file order, so an unsorted file applies refunds before their payments.
rows.sort(key=lambda row: row.created_at)
```

The code already shows the sort. The comment now says what breaks without it.

### An argument meant for the pull request

Bad:

```python
# I went with a dict here instead of a list because lookups by order id happen on every
# request and the list version was slower in my testing.
orders_by_id = {order.id: order for order in orders}
```

Good: no comment in the code. If the choice needs defending, say it in the pull request.

## The sweep

Run this as its own pass over every comment you added or changed, before handing the work over. It is separate from
writing the code because a comment written alongside the code reads as necessary to its author.

For each comment:

1. Picture a specific future editor and the concrete mistake they would make if this comment were missing.
2. If you cannot picture both, remove the comment.
3. If you can, trim it until it says just enough to stop that mistake.

Step 1 decides everything. A comment that narrates the past fails it at once: no editor makes a mistake for want of
the story.

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/comment-style/additions.md 2>/dev/null || echo "(none)"`
