# no-progress-reminder

During a long turn, Claude Code adds a reminder to the model's request asking it to say what it is doing and then
continue. This plugin removes that reminder from every request. Every other reminder and attachment reaches the
model unchanged.

There are no settings.

The plugin matches the reminder by the engine's name for it, `silent_turn_reminder`. A Claude Code release that
renames it makes the plugin do nothing, with no error, and the reminder appears again.
