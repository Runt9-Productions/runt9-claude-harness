---
name: comment-style
description: How to write code comments, docstrings and doc comments. A comment goes only where a reader could get the code wrong, is as long as the surprise and no longer, and says what breaks if the code changes rather than how it came to be. Ends with a per-comment sweep. Use it before writing or editing any comment, before handing code over, and whenever someone says "sweep the comments", "check these comments", "is this comment needed", "tighten the docstrings" or "review the comments on this diff". Use it even when the task is about code and the comments are incidental, since that is when noise comments get written.
allowed-tools: Read(~/.claude/local/comment-style/**)
---

# Comment style

Read this before writing any comment, and again before handing code over.

## The one test

**Write a comment where a reader could get it wrong, and nowhere else.**

Not "is this documented". Not "did this take effort to work out". The question is always: *would someone
reading this be surprised by something, and is that thing written down?* If no, leave it off. The name, the
types and the call already said it.

A comment that restates the code is not neutral. It lengthens the file, buries the comments that matter, and
teaches the next reader to skip all of them.

## Length tracks surprise, not effort

Three lines explaining something that behaves exactly as it reads is noise even when every sentence is true.

The effort spent discovering something is not a reason to narrate it. You just worked it out, so it feels
significant. It is not significant to someone arriving cold at code that now looks ordinary. Write the one
clause that stops them breaking it and drop the rest.

Prefer one line to a paragraph. A comment longer than the code it describes needs a specific justification.

## Explain the future, not the history

A useful comment tells the next reader **what breaks if they change this**.

"Before this was fixed, X happened" is the tell. Rewrite it as "if you change this, Y breaks", and if that
sentence turns out to be obvious, delete it.

History earns a comment only when the code's *shape* is surprising because of it: a guard that looks redundant,
an ordering that looks arbitrary, a workaround that looks like a mistake. A `try`/`catch` stopping a loop dying
is what anyone competent would write anyway; that it was missing for years is a fact about the author, not the
code.

Design justification is also history. "We chose X over Y because Z" is aimed at a reviewer, not at a future
editor, so it goes in a comment on the pull request, not in the code.

## What earns a comment

- A contract the signature does not imply
- An argument that gets mutated
- A null or empty return that *means* something
- An exception the caller has to handle
- Ordering that is load-bearing
- A reason to prefer one overload over another
- A declaration that silently stops working if "simplified" the obvious way
- A gotcha that cost someone an hour

## Prefer naming over commenting

If a comment explains what a function does, the function is misnamed. Rename it and delete the comment. A
private helper called `run` needing a line to say it stops at the first consumer should be called
`runUntilConsumed`.

## Point at symbols, never at line numbers

A comment that refers to other code names the symbol: `OrderService.submit`, `Invoice.total`. Never a line
number, bare (`OrderService.kt:282`) or beside the symbol. Line numbers drift with every edit to the cited file,
nothing flags the drift, and a stale number points confidently at the wrong line. A symbol survives edits around
it, and an editor finds it in one step.

This is a rule for code and test comments, which nothing checks for drift. A document with its own staleness
check may cite lines.

## Never cite an untracked path

Code, tests and durable docs never point at a gitignored or scratch file. The reader who follows the pointer on
another machine, or after the file is gone, finds nothing, and the comment reads as authoritative until then.
Carry the fact itself, or cite something tracked.

## A library's comments never name its consumers

A comment in a library or framework names no application that uses it, and takes its examples from the library's
own domain. A comment that names a consumer is wrong once a second one exists. A fact that can only be explained
through one consumer is usage, and belongs in that consumer's code.

## Voice

Comments are prose, held to the same rules as any other writing:

- Say it once. Do not preview, state, then recap.
- No dash constructions, whatever the glyph (`—`, `--`, `–`, a spaced hyphen). Use a comma, a colon,
  parentheses, or a new sentence. A clause spliced in with a dash is usually a second thought the sentence was
  not built to hold.
- No hedging, no throat-clearing, no narrating what you are about to explain.
- Plain assertions over qualified ones. "This must run first" beats "it's worth noting that this should probably
  run first".

## Worked examples

**Restates the signature.**

```
// Bad
// Returns the user's ID.
fun userId(): String

// Good
// (nothing)
fun userId(): String
```

**Verbose, and the surprise is buried.**

```
// Bad
// This method retries the operation. It will attempt the operation up to maxAttempts times. Between each
// attempt it waits, and the wait grows each time so as not to overwhelm the downstream service. If all
// attempts fail then the last exception encountered is thrown to the caller so they can handle it.
fun retry(maxAttempts: Int, op: () -> T): T

// Good
// Throws the LAST failure, not the first. Callers matching on exception type get the final attempt's.
fun retry(maxAttempts: Int, op: () -> T): T
```

**Irrelevant history.**

```
// Bad
// We used to sort this list before returning it, but that turned out to be slow on large inputs so it was
// removed in the 3.2 refactor after profiling showed it dominating the call.
fun activeUsers(): List<User>

// Good
// Unordered. Sort at the call site if you need it; a caller that assumes an order breaks silently.
fun activeUsers(): List<User>
```

**Hard to understand, because it explains the mechanism instead of the consequence.**

```
// Bad
// The cache uses a weak reference map keyed on the session object, which the GC may collect between the
// containsKey check and the get call depending on collection timing and heap pressure.
fun cached(session: Session): Result?

// Good
// May return null immediately after containsKey said true: entries are weakly held and can vanish between
// the two calls. Use getOrNull, never check-then-get.
fun cached(session: Session): Result?
```

**Design justification aimed at a reviewer.**

```
// Bad
// We considered putting this on the controller instead, but that would duplicate the declaration and force
// every consumer to name the action twice, so it lives here.
val registrations: List<Registration>

// Good
// Order is precedence: of two entries matching one input, the earlier wins.
val registrations: List<Registration>
```

## The sweep

Do this as a distinct pass, after the code is written and before handing it over. Not a vague "check your
comments", but a per-comment test:

1. Read every comment you added or changed, one at a time.
2. For each, **name the reader who would get it wrong without it, and what they would do wrong.**
3. If you cannot name one, delete the comment.
4. If you can, check it is the shortest phrasing that still prevents that mistake.

Step 2 is the whole thing. History comments fail it immediately: there is no such reader, only a reviewer
being told a story.

## Local additions

Rules added on this machine, such as a language's doc-comment syntax or one project's conventions. Where one
conflicts with a rule above, the addition wins.

!`cat ~/.claude/local/comment-style/additions.md 2>/dev/null || echo "(none)"`
