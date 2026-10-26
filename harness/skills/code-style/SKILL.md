---
name: code-style
description: Language-neutral principles for writing and reviewing code: change the existing code instead of routing around it, make every piece earn its place, keep tests from shaping production code, one owner per piece of logic, one thing per line, fail fast, explicit rounding, domain names. Use it before writing, changing or reviewing code in any language, when planning a design, and whenever someone says "implement this", "refactor", "clean this up", "review this code", "is this the right shape", "simplify" or "fix this properly". Load the language's own skill beside it (python-style for Python, kotlin-style for Kotlin, typescript-style for TypeScript) and comment-style for comments.
allowed-tools: Read(~/.claude/local/code-style/**)
---

# Code style principles

How code should be written, whatever the language. A language skill adds what these mean in that language
(python-style for Python, kotlin-style for Kotlin, typescript-style for TypeScript). A repository's own style
guide, such as `.claude/code-style-guide.md`, adds its architecture and wins where the two differ. A codebase with
established conventions of its own follows those.

Read this before writing code, and again before handing it over. Reviewers check code against it.

**The principles govern; the text does not bound them.** Each rule states a principle and why it holds. Code
that breaks a principle in a way the text does not describe still breaks it, and a reviewer who finds such a case
raises it.

**These rules override Claude Code's built-in default against refactoring beyond the task.** When the right fix
is to change existing code, that change is part of the task, not scope creep. What stays out of scope is
unrelated cleanup: propose it rather than do it. Proposing means offering it for this change, not arguing to
defer it; a yes puts it in the same change.

Older code that breaks a rule here is debt, not precedent.

---

## Change the right thing

### 1. Change the existing code; do not route around it

The first design is usually the one that adds beside what exists: a mirror type, a wrapper, an adapter, a side
channel, a new file that avoids touching an old one. It feels safe because it changes nothing. It is almost
always the worse design, because two things now need maintaining and someone has to find and undo it in review.

Instance: a second record type written to mirror an existing one minus one field. A constructor parameter on the
existing type, set by the one caller that wanted less, does the same job with nothing new to keep in step.

**Check before adding a type, file, layer or mechanism:** what would changing the existing thing cost? Report
that split rather than quietly writing the addition.

### 2. Every piece of code has to earn its existence

Unused parameters, no-op calls, a function wrapping one call, a filter with no filters, a configurable hook
nothing configures: delete them. Removing code is the best thing a change can do for maintainability; not
writing it is the second best.

This covers safeguards too. A check against a problem nobody has observed (a client-side gate repeating the
server's, a second uncaught-exception handler, a test that only proves two hand-kept lists agree) is code that has
not earned its place, because it costs maintenance now for a failure that may never come. Security boundaries
are the exception: they guard against a problem that is invisible until it has already happened.

The other direction matters as much: before deleting code, find what it protects. A defensive copy that keeps a
caller from mutating live state looks redundant and is not. Read the callers and the history (blame) first.

### 3. Tests never shape production code

A test is the first consumer of code, not its designer. When production code has a shape only a test wants
(a return type chosen for an assertion, a field only a test reads, a seam only a test uses), change the test.

### 4. One owner per piece of logic

Logic lives in one place and every caller uses it, because two copies of a check diverge. Repeated three-line
patterns across files become one shared function.

**Favor the abstraction.** In greenfield feature work and in framework code, build it as soon as the shape
repeats or is obviously general; do not wait for a third copy. A general tool living inside one project's code
is a framework piece waiting to be extracted, so extract it early. What waits for real need is configuration: a
knob nothing sets is rule 2's problem, not this rule's.

### 5. Registration: the unit registers itself, the registry holds units, callers go through the registry

A unit (a definition, a controller, a screen, a handler, a command) must be registerable on its own; a registry
holds the registered units; callers use the registry generically rather than naming units one by one. Adding a
unit then touches only that unit.

Prefer automatic registration. Reflection is acceptable when it stays readable. A manual list is the fallback
when nothing automatic works. A hand-written branch over every unit, or a caller that knows each unit by name,
is the thing to avoid.

### 6. Design for the real consumer

Shape an API or config for how it will actually be used. A config read from a file needs concrete, serializable
types, because a lambda has no form in that file. Concrete subclasses beat a generic parameter bag when the cases
are known.

### 7. A value or string used in more than one place gets one name

Repeated literals drift apart one edit at a time. Tunable numbers get a named constant, so tuning is one edit.

Where the set of values is closed, use an enum, not a raw string, so a typo fails to compile or load instead of
matching nothing. A bare number or boolean in a callback signature says nothing about what it means; give it a
named type or pass a named function.

---

## Write it to be read

Build scripts and CI configuration are code, and every rule here applies to them. They are where a line that looks
removable and is not is most common.

### 8. One thing per line

Long lines are fine; dense lines are not. A 150-character line that logs one message is readable. A line that
branches, nests calls, or combines several conditions is not.

- At most two boolean terms in one condition. Past that, split into separate guards or named variables.
- Guards go one per line, returning early.
- No calls nested inside calls on one line; chain them, or name the intermediate.
- Hard wrap at 160 characters, unless a configured formatter sets the length.

The shape to avoid is a one-line expression holding three conditions and a query. It is shorter and slower to
read. The language skills show what this means for their idioms.

### 9. Functions short and single-focused by default

Keep functions small and doing one thing. A longer function is acceptable where the logic is genuinely coupled;
then split it into phases with blank lines and name each intermediate. Do not extract a helper only to make a
function shorter; extract it when it is reused or genuinely general.

### 10. Put a helper as close to its use as possible

Start inside the one function that needs it, then widen only as usage widens: private to the file, then a themed
shared file once more than one place uses it.

### 11. One substantial unit per file

A file holds one class or one cohesive set of functions that does real work. Small satellites may share it: an
enum only that unit uses, a private support type, a family of one-line declarations. A file stacking many
unrelated units gets split. A package that grows meaty gets subpackages.

### 12. Show the finished output above code that builds it

A function that builds a string for a person to read carries an example of the finished result in its comment,
because the result is hard to picture from the code that assembles it. Build the string from named parts rather
than one template with every variable smashed together. Prose and help text use the language's multiline
strings, not concatenated fragments.

### 13. Names say what the thing is in the domain

No one-letter names, no names that describe the mechanism instead of the meaning. A type holding why an order was
put on hold is `HoldReason`, not `OrderStateFlag`. Rename when a name describes what the code did two changes ago.

- Prefer the plain word to the textbook one.
- A pattern's role goes in the type name (`...Policy`, `...Repository`, `...Dto`), so the kind of thing is
  visible at every use.
- Do not reuse an existing domain term for a new concept.

### 14. Rounding is explicit

A rounding rule never hides inside an operator that does not look like one, because a reader cannot see a rule
the operator applies silently. Divide exactly, then round with a named function whose rule is visible. Each
language skill says where its operators truncate or round.

---

## Tests and failure

### 15. Tests assert what the code should do, not what it does

Write a test from the use case. A test written by reading the current code pins whatever that code does,
defects included. When the intended behavior and the code disagree, fix the code, or ask which one is right; do
not encode the defect.

- **Fixtures run the real path.** A fixture that sets a field directly instead of going through the lifecycle
  the code uses makes the test pass rather than making the fixture right. If the real path is hard to drive from
  a test, that is a finding.
- **Test-only code never goes in production**, and production shape never bends for a test (rule 3).
- **No tests for what the language or a library guarantees**, such as a serializer round-tripping a record.
- **Keep adding tests as you go.** They catch mistakes while the code is being written. Writing them first is
  fine; do not let an early test anchor a design that is still moving.

### 16. Fail fast on bad input

Bad input is a crash, not a silent default, so a defect shows up where it starts instead of far downstream. An
unknown config key, a missing registration, a `NaN` or a lookup that finds nothing where something must exist all
fail at the point they are detected, with a message naming the value. Use the lookup that fails over the one that
falls back, wherever absence is a defect rather than a case.

---

## Hygiene

### 17. No new TODOs or commented-out code

Open an issue instead of writing a TODO, and delete code rather than commenting it out; version control keeps it.
Reviewers flag every new TODO and every block of commented-out code without judging whether it is justified, and
the author dismisses the ones that are.

### 18. No noise logging

A log line that fires on every routine lifecycle step ("Disposing") says nothing. Log what someone debugging
would need.

### 19. Comments

The comment-style skill governs. Doc comments are valuable where a caller could get something wrong, and not
required elsewhere.

---

## Local additions

Rules added on this machine, such as a guide for a language no skill covers. Where one conflicts with a rule
above, the addition wins.

!`cat ~/.claude/local/code-style/additions.md 2>/dev/null || echo "(none)"`
