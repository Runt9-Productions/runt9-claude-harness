# teammate-delivery

Under Agent Teams, a message sent to an in-process teammate normally waits in its mailbox until the teammate's
current turn ends. With this plugin, a message the model sends to a teammate that is mid-turn is added to that
teammate's next tool result, so the model request after that tool call reads it. Nothing else about sending changes.

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. There are no settings.

## What the teammate sees

The message arrives as a text block after the teammate's next tool result: a header line naming the sender, then the
body with every line quoted.

```
Message from team-lead, sent during your turn:
> Run the fixture suite again.
> Then report back.
```

The sender is `team-lead` when the main conversation sent it, and otherwise the sending teammate's name. The
receiver learns the sender by name only. Every Unicode line break starts a new quoted line (CRLF counts as one),
so no line of the body can pass for a header.

Inside the body, every `<` that starts something shaped like the engine's envelope tags gets a `\` inserted after
it: `<example-tag>` becomes `<\example-tag>` and `</example-tag>` becomes `<\/example-tag>`. The shape is a `<`, an
optional `/`, then a name that starts with a letter and holds at least one separator: a dash, a connector such as
`_`, or a colon. The look-alikes of `<`, `/` and the separators that `hooks/register.ts` lists count as them, and
invisible characters and combining marks are ignored, so none of those hides a tag. A look-alike that list does not
name is not escaped. That holds even when the tag follows a word with no space,
so a generic whose type name has a separator is escaped too (`Result<io_error>` becomes `Result<\io_error>`). Plain
HTML such as `<div>`, one-word tags and a `<` followed by a space or by anything other than a letter (`a < b-c`,
`x<-y`) are left alone. Case does not matter.

## When it applies

A send is diverted only when it comes from the model, exactly one agent matches the address (by id, by name or by
teammate id), that agent is a teammate, it is running, and the plugin has seen its current turn start. Everything
else goes to the mailbox as usual: an idle or finished teammate, an unknown or ambiguous name, a subagent that is
not a teammate, and any send made by a plugin. If looking up the teammate fails, the message goes to the mailbox
instead.

A diverted message is held until the teammate's next tool result and added to that row. A tool result that holds
anything but text or images, such as a tool search's result, is skipped, and the message waits for the next one.

Teammates hosted in their own terminal pane (tmux, iTerm2) run in another process and are not affected.

After the plugin reloads, it has forgotten which turns are open, so sends use the mailbox until each teammate
makes its next model request. A reload while a message is held for a teammate, as during its tool call, loses that
message, with no toast.

## When the turn ends

Messages still held when the teammate's turn ends, because no tool result came after them, are sent through the
mailbox, one send each, however the turn ended. So is a message added to a tool result that no model response went
on to read, as when the turn is interrupted or fails right after that tool call. The teammate may then read that
message twice: in its tool result and from the mailbox. A toast reports a mailbox send that failed and any error
inside the plugin.

## Other plugins

A diverted message does not travel by mailbox, so other plugins' `session.receive` hooks never see it, and neither
do `session.send` hooks that run after this plugin's. `session.append` hooks that run after this plugin's see it
inside the teammate's `tool-result` row, not as a row of its own.
