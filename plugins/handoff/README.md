# handoff

Hands a session off to its own next context. One press, or `/handoff`, asks Claude to write the session's state to a
handoff file and give a compaction message; when that turn ends the session compacts with the message, and a resume
prompt has Claude read the handoff file back.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install handoff@runt9
```

## The band

A line above the prompt shows how full the context window is, yellow from 30% and red from 60%, with a
**Hand off and compact** button. The two points are the plugin's `warn_percent` and `ceiling_percent` options, set in
`/config`; the defaults match the delegation rules' figures for where rule-following degrades and its ceiling. While a handoff runs, the button gives way to its phase: waiting for the current
turn to end, Claude writing it, or compacting, with a **Cancel** button beside it.

## A handoff

`/handoff` takes an optional argument, passed on to Claude as what the summary should stress:

```
/handoff the open migration question
```

The press or the command queues a `[handoff]` prompt behind any turn that is running. In that prompt's turn Claude:

1. Writes a handoff file: repository and branch state, decisions the owner settled, what is in flight, and the
   ordered next steps. It goes in the repository's `.claude/output/` for work on a repository, otherwise in
   `~/.claude/output/`. The file holds the current state only: an existing handoff file for the same work is
   rewritten, with whatever is done or superseded dropped, and decisions that outlast the work move to memory, a
   knowledge base or the plan.
2. Calls the `compact_with` tool with its compaction message: what to keep, what to drop, and the handoff file to
   read first.
3. Ends the turn.

The session then compacts with that message. A turn of the main conversation that starts in the meantime, such as
one a teammate's message starts, is waited out; a subagent's or teammate's own turn is not. After the compaction a
`[resume]` prompt asks Claude to read the handoff file and any plan, spec or project file it names, and reply with its
next step. Claude then waits for you to confirm.

Add `.claude/output/` to each repository's `.gitignore`, or to `.git/info/exclude`, so handoff files stay out of
commits.

`compact_with` refuses a call from any turn but the one the `[handoff]` prompt started, and refuses a message that is
empty or not text.

## When it stops

A toast says why each time:

- A handoff is already under way: a second request is refused.
- You press Cancel: nothing is compacted. A queued `[handoff]` prompt cannot be taken back, so its turn still runs,
  and `compact_with` tells Claude there that the handoff was cancelled. Once the compaction itself has started, Cancel
  is refused.
- You interrupt the handoff turn: nothing is compacted.
- Claude ends the turn without calling `compact_with`: nothing is compacted.
- The compaction is skipped, or keeps failing for about five seconds with no turn running: no resume prompt is sent.
  On failure the message stays in the transcript for a `/compact` by hand.

## The away plugin

A plugin named `away` may run `/handoff` while nobody is at the keyboard. The handoff checks the name of the plugin
that ran the command, so `/handoff` from any other plugin counts as yours. A handoff `away` starts differs in four
ways:

- Its prompt says the owner is away.
- If Claude wrote no compaction message, it compacts anyway, with instructions to keep the work in flight, the settled
  decisions and the next steps.
- Its resume prompt tells Claude to carry on with the next step without waiting, unless the handoff file says the work
  had stopped on purpose.
- If it fails, it also sends Claude a `[handoff]` prompt saying why, so the failure is reported where you will see it.

Interrupting its turn still compacts nothing.

`away` reads this plugin's state, typed in `types/index.d.ts`: `phase` (`idle`, `queued`, `writing`, `compacting`),
`isUnattended`, and `ceilingPercent`, the fill at which it hands off (the `ceiling_percent` option). `phase` and
`ceilingPercent` are written on every session start and every turn.
