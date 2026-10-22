# Context Economy

**Where your context actually goes** — for Hermes Agent.

A desktop page and a compact pane that answer four questions with numbers from your
own database:

1. How many input tokens were spent, and what that cost.
2. Which tools produce the biggest payload (`terminal`, `read_file`, `skill_view`…).
3. How many messages the compressor folded, day by day.
4. How much of the prompt came from cache — and how much money that saved, split
   between billed cloud providers and local models.

Read-only by design: it opens `state.db` with `mode=ro`, never writes, and makes no
network calls.

## Screenshots

_Pending — added with the first catalog release._

## Install

The plugin lives in one folder under your Hermes home:

```bash
git clone https://github.com/cybernetic-ua/context-economy ~/.hermes/plugins/context-economy
hermes plugins enable context-economy
```

Then restart the gateway so the dashboard routes mount, and in the desktop app:

`Ctrl/Cmd+K` → **Reload desktop plugins**.

- The full view appears in the sidebar as **Context** (`/context-economy`).
- The compact pane docks to the right; drag its edge to resize.

## What it reads

| Source | Used for |
|---|---|
| `$HERMES_HOME/state.db` (`sessions`, `messages`, `session_model_usage`) | tokens, cost, tool payload, folds |
| `$HERMES_HOME/models_dev_cache.json` | per-model prices for cache savings |
| `~/.hermes/context-mode/sessions/stats-*.json` | optional `ctx_*` sandbox counters |

Nothing else. No telemetry, no outbound requests.

### Optional: context-mode

If the [`context-mode`](https://github.com/mksglu/context-mode) MCP server is
installed, the sandbox block shows its stats. Without it the block reports zeros —
that is expected, not a failure. There is no dependency in either direction.

## Metrics, precisely

| Metric | Definition |
|---|---|
| `tools[].bytes` | sum of `length(content)` over `role='tool'` messages in range |
| `tools[].pct` | share of that tool in total payload |
| `daily[].folded` | messages with `compacted=1`, per day |
| `totals.cache_pct` | `cache_read / (input + cache_read)` |
| `totals.cost_split.cloud_cost` | estimated spend on billed providers (openrouter, anthropic, openai, gemini…) |
| `totals.cache.cloud_saved_usd` | `cached_tokens / 1M × (input_price − cache_price)` from the models.dev snapshot |
| `totals.cache.local_tokens` | cached tokens on local models — `$0`, speed only |

**Known limits.** Per-message the database does not store tokens, so tool payload is
measured in **bytes** and labelled as bytes. Cost is an *estimate* from the local
price snapshot, not a provider invoice; `cost_split.actual_known` tells you whether a
provider returned a real figure. When a model has no published cache price, the
saving is not invented — its tokens are counted without money.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/plugins/context-economy/stats?range=7d` | full snapshot for the page |
| GET | `/api/plugins/context-economy/health` | db path, availability, ranges |

`range`: `24h` · `7d` · `30d` (default `7d`). Responses are cached for 2 s.

## Development

```
dashboard/metrics.py     — pure calculations, no FastAPI
dashboard/plugin_api.py  — thin router
desktop/plugin.js        — page + pane (jsx(), no build step, English-first i18n)
tests/test_metrics.py    — stdlib unittest, zero dev dependencies
```

```bash
python -m unittest discover -s tests -v
hermes plugins validate . --install-deps
```

## License

MIT — see [LICENSE](LICENSE).
