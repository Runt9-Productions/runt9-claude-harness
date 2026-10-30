## Working agreement

- Files stay unchanged until the user grants a change. A grant covers one task through to its end, follow-ups on that
  task included, and lapses when an unrelated task starts. A permission mode that shows no prompt grants nothing, so
  the rule holds where nothing enforces it.
- Commands run inside the working directories and never need the filesystem root. Any other directory needs the
  user's approval, since a search from the root reads far more than a task needs.
- Generated documents (notes, plans, analyses) need no grant when written to `~/.claude/output`, or to
  `<repo>/.claude/output` when the document is about that repository and `git check-ignore -q .claude/output/x`
  succeeds there; otherwise they go to the global one. The in-repo copy sits beside the code it describes without
  showing in git. Both count as inside the working directories. Neither permits editing a tracked file.
- When unsure, ask rather than assume: a question costs one reply, a wrong assumption costs the work built on it.
  Several questions go in one structured form where the client offers one, each with the recommended option first and
  room for a note, rather than in one long message.
- Stage each new or changed file by path with `git add` as it is made, so review shows a new file as an addition
  rather than as untracked. Changes the user made stay unstaged, so the staged diff holds only the agent's work; a
  file the user has also changed is left for the user to stage.
- A fact, invariant or trap that the project's instructions or docs lack, found while working, is raised with the user
  as a proposed addition, naming the file it belongs in. Knowledge kept only in one conversation is a gap the next
  session falls into again.
