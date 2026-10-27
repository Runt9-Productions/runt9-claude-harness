# teammate-delivery

Under Agent Teams, a message sent to an in-process teammate normally waits in its mailbox until the teammate's
current turn ends. With this plugin, a message the model sends to a teammate that is mid-turn is added to that
teammate's conversation at once, so its next model request reads it. Nothing else about sending changes.

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. There are no settings.

## What the teammate sees

The message arrives as one row: a header line naming the sender, then the body with every line quoted.

```
Message from team-lead, delivered during your turn:
> Run the fixture suite again.
> Then report back.
```

The sender is `team-lead` when the main conversation sent it, and otherwise the sending teammate's name. The
receiver learns the sender by name only. Every Unicode line break starts a new quoted line (CRLF counts as one),
so no line of the body can pass for a header.

Inside the body, a `<` that opens or closes a tag whose name contains `-`, `_` or `:` gets a `\` inserted after
it, the same escape the engine's mailbox applies to its envelope tags: `<example-tag>` becomes `<\example-tag>`.
Generics such as `Result<io_error>`, plain HTML such as `<div>`, comparisons and one-word tags are left alone.
Case does not matter.

## When it applies

A send is diverted only when it comes from the model, exactly one agent matches the address (by id, by name or by
teammate id), that agent is a teammate, it is running, and the plugin has seen its current turn start. Everything
else goes to the mailbox as usual: an idle or finished teammate, an unknown or ambiguous name, a subagent that is
not a teammate, and any send made by a plugin. If anything fails, or another plugin refuses the row, the message
goes to the mailbox instead.

Teammates hosted in their own terminal pane (tmux, iTerm2) run in another process and are not affected.

After the plugin reloads, it has forgotten which turns are open, so sends use the mailbox until each teammate
makes its next model request.

## When the turn ends

If the teammate's turn ends before any request carried the message:

- If the turn ended with an answer and the message is still in the conversation, the teammate gets one short
  mailbox message saying that a message reached it mid-turn and where to find it. If the conversation no longer
  holds it, the message itself is sent through the mailbox.
- If the turn was interrupted, refused or ended in an error, the teammate is not restarted. A toast says the
  message went unread.

A toast also reports a mailbox send that failed and any error inside the plugin.

## Other plugins

A diverted message does not travel by mailbox, so other plugins' `session.receive` hooks never see it, and neither
do `session.send` hooks that run after this plugin's. `session.append` hooks see it as a `note` row from this
plugin.
