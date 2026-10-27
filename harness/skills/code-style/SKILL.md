---
name: code-style
description: How to write and judge code whatever the language, covering where logic lives, naming, density, failure handling, rounding, tests and what to delete. Use it before writing or changing code in any language, when reviewing a diff, and whenever someone asks to "check this against the style guide", "review my code", "clean this up", "is this the right approach" or "refactor this". The python-style, kotlin-style and typescript-style skills build on it and load together with it.
allowed-tools: Read(~/.claude/local/code-style/**)
---

# Code style

These principles apply to code in any language. A language skill (python-style, kotlin-style, typescript-style)
narrows them for that language and loads alongside this one. Where a repository has a style guide of its own, that guide
decides any conflict, and a project with settled habits of its own keeps them.

Read the principles for what they protect, not as a checklist. The bullets are samples: a violation they never
mention is a violation all the same.

## Scope of a change

- When changing existing code is the right fix, the change is part of the task. That overrides the usual reluctance to
  refactor beyond what was asked.
- Cleanup unrelated to the change is offered to the user as a separate suggestion, not slipped into the diff.
- Existing code that breaks a rule is debt to pay down, not a precedent to copy.

Everything below holds for build scripts and pipeline definitions too.

## Principles

Language skills refer to these by number.

### 1. Change what exists before building beside it

A parallel type, an adapter, a wrapper or a side channel looks safe because it touches nothing, but it doubles what
has to be maintained and leaves two shapes to keep in step. Before adding a type, file or layer, weigh what changing
the existing code would cost, then say which you chose and why.

Avoid: adding `InvoiceView` that copies six fields from `Invoice` so a report can show a due date.
Prefer: adding the due date to `Invoice` and having the report read it.

### 2. Nothing stays without a job

Dead parameters, calls that do nothing, wrappers that only forward, and extension points nobody extends all go.
Removing code is the largest maintainability gain available. Safeguards against failures that have never happened are
cost too. Security checks are the exception: a breach rarely announces itself, so waiting to see one is too late.

Before deleting, find out what the code protects: read its callers and its history. Something that looks dead may
guard a case the tests never reach.

### 3. Production code is never shaped for tests

If only a test wants a constructor, a setter or a visibility change, change the test instead.

### 4. One home for each piece of logic

Every caller goes through the same implementation, because copies drift apart. A small pattern repeated across files
becomes a shared function. Build the abstraction early when a shape repeats or is plainly general, and pull general
tools out of one project's code early so others can use them. Configuration nobody sets is still dead weight (rule 2).

### 5. Units register themselves

When a system has many interchangeable units (payment methods, export formats, report types), give each one the
means to announce itself, keep the announced ones in a single lookup, and have callers ask that lookup. A new unit is
then one new file and no edits elsewhere.

Discovery by the framework or a build step is best; readable reflection is acceptable; a list maintained by hand is
the last resort. Avoid a branch per unit (`if format == "csv" ... elif format == "pdf"`) and callers that name
units directly.

### 6. Shape APIs and configuration for their real consumer

Anything loaded from a file is plain, serialisable data, not objects with behaviour. When the cases are known, model
them as concrete types rather than one generic bag of optional settings.

### 7. Name repeated and meaningful values

- Give a literal a name as soon as a second site needs it; two copies of `30` or `"pending"` drift apart.
- Tunables (retry counts, page sizes, timeouts) are named constants.
- When the possible values are fixed and known, make them an enum: a misspelled member fails to compile or load,
  where a misspelled string just never matches.
- A bare number or boolean whose meaning is invisible at the call site gets a named type or a named function.

Avoid: `ship(order, true, 3)`.
Prefer: `ship(order, Priority.EXPRESS, maxAttempts = 3)` or `shipExpress(order)`.

### 8. One action per line

A long line is fine; a dense one is not.

- A condition has at most two boolean terms. More than that becomes a named variable or function.
- Guards go one per line, each returning early.
- No call nested inside another call on the same line. Chain the calls or name the intermediate value.
- Wrap at 160 columns unless a configured formatter decides.

Avoid: `send(render(load(path), template), recipient)`.
Prefer: load the order into a named value, render it into another, then send that.

### 9. Functions are short and focused by default

Logic that is genuinely coupled may run longer, laid out in named phases (validate, compute, persist). Length alone
is no reason to pull out a helper; reuse or generality is.

### 10. Helpers live next to their use

A helper starts as close to its caller as the language allows and widens its scope only as its callers widen: local,
then file, then a shared file grouped by theme.

### 11. A file is built around one main piece

Small satellites may share the file: the unit's own enum, private support types, or a family of tiny declarations that
belong together. Split a file that stacks unrelated units, and give a package that keeps growing subpackages.

### 12. Generated text shows its result

Code that assembles human-readable text (an email body, a report, a help message) carries a comment with a sample of
the finished output, builds it from named parts, and keeps a paragraph of prose in one multiline literal instead of
gluing pieces together.

### 13. Names carry the domain meaning

- Name by domain meaning, not by mechanism: `overdueInvoices`, not `filteredList`.
- No single-letter names.
- Rename when a name stops being true.
- Plain words over jargon.
- A pattern's role appears in the type name (`InvoiceRepository`, `ExportRegistry`).
- Never reuse an existing domain term for something new; two meanings for one word guarantees confusion.

### 14. Rounding is explicit

Get the exact quotient first and apply the rounding rule by name (floor, ceiling, half up). If an operator rounds for
you, nobody reading the line can tell whether that rule was chosen or an accident. Each language skill lists how its own operators behave.

### 15. Tests check intended behaviour

- Write tests from the use case, not by reading the implementation, which only bakes its bugs into the assertions.
  When the code and the intended behaviour disagree, fix the code or ask.
- Fixtures go through the real lifecycle (create, load, save) rather than being assembled by hand in a state the system
  could never produce. If the real path is awkward to exercise from a test, report that awkwardness; it says something
  about the design.
- No test-only code in production (rule 3).
- Do not test what the language or a library already guarantees.
- Add tests as the work proceeds. Test-first is welcome as long as an early test is rewritten when the design shifts,
  rather than holding it in place.

### 16. Bad input fails at once

Fail immediately and loudly, naming the offending value, never with a silent default, so a defect surfaces where it
starts instead of three calls later. Wherever absence is a bug, use the lookup that throws over the one that falls
back.

Avoid: `rate = rates.get(currency, 1.0)` when every supported currency must have a rate.
Prefer: the throwing lookup, with an error that names the currency.

### 17. No new TODOs and no commented-out code

A TODO becomes an issue in the tracker; commented-out code is already in version control. A review raises every
new one; keeping it is the author's argument to make.

### 18. Log what a debugger needs

No logging of routine steps ("starting export", "export done"). Log the facts someone diagnosing a failure would need:
the input that was rejected, the state that was unexpected.

### 19. Comments follow comment-style

Doc comments are worth writing where a caller could misuse something and optional elsewhere. The comment-style skill
decides the rest.

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/code-style/additions.md 2>/dev/null || echo "(none)"`
