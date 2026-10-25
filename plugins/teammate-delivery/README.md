# teammate-delivery

With Agent Teams, a message sent to a teammate normally waits in its mailbox until the teammate's whole turn ends.
This plugin adds the message to the teammate's running turn instead, so the teammate reads it at its next model
request, headed `[Message from <sender>, delivered while you were working]` with the message quoted beneath. A
message to an idle teammate still goes by mailbox. If the teammate's turn ends before reading the message, a short
mailbox message wakes it; if the turn was stopped instead, nothing restarts it and a notice says the message is unread.

Needs Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). No settings.
