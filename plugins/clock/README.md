# clock

Puts the local date and time beside a prompt, so Claude can read it without calling a tool. It goes with the
session's first prompt, and then with the first prompt at least 15 minutes after the last one that carried it.
Prompts inside that window carry nothing. After a compaction the next prompt carries it again, since the summary may drop the last note.

The model reads it as context after the prompt, which the user does not see:

```
Local time: Wednesday 2026-11-04 14:32 (UTC+02:00). The user's previous message was 2 h 5 min ago.
```

The second sentence appears when the user has written before in the session: at the terminal, through Remote
Control, Slack or an SDK host, or through a plugin that submits their own words. A prompt from a background task, a
schedule, another session, a relayed channel or any other plugin gets the time too, but is not counted as the user's
message.

There are no settings. The plugin keeps two times in the session's state, so a reload of the plugin keeps the
window where it was.
