---
triggers: [turn-end, compaction]
audience: nudge
agents: all
reads: [prompts, replies, calls]
---
The agent's recent calls and replies serve a goal other than the one the person last asked for. Raise it only when the
work has plainly moved away from the request, not when it is a step toward it.
