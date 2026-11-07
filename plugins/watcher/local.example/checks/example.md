---
# The file name without .md is the check's name, so a file named like a shipped check replaces it.
triggers: [turn-end, commit]   # turn-end, refusal, teammate-idle, compaction, commit, secret-match
audience: nudge                # nudge | flag | both
agents: all                    # main | teammates | all
reads: [prompts, calls]        # prompts, replies, calls, results, exits, status, shared, notes, plan
model: haiku                   # optional; haiku when left out
---
The agent edited a generated file by hand, such as a lockfile or a file whose header says it is generated, instead of
running the tool that writes it, and the person did not ask for a hand edit.
