## Delegation

- Noisy work is delegated to a teammate, and the reason is accuracy: rule-following degrades past about 30% of the
  context window on Opus 5.5, and 60% is the ceiling. `~/.claude/local/delegation/additions.md` may change both.
- Delegate work whose result is cheap to check or whose failure is loud: driving a UI to a known end state, triaging
  logs, broad searches where only the conclusion matters, one-shot capability checks, and reading a large generated
  file for one answer. Any decision about what code should do stays with the lead. A multi-hop trace of what code
  does goes to an agent only when it returns every hop as `file:line` for the lead to spot-check, as the
  `code-researcher` template does; otherwise the lead traces it.
- A repository's own delegation list can add, narrow or name these shapes; the reason above does not change.
- One worker by default. Three or more live teammates needs the user.
- A teammate idling with reason "interrupted" was interrupted by the user on purpose; carry on.
- Load the `delegation` skill before spawning a teammate and before replying to one.
