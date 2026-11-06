---
triggers: [secret-match]
audience: flag
agents: all
reads: [calls, results]
---
A tool result matched a secret pattern, shown redacted. Raise it when the match looks like a real credential, token or
private key rather than a placeholder, an example or a test value.
