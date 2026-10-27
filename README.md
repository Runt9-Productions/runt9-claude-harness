# runt9-claude-harness

Opt-in plugins and harness pieces for Claude Code, still being migrated in.

```
/plugin marketplace add Runt9-Productions/runt9-claude-harness
/plugin install <name>@runt9
```

Updates are manual: run `claude plugin update <name>@runt9` when you want one.

## Harness parts

The parts that cannot be plugins, such as the git hooks, are installed from a clone with `bootstrap.py`, which can
install the plugins too. Run it in your own shell, not in a Claude Code session, since an agent must not be the one
writing the install. It needs Python 3.12 and git, and `claude` for plugin components; the hooks need what
[their README](harness/githooks/README.md) lists.

```
git clone https://github.com/Runt9-Productions/runt9-claude-harness.git
cd runt9-claude-harness
python3 bootstrap.py --list
python3 bootstrap.py githooks hooks-path --repo <path>
```

With no component named it asks about each one. `python3 bootstrap.py --help` lists what each component does and what
each check refuses.

Updating: for the harness parts, check out `main`, pull and run `bootstrap.py` again. For a plugin, run
`claude plugin update <name>@runt9`; running `bootstrap.py` again does not update a plugin already installed.

MIT licensed.
