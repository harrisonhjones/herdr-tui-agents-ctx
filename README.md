# herdr-agents-ctx

Shows how much of its context window each agent has used, next to the agent in herdr's Agents sidebar, coloured by
threshold. It draws nothing itself. It writes a per-pane metadata token that your sidebar layout renders.

Currently it only supports [Claude Code](#claude-code). PRs that add other agents are welcome; see
[Adding an agent](#adding-an-agent).

```
▾ my-project
├─ ◐ Fix login redirect 34%
├─ ✓ Add export endpoint 62%
└─ ○ Write release notes 91%
```

herdr has no event that carries an agent's context usage, so each agent gets an adapter: a small piece of
`agents-ctx.js` that gets the percentage from the agent itself and reports it to the agent's pane. The adapter runs
inside the agent's pane, where herdr sets `HERDR_PANE_ID`.

It runs side by side with [herdr-tui-agent-tree](https://github.com/harrisonhjones/herdr-tui-agent-tree): each writes
its own tokens under its own source (this one is `agents-ctx`), so neither one's updates or `clear` touch the other.

Requires herdr >= 0.9.5 and Node (any recent version) on PATH. It is pure Node and calls herdr through
`HERDR_BIN_PATH`. Tested on Linux, not yet Windows or macOS. Config path outside Windows:
`~/.config/herdr/config.toml`.

## Install

1. Link the plugin:

   ```sh
   herdr plugin link /path/to/this/folder
   ```

   Linking adds the `clear` and `doctor` actions. The adapters are what write the tokens, and they work whether or not
   the plugin is linked.
2. Add the tokens to your sidebar layout (below).
3. Connect each agent you use (see [Agents](#agents)).

## Required herdr config (`~/.config/herdr/config.toml`)

The plugin cannot write client config, so add the three tokens to your agent rows yourself and run
`herdr server reload-config`. With herdr-tui-agent-tree's layout, append them to its second row:

```toml
[ui.sidebar.agents]
rows = [
  ["$ws_header"],
  [
    { token = "$t_working", fg = "#e5c07b" },
    { token = "$t_blocked", fg = "#e06c75" },
    { token = "$t_done",    fg = "#98c379" },
    { token = "$t_idle",    fg = "#9aa5b1" },
    { token = "$t_unknown", fg = "#7f848e" },
    { token = "$ctx_lo",    fg = "#7f848e" },   # below 50%
    { token = "$ctx_mid",   fg = "#e5c07b" },   # 50% to 79%
    { token = "$ctx_hi",    fg = "#e06c75" },   # 80% and above
  ],
]
```

Any other layout works the same way: append the three entries to the row the percentage should sit on. Exactly one
`$ctx_*` token is set per connected agent, so exactly one is shown, in its threshold's colour. A row entry's colour is
fixed in config, so one token can't change colour on its own, which is why there are three. Agents that aren't
connected have none of them, and their rows don't change.

## Actions

- `herdr plugin action invoke harrisonhjones.herdr-tui-agents-ctx.doctor` prints each agent's pane, kind, context token
  and label, changing nothing.
- `...clear` removes every token this plugin wrote. Each agent sets its token again on its next report once the value
  changes, or within 5 minutes.

## Notes

- The herdr call runs detached, so it never holds up the agent. It is only made when the value changes, or when the
  last report is over 5 minutes old. A marker in the temp dir (`herdr-agents-ctx-<pane>`) records the last report.
- Tokens have a 10-minute TTL, so an agent that stops reporting (for example, idle with nothing happening) loses its
  percentage until it next reports.
- The percentage is rounded down, so 79.9% is shown as `79%`, in the 50-79% colour.
- Each report uses the millisecond clock as its `--seq`, so an older detached call can't overwrite a newer value.
- Tests: `node --test`.
- To uninstall cleanly: disconnect each agent (see its section), run `clear`,
  `herdr plugin unlink harrisonhjones.herdr-tui-agents-ctx`, and remove the `$ctx_*` entries from your config.

## Agents

### Claude Code

Claude Code passes its status line command a JSON blob on stdin that includes `context_window.used_percentage`, the
exact figure for both 200k and 1M windows. `agents-ctx.js claude-statusline` wraps your existing status line command:
it runs it with the same stdin, so its output and exit status pass straight through to Claude, and then reports the
percentage.

**Connect** by putting `node /path/to/this/folder/agents-ctx.js claude-statusline` in front of your current
`statusLine.command` in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node /path/to/this/folder/agents-ctx.js claude-statusline <your current status line command>"
}
```

With no command after `claude-statusline`, it prints nothing and only reports. Running Claude sessions pick up the
change without a restart. If `node` isn't on the PATH Claude runs its status line with, use its absolute path
(`which node`).

**Disconnect** by restoring your original `statusLine.command`.

**Idle sessions:** Claude Code only runs the status line on events (a new message, `/compact`, a permission or vim mode
change), so a session left idle stops reporting and its percentage disappears after the 10-minute token TTL. To keep it
showing, add [`refreshInterval`](https://code.claude.com/docs/en/statusline) (seconds) to the same `statusLine` block, so
Claude re-runs the command on a timer even when idle:

```json
"statusLine": {
  "type": "command",
  "command": "node /path/to/this/folder/agents-ctx.js claude-statusline <your current status line command>",
  "refreshInterval": 120
}
```

Keep it well under 10 minutes. An unchanged value is only re-sent once it is 5 minutes old, so any interval up to about
4 minutes keeps the token alive. Each run also starts your original status line command, so don't set it lower than you
need.

**Latency:** the wrapper adds Node's startup time (tens of milliseconds on Linux) on top of your original status line
command, and Claude waits for both. Nothing is cached. If the original is slow enough that Claude stops showing the
status line, a cache could be added: print the session's previous output at once, with `Context: NN%` updated to the
current value, and re-run the original in a detached process to refresh it.

### Adding an agent

An adapter needs a way to run code inside the agent's pane whenever its context usage changes (a status line, a hook,
a plugin), and a way to read the used percentage there. To add one:

1. Add a mode to `agents-ctx.js` (for example `kiro-hook`) that gets the percentage and calls
   `report(process.env.HERDR_PANE_ID, pct)`. If it wraps something the agent runs, pass its output through unchanged,
   and don't let a failed report break it.
2. Add a test to `test.js`.
3. Add a section under [Agents](#agents) covering where the percentage comes from, and how to connect and disconnect.

## License

MIT. See [LICENSE](LICENSE).
