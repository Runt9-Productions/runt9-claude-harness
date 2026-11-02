# no-progress-reminder

When a turn runs a while without the model saying anything, Claude Code adds a reminder to the model's request
asking it to say what it is doing and then continue. This plugin removes that reminder from every request. Every
other reminder and attachment reaches the model unchanged.

There are no settings. Claude Code documents no setting or environment variable that turns the reminder off.

The plugin matches the reminder by the engine's name for it, `silent_turn_reminder`, as read on Claude Code 2.1.316.
A release that renames it makes the plugin do nothing, with no error, and the reminder appears again. To find the
current name, look in a session transcript under `~/.claude/projects/` for an attachment row whose text is that
reminder: its `type` is the name.
