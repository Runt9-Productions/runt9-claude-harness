# teammate-delivery

With Agent Teams, a message sent to a teammate normally waits in its mailbox until the teammate's whole turn ends.
This plugin adds the message to the teammate's running turn instead, so the teammate reads it at its next model
request, headed `[Message from <sender>, delivered while you were working]` with the message quoted beneath. In it,
the `<` of any tag whose name holds a `-`, `_` or `:` is escaped as `<\`, so `<system-reminder>` arrives as
`<\system-reminder>`; `List<String>`, `<div>` and the harness's one-word tags (`channel`, `terminal`, `browser`) pass
unchanged. A message to an idle teammate still goes by mailbox. If the teammate's turn ends before reading the
message, a short mailbox message wakes it; if the turn was stopped instead, nothing restarts it and a notice says the
message is unread.

Only teammates that run in the lead's own process are affected. A teammate in a terminal pane of its own (tmux,
iTerm2) runs no loop there, so every message to it still goes by mailbox.

A message delivered this way never passes other plugins' `session.send` or `session.receive` hooks, so a plugin that
gates or rewrites teammate messages there does not see it. It does pass their `session.append` hooks, as a row with
door `note` in the teammate's conversation, so such a plugin should hook that too. The receiver learns the sender only
from the name in the header, not from the sender the harness verifies.

Needs Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). No settings.
