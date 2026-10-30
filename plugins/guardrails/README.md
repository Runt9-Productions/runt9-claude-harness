# guardrails

PreToolUse hooks that deny a tool call crossing a fixed boundary, whatever the goal behind it. Each denial names what
it matched, why that category is refused, and what to do instead: ask the user, or have them run the command with a
`!` prefix. The hooks keep an agent from drifting across a line it means to respect; they are not built to stop one
that is set on evading them.

So far it guards credentials.

## Installing

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install guardrails@runt9
```

Then, from a clone of the repository (see its README), merge the credential deny rules into `~/.claude/settings.json`,
which shows the diff and asks before writing:

```
python3 bootstrap.py harness settings:guardrails-stores
```

The rules live in the harness rather than in this plugin because a plugin cannot ship `permissions.deny` rules.

Every hook entry sets `"onFailure": "block"`, so a hook that crashes, times out or is missing denies the call rather
than letting it through. That needs Claude Code 2.1.295 or later. Each hook is a Python 3.12 script using the
standard library only.

## What it ships

| file | what it is |
|---|---|
| `hooks/block_credential_crawl.py` | Denies reading a credential store, and searching outside the project for credential values, through Bash, Monitor, Read, Grep and Glob. |
| `hooks/shell_words.py` | Splits a shell command into the simple commands it runs, for the hooks that judge Bash and Monitor. |
| `hooks/hooks.json` | Registers the hook on `Bash\|Monitor\|Read\|Grep\|Glob`. |
| `local.example/credential-allowed-suffixes.txt` | An example of the machine-local file, below. |

The deny rules are `harness/settings/guardrails-stores.json` in this repository.

## Credentials

Two layers cover reading credential stores, and each covers what the other cannot.

**The deny rules** (`settings:guardrails-stores`) are `Read(//**/<name>)` rules for stores that have no
legitimate exception: `.pgpass`, `.netrc`, `.git-credentials`, `.pypirc`, `.my.cnf`, `.htpasswd`, `.envrc`,
`.aws/credentials`, `.docker/config.json`, `.config/gh/hosts.yml`, the default SSH private key names, keystore
extensions (`.jks`, `.p12`, `.pfx`, `.keytab`, `.keystore`, `.truststore`) and `.env`. Claude Code applies them to
Read, Grep and Glob, and to the Bash file commands and redirect targets it recognises. The `//**/` prefix matches the
name at any depth from the filesystem root. An allow rule cannot carve an exception out of a deny rule, so nothing
with an exception is listed there.

**The hook** covers the rest:

- the paths a Bash or Monitor command actually reads: the file operands of known reading commands (the sources only,
  for `cp`), the targets of `<` redirects, and the roots of a recursive search (the working directory when it names
  none). Commands inside `$(...)`, backticks, subshells, `{ ...; }` groups, `if` and loop bodies, and behind wrappers
  such as `sudo -u`, `timeout` and `exec` count, and a relative path resolves from wherever an earlier `cd` moved to;
- wildcards and brace lists, judged by the names they can spell, so `.env*` and `*.{pem,p12}` deny while `.*` and
  `*rc` do not;
- stores with exceptions, which only the hook can make: `.env.<suffix>`, `.pem`, `.key` and other private keys, and
  config files whose names say they hold secrets (`database`, `datasource`, `credentials`, `secrets` or `passwords`
  with a config extension, such as `example-datasource.yml`);
- any file in a credential directory (`.ssh`, `.aws`, `.docker`, `.gnupg`, `.kube`, `.config/gh`) apart from
  `known_hosts`, `config` and `authorized_keys` in `.ssh`, and a recursive search rooted in one;
- stores the deny rules leave out: the per-user `.npmrc` (a project's own sets options), the public halves of the
  default SSH keys, and the system password file;
- a search whose pattern names a credential (password, passphrase, secret, token, api_key, private key, bearer,
  `jdbc:` and the like) when it reaches outside the working directory, and a Grep whose `glob` covers config files
  named for secrets (`*.properties`). Inside the project any other such search is ordinary work on its code.

It judges what a call reads, never a name that only appears in its text, so `echo`, a commit message or
`git log --grep` mentioning a store is allowed.

The hook allows:

- `.env.example`, `.env.sample` and `.env.template`;
- each path suffix in the local allowed-suffixes file, below.

A command the shell tokenizer cannot split is denied only when its raw text names a store. Any error inside the hook
denies, with a message saying the guard failed.

The Monitor tool's `command` is judged the same way as a Bash command. That the `Monitor` matcher reaches the hook
has not been confirmed in a live session.

Known gaps:

- a path built at run time (`$FILE`);
- a file read by a script or interpreter, including a command inside a quoted string (`sh -c '...'`);
- a reading command the hook does not list, and a credential file with an unremarkable name;
- a recursive search inside the project: `grep -rn DB_PASSWORD .` prints the matching line of a `.env` file it
  passes, and the `--include`, `-g` and `--glob` values of a Bash search are not judged;
- a session started in the home directory, where every path counts as inside the project, so the keyword check never
  fires.

### Local allowed suffixes

`~/.claude/local/guardrails/credential-allowed-suffixes.txt` lists files the hook would deny that the agent may read:
project files whose names put them in the config-file class but which hold nothing secret, or a key the agent needs
for its own work. One path suffix per line, with blank lines and `#` comments skipped.
An entry matches a path that ends in it after a `/`, or a path equal to it, so a longer file name or another
directory's copy still denies. A missing or unreadable file allows nothing extra. The plugin never creates or changes
the file, and an entry added there appears in no diff, so review the file itself. An entry does not exempt a file a
deny rule covers.

### The sandbox, as a further layer

Neither layer sees a file that a script or interpreter opens itself. Claude Code's sandbox can: its
`sandbox.credentials` setting lists files and environment variables to keep from sandboxed commands, and a file entry
with `"mode": "deny"` blocks reading it at the operating system level.

```json
{
  "sandbox": {
    "enabled": true,
    "credentials": {
      "files": [{ "path": "~/.aws/credentials", "mode": "deny" }],
      "envVars": [{ "name": "EXAMPLE_TOKEN", "mode": "deny" }]
    }
  }
}
```

It applies to sandboxed Bash commands only. Set it in `~/.claude/settings.json`: a user-settings entry still applies
when the session excludes project and local settings, and the `mask` modes are honoured only from user settings,
managed settings and `--settings`. This plugin does not configure it.

## Trying a change

Start a session with `claude --plugin-dir plugins/guardrails`, which replaces the installed copy for that session
only. The tests sit beside the hooks and run under the repository's root `pytest`.
