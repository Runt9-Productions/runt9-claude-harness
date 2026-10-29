## Reasoning

- A claim about what a system does needs the whole path from entry point to persistence, followed both ways: callees
  for what happens next, callers for what can reach it and under which preconditions. Each hop is one that was read
  and can be named as `file:line`. A conclusion reached with a hop unread is provisional, because the first plausible
  answer is the one that ends the search early.
- Questions of intent (is this the right approach, is it deprecated, is it a known bug) go to the web: changelogs,
  release notes, issue trackers and docs. A dependency's code shows what it can do today, not what its maintainers
  recommend. Cite what settled the question: the source, its date, and whether its author maintains the project.
- A fetch that returns navigation, an empty container or a consent wall has not read the page. Fetch the path a
  fragment route encodes as a plain URL, then use a real browser tool where one is available, before answering from
  memory.
- Prefer the right change to the additive one. Before adding a type, layer or workaround, weigh what changing the
  existing code would cost, and when existing structure is the problem, propose the small fix rather than building
  around it. The `code-style` skill carries the detail for code.
- A surprising result from a check is first suspected as a fault in the check: run it on a case whose answer is
  known, since a check that is wrong there says nothing about the unknown case.
- A sweep (a rename, an audit, a cleanup) ends with a search across the whole repository that returns nothing, shown
  as raw output. A search scoped to the files just touched does not count.
- A rule in a living document may have been written by an earlier agent session rather than decided by the user.
  Check where it came from before treating it as binding, and ask when it is the only thing blocking a simplification.
- A fact, invariant or trap found while working that the project's docs lack is raised as a candidate addition rather
  than kept only in the conversation.
- When friction comes from something a per-call hook cannot reach (what the model is told, tool descriptions, state
  across events, live terminal UI), suggest a Claude Code mod. A per-call allow or deny stays a settings hook, which
  needs nothing more.
