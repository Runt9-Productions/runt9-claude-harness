# guardrails

A mod that asks a model whether a tool call breaks one of two rules: never read a credential store or hunt for
secrets, and never install, remove or upgrade software unless the user's own messages approve it. It judges what a
call does, so it is not fooled by quoting or by an unusual tool the way a pattern over the command text is.

A cheap text prefilter picks the candidate `Bash`, `Monitor`, `Read`, `Grep` and `Glob` calls: store names, key
files, secret words, package managers with an install verb, installer pipes and download-and-unpack chains. Every
other call runs untouched. For a candidate, the judge model reads the rules, the pending call and the user's last
eight prompts, each with the agent message it answered. It never reads tool results. Its reason comes back to the
agent as the refusal.

The user's prompts are those typed at the terminal, sent through Remote Control, or given to `claude -p`. Messages
from teammates, plugins and notifications are never read as approval, and a teammate's or subagent's call is judged
against the user's prompts too.

A failed request, a timeout (20 s), or a reply with no verdict refuses the call. A reply that denies anywhere is a
denial. Calls raised by another plugin's own `$.tool.call` are not judged.

A judged call waits about two seconds. Approval does not survive `/clear`, a resume or a new `claude -p` process, and
an answer given in a question dialog or a permission prompt is not seen, so an install approved there is refused and
has to be approved in a message. A name the prefilter cannot see (built at run time, read from a file) is never
judged. Pair it with the permission deny rules in the harness's `guardrails-stores` settings fragment, which hold for
the `Read` tool whatever the judge says.

## Settings

`model`: `haiku` (default), `sonnet` or `opus`.
