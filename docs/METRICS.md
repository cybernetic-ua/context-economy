# Metrics

Every number on the panel, its exact definition, and where it can lie. Nothing here
is estimated unless the text says so.

## Sources

| Table / file | Columns used |
|---|---|
| `sessions` | `id, model, message_count, tool_call_count, input_tokens, output_tokens, estimated_cost_usd, started_at, ended_at` |
| `messages` | `session_id, role, tool_name, content, timestamp, compacted` |
| `session_model_usage` | `session_id, task, api_call_count, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, actual_cost_usd, billing_provider, model, first_seen` |
| `models_dev_cache.json` | `models[<id>].cost.{input,cache_read}` — $ per 1M tokens |
| `context-mode/sessions/stats-pid-*.json` | `total_calls, bytes_returned, bytes_indexed, kept_out, by_tool` |

## Tool payload

```sql
SELECT tool_name, SUM(LENGTH(content)) AS bytes
FROM messages
WHERE role = 'tool' AND timestamp >= :since
GROUP BY tool_name
ORDER BY bytes DESC;
```

`pct = bytes / SUM(bytes) × 100`.

**Bytes, not tokens.** The message row keeps no token count, so a byte figure is the
only honest measure here. It correlates with tokens (≈ 3.5–4 bytes per token for
English) but is never presented as tokens.

## Cost

`cost = SUM(session_model_usage.estimated_cost_usd)` over the range. Hermes computes
that value as *tokens × price from the local models.dev snapshot*. It is an estimate:

- `actual_cost_usd > 0` anywhere in range → `cost_split.actual_known = true`, and the
  UI says the cost is the provider's figure;
- otherwise the UI says "estimate".

### Cloud vs local

```python
CLOUD_PROVIDERS = {openrouter, anthropic, openai, gemini, google,
                   xai, mistral, deepinfra, groq, together, fireworks}
```

Rows whose `billing_provider` is in that set add to `cloud_cost` / `cloud_input`;
everything else (llama-swap, custom local endpoints) adds to `local_cost` /
`local_input`. Local models are not billed, so their cost is normally exactly `0.0` —
a non-zero value there means the provider declared a price, and it is shown as-is.

## Cache

```
cache_pct = cache_read / (input + cache_read) × 100     # clamped to 100
```

`cache_read` is counted separately from `input` by providers: on one real profile
`cache_read` was 262.7M against 25.2M fresh input (91% cache). Dividing by `input`
alone therefore produces meaningless figures like 1019% — hence the denominator above.

### Money saved by cache (cloud only)

```
saved_usd = (cache_tokens / 1_000_000) × (price.input − price.cache_read)
```

Prices come from the same `models_dev_cache.json` Hermes uses for cost. Example, real
values: `deepseek-v4.1-flash-1017` has `input 0.15`, `cache_read 0.003`; 92.8M cached
tokens → `92.8 × 0.147 = $13.64` not paid.

Rules that keep it honest:

- **no published `cache_read` price** → the amount is *not* invented; the tokens land
  in `unpriced_cloud_tokens` and are displayed without money;
- **local models** → `local_tokens` with `$0`, because caching there buys prefill
  speed, not money. That is a real benefit, just not a monetary one.

## Folds (compaction)

```sql
SELECT session_id, SUM(CASE WHEN compacted = 1 THEN 1 ELSE 0 END)
FROM messages WHERE timestamp >= :since GROUP BY session_id;
```

Daily buckets come from the same predicate grouped by date. A folded message is one
the compressor replaced with a summary — it no longer occupies the window. Fold count
is *not* a savings figure: the summary itself costs tokens.

## Sessions table

One row per `sessions` row started in range, newest first: `started_at` (local time,
`dd.MM HH:MM`), model, `input_tokens`, `output_tokens`, folded count. Input and output
are per session as recorded by Hermes, not recomputed.

## Sandbox (`ctx_*`)

`stats-pid-*.json` files are per MCP process and reset when the process restarts.
`calls`, `returned`, `kept_out`, `indexed` are summed across every file found. All
zeros means the `ctx_*` tools were not used in that window — not that the feature is
broken.

## Ranges

| `range` | Window |
|---|---|
| `24h` | last 24 hours |
| `7d` | last 7 days (default) |
| `30d` | last 30 days |

Unknown values fall back to `7d`. Timestamps are compared against
`time.time() - days × 86400`, so a "day" is 24 h of wall clock, not a calendar day;
the folds chart, however, buckets by local calendar date.
