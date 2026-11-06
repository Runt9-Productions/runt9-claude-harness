# session-context

This plugin replaces `clock`. Uninstall `clock` first (`claude plugin uninstall clock@runt9`), or every due prompt
carries two time lines.

Puts the local date and time and the plan's usage beside a prompt, so Claude can read them without calling a tool.
They go with the session's first prompt, and then with the first prompt at least 15 minutes after the last one that
carried them. Prompts inside that window carry nothing. After a compaction the next prompt carries them again, since
the summary may drop the last note.

The model reads it as context after the prompt, which the user does not see:

```
Local time: Wednesday 2026-11-04 14:32 (UTC+02:00). The user's previous message was 2 h 5 min ago. Plan usage: 5h 52% (resets 16:00), 1wk 31% (resets 11-09 09:00).
```

The second sentence appears when the user has written before in the session: at the terminal, through Remote
Control, Slack or an SDK host, or through a plugin that submits their own words. A prompt from a background task, a
schedule, another session, a relayed channel or any other plugin gets the time too, but is not counted as the user's
message.

The usage part lists each window Claude Code reports: `5h` for the five-hour window, `1wk` for the seven-day one,
`spend` for a gateway's spend limit, and any other kind by its own name. A reset time on today's local date shows as
`16:00`, one on another day with its month and day, as `11-09 09:00`. A window that gives no reset time shows its
percentage alone, and the part is left out when there are no windows. The figures come from the last model response,
so the session's first prompt has none, and an account off a subscription never has any. A time line that went out
without figures goes out again on the first prompt that has them, even inside the 15 minutes; a line that had them
waits the full interval.

## The 90% warning

On the next prompt after a window first reaches 90%, one line goes beside it, outside the 15-minute schedule:

```
Plan usage passed 90%: 5h 91% (resets 16:00).
```

It comes once per window period. A window rearms once the clock passes the reset time it showed when it warned, or,
for a window that gives no reset time, once a reading shows it back under 90%. A reading without the window, such as
one with no figures at all, rearms nothing. A reading whose reset time has already passed is left over from the
ended period and warns of nothing. A prompt that already carries the time line shows the figure there and gets no
warning of its own. Nothing else is added on any other prompt.

## The tool

Claude can call `mcp__session-context__plan_usage` for the current figures at any time. It answers with the local
time and the same usage part:

```
Local time: Wednesday 2026-11-04 14:32 (UTC+02:00). Plan usage: 5h 52% (resets 16:00), 1wk 31% (resets 11-09 09:00).
```

There are no settings. The plugin keeps two times, whether the last time line had figures, and the windows that have
warned in their current period in the session's state, so a reload of the plugin keeps the schedule and the warnings
where they were.
