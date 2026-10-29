---
name: effort-estimate
description: Sizes a code change by complexity, lines of code and number of files, and never by duration. It traces the existing code in both directions, compares the change with a shipped change of similar shape, and lists the risks and the assumptions it could not check. Use it when someone asks "how big is this", "size this ticket", "scope this change", "how much code would this take", "is this small or large", when grooming a ticket nobody is building yet, and as step 1 of the `develop` skill. Use it as well for "how long will this take" and other duration questions, answering them in effort.
argument-hint: <ticket or description of the change>
allowed-tools: Read(~/.claude/local/develop/**)
---

# Effort estimate

## Units

- No duration in any unit. A duration question gets an effort answer and a note that turning effort into time is the
  owner's call, since a model's time figure has no grounding. A ticket type that implies a duration is the owner's
  choice too.
- Any teammate asked to estimate is told the units outright: file count; lines per piece, production and test
  apart; complexity and risk per piece; no duration. An unqualified request for "a size" comes back in days.

## Method

1. Read the ticket. If it cannot be read, say so first and say what was used instead.
2. Read the knowledge base note for the area before the code, where the repository has one.
3. Trace the existing code toward both callers and callees. Both kinds of surprise, a piece that already exists and
   a path nobody mentioned that has to change as well, show up only in the trace.
4. Break the change into pieces, each with its files.
5. Find a shipped change of similar shape and cite its files and lines from git, or state that none exists.
6. For a dependency on a vendor, a protocol or a library, check the web and cite the source and its date.
7. List what was not confirmed, and how the numbers move if it is wrong.

## Splitting the research

The lead reads the ticket and the knowledge base itself, then divides the tracing into self-contained questions, one
per subsystem or per candidate design, each for its own research teammate. The `delegation` plugin's
`templates/code-researcher.md` fits, because it returns the path as `file:line` hops. The comparison, the web check
and the list of unverified points stay with the lead.

Before relying on a teammate's claim stated as certain, or one the numbers depend on, check it in the code. One
missed caller can make an edge case look like a guaranteed failure.

## Output

Leave out any section with nothing in it.

- **Headline**: Small, Moderate or Large; production and test line ranges; file count; the scope assumption the
  numbers rest on; and, when the cost is mostly not code, where it really lies.
- **Existing pieces**, each with `file:line`.
- **Changes**: a table of piece, files, lines and notes. State the net when removals dominate.
- **Comparison**: the similar past change and how this one differs.
- **Risks.**
- **Not verified**, with the effect on the numbers.
- **Questions** whose answers move the estimate, and in which direction.

## Where it goes

- In chat, unless told otherwise.
- In a ticket comment when asked. Cite classes and files but not line numbers, which drift before work begins.
- In the spec location for any ticket that will be built, in the units a diff stat reports, because the `develop`
  skill's step 11 records the actual size beside it.

## Local additions

Rules added on this machine win over the rules above where they conflict.

!`cat ~/.claude/local/develop/effort-estimate.md 2>/dev/null || echo "(none)"`
