# Architecture

```
┌──────────────────────── desktop (renderer) ────────────────────────┐
│  desktop/plugin.js                                                 │
│    route  /context-economy   → full page (Shell dense=false)        │
│    nav    sidebar row        → "Context"                            │
│    pane   placement: right   → compact view (Shell dense=true)      │
│                                                                    │
│    useQuery(['context-economy', range]) ──> ctx.rest('/stats')      │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  /api/plugins/context-economy/*
┌────────────────────────────────▼───────────────────────────────────┐
│  dashboard/plugin_api.py — FastAPI router, 2 s response cache       │
│    GET /stats?range=24h|7d|30d                                      │
│    GET /health                                                      │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  plain functions, no framework
┌────────────────────────────────▼───────────────────────────────────┐
│  dashboard/metrics.py — snapshot(db, ctx_dir, range, limit, prices) │
│    tool_payload · usage_totals · cost_split · cache_economics        │
│    folds_by_day · session_rows · sandbox_stats                      │
└────────────────────────────────┬───────────────────────────────────┘
                                 │  sqlite3, mode=ro
        ┌────────────────────────┴───────────────────────┐
        ▼                                                ▼
  $HERMES_HOME/state.db                          ~/.hermes/context-mode/sessions/*.json
  sessions · messages · session_model_usage       (optional, context-mode MCP)
        ▲
        │ read-only, json
  $HERMES_HOME/models_dev_cache.json (prices)
```

## Why the split

`metrics.py` is pure: it takes a connection and a timestamp, returns dicts. That keeps
every number testable without FastAPI, without a gateway and without the app — the
suite builds a throwaway `state.db` in `tempfile` and asserts on real SQL.

`plugin_api.py` only does HTTP: resolve `$HERMES_HOME`, pick the range, cache the
snapshot for 2 s, degrade to zeros with an `error` string instead of a 500.

`desktop/plugin.js` only renders: no business logic, no SQL, no arithmetic beyond
formatting. It loads uncompiled, so it uses `jsx()` calls and inline styles with the
app's CSS variables (Tailwind never sees a plugin's class names at runtime).

## Data flow of one refresh

1. `useQuery` fires every *refresh interval* (3 s / 30 s / 3 min, user choice) and on
   range change.
2. `plugin_api` answers from its 2 s cache when warm; otherwise recomputes.
3. `metrics.snapshot()` opens `state.db` with `mode=ro` and reads four aggregates.
4. Rows are formatted in the renderer; `placeholderData: prev => prev` keeps the old
   snapshot on screen until the new one lands, so nothing flashes.

## Identity and isolation

One folder, both halves, one id (`context-economy`): `plugin.yaml` ↔ `desktop/plugin.js`
`export default { id }` ↔ `dashboard/manifest.json`. The app copies `desktop/plugin.js`
into `$HERMES_HOME/desktop-plugins/context-economy/`, which is what the renderer loads.

Under a named profile everything is per-profile: its own `plugins/`, its own
`desktop-plugins/`, its own `state.db`, its own gateway. Nothing is shared, and the
panel never sees another profile's numbers.
