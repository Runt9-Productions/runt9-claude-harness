# chrome-devtools

Gives Claude a real browser for pages rendered by JavaScript, where a plain fetch returns an empty shell. The plugin
starts Google's `chrome-devtools-mcp` server at a pinned version, with the options that keep a session's browsing
contained turned on.

The server drives a Chrome that is already installed; the plugin does not install one.

## Flags

`.mcp.json` runs `npx -y chrome-devtools-mcp@1.12.0` with:

- `--isolated`: each run gets a temporary profile, removed when the browser closes, so no cookies, logins or history
  carry from one session to the next.
- `--headless`: Chrome runs without a window.
- `--blockedUrlPattern file:///*`: the browser blocks navigations and requests to `file://` URLs, so a page cannot
  load local files.
- `--fileNavigations=false`: the server's own page tools refuse `file:` URLs, `view-source:` URLs of them included.
  It limits what the server navigates to and is not a filesystem sandbox.
- `--redactNetworkHeaders`: the headers the server considers sensitive are redacted before the network tools
  return them, which keeps tokens and cookies in them out of the transcript.
- `--no-usage-statistics`: the server sends no usage statistics to Google.
- `--no-performance-crux`: performance tools do not send the URLs in a trace to the Chrome UX Report API for field
  data.

Every flag above appears in the `--help` of version 1.12.0.

## Tool names

The server is named `chrome-devtools` inside this plugin, so its tools are named
`mcp__plugin_chrome-devtools_chrome-devtools__<tool>`, such as
`mcp__plugin_chrome-devtools_chrome-devtools__navigate_page`. A server added by hand with `claude mcp add` names
them `mcp__chrome-devtools__<tool>` instead. Permission rules, hooks and agent `tools` lists written for a server
added by hand match none of this plugin's tools until they use the new prefix. Remove a server added by hand under
the same name, or Claude sees two browsers.

## Raising the pin

The version is pinned exactly, so an update to the server reaches no one until the pin changes. Before raising it,
check each flag above against the new version's `npx chrome-devtools-mcp@<version> --help`, and raise the plugin's
own version in `.claude-plugin/plugin.json` with it.
