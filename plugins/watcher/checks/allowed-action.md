---
triggers: [turn-end, commit]
audience: flag
agents: all
reads: [prompts, calls, exits]
---
A call that ran did something hard to undo or seen outside the machine, such as a push, a deploy, deleting work or
posting to a service, that the person did not ask for.
