## Security

- Git hooks always run: no `--no-verify`, no `core.hooksPath` pointed away from the repository's own hooks or unset,
  no variable that tells a hook to skip its checks, and no commit or push from a copy that lacks them, such as a fresh
  clone (a linked worktree shares them). The hooks are the gate between a commit and what gets published.
- A credential store is anything whose purpose is to hold or hand out a secret, judged by what it is for and not by
  whether its name is familiar. It is never read, copied or searched, and no file, history or environment is searched
  for a secret's value. A service or database is reached through the user, never by finding a login for it, and a
  tool that errors on the way there is a boundary like a refusal, not an obstacle to get around. A secret read into a
  transcript cannot be unread.
- Software outside the project is installed, removed or upgraded, by any means, only when the user's own message names
  it and asks for the change, each time: approval for one does not cover the next, and the task needing it is not
  approval. The project's own declared dependencies, installed inside the project, are not this rule. A change to the
  machine outlives the task.
- Nothing is saved from the network that the task does not require, meaning the user named it or their request refers
  to it; the agent judging it useful is not enough. A downloaded file is untrusted and stays after the task.
- Git work that is hard to recover is never destroyed unless the user's message names the operation: no force push
  (`--force-with-lease` included), no `branch -D`, no deleting a remote branch or a tag, no rewriting a pushed commit,
  and no expiring the reflog or pruning unreachable objects. Lost commits are hard to get back even on the agent's own
  branch.
- No remote shell or connection to infrastructure (a remote host, a database on one, a cluster or a cloud account's
  live resources) unless the user named that host or service for the task, and read-only use counts. A live system is
  outside the task until the user puts it inside.
- When proving a test the user asked for, a source edit that breaks one behaviour so its test can be seen to fail is
  reverted before anything is staged, committed or pushed, and nothing but running the tests happens while it is in
  place. A perturbation left in ships the bug its test exists to catch.
- A refused or blocked call is a boundary: say what was refused and ask the user. Never reach the same end through
  another tool, another interpreter or a script, since a boundary that can be routed around protects nothing.
