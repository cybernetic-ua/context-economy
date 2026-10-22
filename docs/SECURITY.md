# Security and privacy

## What the plugin touches

| Surface | Access | Notes |
|---|---|---|
| `$HERMES_HOME/state.db` | **read-only**, `sqlite3.connect("file:…?mode=ro")` | no writes, no schema changes, no locks taken beyond SQLite's own |
| `$HERMES_HOME/models_dev_cache.json` | read | price snapshot Hermes maintains |
| `~/.hermes/context-mode/sessions/stats-*.json` | read, optional | absent files are not an error |
| Network | **none** | zero outbound requests, no telemetry, no update checks |

The plugin never reads credentials, `.env`, `config.yaml`, session transcripts or
message bodies. Only aggregate columns and `LENGTH(content)` are queried — the text
itself is never selected.

## Privileges it does not take

- No tools, no hooks, no middleware: `capabilities` is empty, so the plugin cannot
  intercept a model call or a tool result.
- No core overrides, no prototype patching, no `eval` / `new Function`, no `import()`
  of anything but `@hermes/plugin-sdk` and `react`. Verified by
  `hermes plugins validate` (`no core override`, `desktop surface` checks).
- No filesystem writes anywhere at runtime; the only write is the pane width and the
  refresh interval in the renderer's `localStorage`.

## Trust boundary of the numbers

Everything displayed comes from local files that Hermes itself writes. If those files
are wrong, the panel is wrong in exactly the same way — it does not "correct" or
re-derive upstream values. Cost is explicitly labelled an estimate whenever the
provider did not return an actual figure.

## Deletion

Removing the plugin leaves nothing behind: no database tables, no state files, no
background processes. `hermes plugins remove context-economy` and the two
`localStorage` keys (`context-economy:paneWidth`) are all that exist.
