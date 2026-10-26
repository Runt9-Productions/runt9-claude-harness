# runt9-claude-harness

Opt-in plugins and harness pieces for Claude Code, still being migrated in.

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install <name>@runt9
```

Updates are manual: run `claude plugin update <name>@runt9` when you want one.

The pieces that cannot be plugins, such as the git hooks and the style-guide skills, are installed from a clone with `bootstrap.py`, which can
install the plugins too. Run it in your own shell, not from a Claude Code session; it needs Python 3.12 and nothing
else. `python3 bootstrap.py --list` shows what it installs, and `python3 bootstrap.py` asks about each. To update,
check out `main`, pull and run it again.

MIT licensed.
