"""Pure metric computation for the Context Economy plugin.

Design rules:
  * read-only — connections use ``mode=ro``; nothing here writes.
  * degrade, never crash — a missing column or table yields a zero, not a 500.
  * no invented units — message payloads are BYTES; tokens come only from
    ``sessions``/``session_model_usage`` where the provider reported them.
"""
from __future__ import annotations

import glob
import json
import os
import sqlite3
import time
from typing import Any

RANGES = {"24h": 1, "7d": 7, "30d": 30}
DEFAULT_RANGE = "7d"


def range_days(key: str | None) -> int:
    return RANGES.get((key or DEFAULT_RANGE).lower(), RANGES[DEFAULT_RANGE])


def _connect_ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=3)


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    except sqlite3.Error:
        return set()


def _one(con: sqlite3.Connection, sql: str, params: tuple = ()) -> tuple:
    try:
        row = con.execute(sql, params).fetchone()
        return row or tuple()
    except sqlite3.Error:
        return tuple()


# ── context-mode sandbox stats ───────────────────────────────────────────────
def sandbox_stats(ctx_dir: str | None) -> dict[str, Any]:
    out = {"calls": 0, "returned": 0, "indexed": 0, "kept_out": 0,
           "live": 0, "files": 0, "by_tool": []}
    if not ctx_dir:
        return out
    sessions_dir = os.path.join(ctx_dir, "sessions")
    now_ms = int(time.time() * 1000)
    tools: dict[str, dict] = {}
    for path in glob.glob(os.path.join(sessions_dir, "stats-pid-*.json")):
        out["files"] += 1
        try:
            with open(path, "r", encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        out["calls"] += d.get("total_calls") or 0
        out["returned"] += d.get("bytes_returned") or 0
        out["indexed"] += d.get("bytes_indexed") or 0
        out["kept_out"] += d.get("kept_out") or 0
        mtime = d.get("updated_at") or int(os.path.getmtime(path) * 1000)
        if now_ms - mtime < 120_000:
            out["live"] += 1
        for name, t in (d.get("by_tool") or {}).items():
            agg = tools.setdefault(name, {"calls": 0, "bytes": 0})
            agg["calls"] += t.get("calls") or 0
            agg["bytes"] += t.get("bytes") or 0
    out["by_tool"] = sorted(({"tool": k, **v} for k, v in tools.items()),
                            key=lambda x: x["bytes"], reverse=True)
    return out


# ── Hermes state.db ──────────────────────────────────────────────────────────
def tool_payload(con: sqlite3.Connection, since: float) -> list[dict]:
    rows = []
    try:
        for tool, calls, payload in con.execute(
            """select coalesce(tool_name,'unknown') t, count(*) n, sum(length(coalesce(content,''))) b
                 from messages
                where timestamp >= ? and role = 'tool'
                group by t order by b desc""", (since,)):
            rows.append({"tool": tool, "calls": calls or 0, "bytes": payload or 0})
    except sqlite3.Error:
        return []
    total = sum(r["bytes"] for r in rows) or 1
    for r in rows:
        r["pct"] = round(100.0 * r["bytes"] / total, 1)
    return rows


def folds_by_day(con: sqlite3.Connection, since: float) -> list[dict]:
    cols = _columns(con, "messages")
    if "compacted" not in cols:
        return []
    try:
        rows = con.execute(
            """select date(timestamp,'unixepoch','localtime') d,
                      sum(case when compacted=1 then 1 else 0 end) folded
                 from messages where timestamp >= ? group by d order by d""", (since,)).fetchall()
    except sqlite3.Error:
        return []
    return [{"date": d, "folded": int(n or 0)} for d, n in rows]


CLOUD_PROVIDERS = {"openrouter", "anthropic", "openai", "gemini", "google",
                   "xai", "mistral", "deepinfra", "groq", "together", "fireworks"}


def cost_split(con: sqlite3.Connection, since: float) -> dict[str, Any]:
    """Split spend into billed cloud vs local (free) — the number users act on."""
    out = {"cloud_cost": 0.0, "local_cost": 0.0, "cloud_input": 0,
           "local_input": 0, "actual_known": False}
    cols = _columns(con, "session_model_usage")
    if "billing_provider" not in cols:
        return out
    try:
        rows = con.execute(
            """select coalesce(billing_provider,''), coalesce(sum(estimated_cost_usd),0),
                      coalesce(sum(input_tokens),0), coalesce(sum(actual_cost_usd),0)
                 from session_model_usage where first_seen >= ? group by 1""", (since,)).fetchall()
    except sqlite3.Error:
        return out
    actual_total = 0.0
    for provider, cost, tokens, actual in rows:
        actual_total += float(actual or 0)
        if str(provider).lower() in CLOUD_PROVIDERS:
            out["cloud_cost"] += float(cost or 0)
            out["cloud_input"] += int(tokens or 0)
        else:
            out["local_cost"] += float(cost or 0)
            out["local_input"] += int(tokens or 0)
    out["cloud_cost"] = round(out["cloud_cost"], 4)
    out["local_cost"] = round(out["local_cost"], 4)
    out["actual_known"] = actual_total > 0
    return out


def load_pricing(path: str | None) -> dict[str, dict]:
    """models.dev snapshot → {model_id: {input, cache_read}} in $ per 1M tokens."""
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    index: dict[str, dict] = {}
    for provider, pdata in (data or {}).items():
        if not isinstance(pdata, dict):
            continue
        for model_id, m in (pdata.get("models") or {}).items():
            cost = (m or {}).get("cost") or {}
            inp = cost.get("input")
            if inp is None:
                continue
            index[model_id] = {
                "input": float(inp),
                "cache_read": (float(cost["cache_read"]) if cost.get("cache_read") is not None else None),
                "provider": provider,
            }
    return index


def cache_economics(con: sqlite3.Connection, since: float,
                    pricing: dict[str, dict]) -> dict[str, Any]:
    """Cache reads split cloud vs local, plus the money cloud caching actually saved.

    saved = cache_tokens/1M × (input_price − cache_read_price); when a model has no
    published cache_read price we fall back to input_price × cache_tokens (upper bound
    only if the provider bills cached tokens at all — flagged via ``priced: false``).
    """
    out = {"cloud_tokens": 0, "local_tokens": 0, "cloud_saved_usd": 0.0,
           "unpriced_cloud_tokens": 0, "by_model": [], "pricing_source": bool(pricing)}
    cols = _columns(con, "session_model_usage")
    if not {"cache_read_tokens", "input_tokens"} <= cols:
        return out
    prov_col = "billing_provider" if "billing_provider" in cols else "''"
    try:
        rows = con.execute(
            f"""select coalesce(model,'?'), coalesce({prov_col},''),
                       coalesce(sum(cache_read_tokens),0), coalesce(sum(input_tokens),0),
                       coalesce(sum(estimated_cost_usd),0)
                  from session_model_usage where first_seen >= ?
                 group by 1,2 order by 3 desc""", (since,)).fetchall()
    except sqlite3.Error:
        return out
    for model, provider, cache_tok, input_tok, spent in rows:
        is_cloud = str(provider).lower() in CLOUD_PROVIDERS
        price = pricing.get(model) or {}
        saved = 0.0
        priced = False
        if is_cloud and cache_tok:
            if price.get("input") is not None:
                inp = float(price["input"])
                cr = price.get("cache_read")
                saved = (cache_tok / 1_000_000) * (inp - float(cr)) if cr is not None else (cache_tok / 1_000_000) * inp
                priced = True
            else:
                out["unpriced_cloud_tokens"] += int(cache_tok)
        if is_cloud:
            out["cloud_tokens"] += int(cache_tok)
            out["cloud_saved_usd"] += saved
        else:
            out["local_tokens"] += int(cache_tok)
        out["by_model"].append({
            "model": model, "provider": provider or "local", "cloud": is_cloud,
            "cache_tokens": int(cache_tok), "input_tokens": int(input_tok),
            "spent_usd": round(float(spent or 0), 4),
            "saved_usd": round(saved, 4), "priced": priced,
        })
    out["cloud_saved_usd"] = round(out["cloud_saved_usd"], 4)
    return out


def usage_totals(con: sqlite3.Connection, since: float) -> dict[str, Any]:
    cols = _columns(con, "session_model_usage")
    if not cols:
        return {"input": 0, "output": 0, "cost": 0.0, "cache_read": 0,
                "api_calls": 0, "sessions": 0, "cache_pct": None, "by_task": []}
    row = _one(con, """select coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                              coalesce(sum(estimated_cost_usd),0), coalesce(sum(cache_read_tokens),0),
                              coalesce(sum(api_call_count),0), count(distinct session_id)
                         from session_model_usage where first_seen >= ?""", (since,))
    input_t, output_t, cost, cache, calls, sessions = (list(row) + [0] * 6)[:6] if row else [0] * 6
    out = {"input": input_t, "output": output_t, "cost": round(float(cost or 0), 4),
           "cache_read": cache, "api_calls": calls, "sessions": sessions,
           "cache_pct": (min(100.0, round(100.0 * cache / (input_t + cache), 1))
                         if (input_t + cache) else None),
           "by_task": []}
    try:
        for task, t_in, t_cost in con.execute(
            """select coalesce(nullif(task,''),'main') t, sum(input_tokens), sum(estimated_cost_usd)
                 from session_model_usage where first_seen >= ? group by t
                 order by sum(input_tokens) desc limit 8""", (since,)):
            out["by_task"].append({"task": task, "input": t_in or 0,
                                   "cost": round(float(t_cost or 0), 4)})
    except sqlite3.Error:
        pass
    return out


def session_rows(con: sqlite3.Connection, since: float, limit: int = 25) -> list[dict]:
    cols = _columns(con, "sessions")
    if not cols:
        return []
    folded = {}
    mcols = _columns(con, "messages")
    if "compacted" in mcols:
        try:
            for sid, n in con.execute(
                """select session_id, sum(case when compacted=1 then 1 else 0 end)
                     from messages where timestamp >= ? group by session_id""", (since,)):
                folded[sid] = int(n or 0)
        except sqlite3.Error:
            pass
    rows = []
    try:
        cur = con.execute(
            """select id, model, message_count, tool_call_count, input_tokens,
                      output_tokens, coalesce(estimated_cost_usd,0), started_at, ended_at
                 from sessions where started_at >= ? order by started_at desc limit ?""",
            (since, limit))
        for sid, model, msgc, toolc, tin, tout, cost, st, en in cur:
            dur = (en - st) if en else (time.time() - st)
            rows.append({
                "id": (sid or "")[:14],
                "model": model or "?",
                "messages": msgc or 0,
                "tools": toolc or 0,
                "input": tin or 0,
                "output": tout or 0,
                "cost": round(float(cost or 0), 4),
                "folded": folded.get(sid, 0),
                "minutes": round(dur / 60, 1),
                "started": time.strftime("%d.%m %H:%M", time.localtime(st)),
            })
    except sqlite3.Error:
        return []
    return rows


def snapshot(db_path: str, ctx_dir: str | None, range_key: str | None = DEFAULT_RANGE,
             limit: int = 25, pricing_path: str | None = None) -> dict[str, Any]:
    """One response object for the whole page. Never raises on a bad DB."""
    days = range_days(range_key)
    key = range_key if (range_key or "").lower() in RANGES else DEFAULT_RANGE
    out: dict[str, Any] = {
        "range": key, "range_days": days,
        "generated_at": time.strftime("%d.%m.%Y %H:%M:%S"),
        "hermes": {"error": None, "totals": {}, "tools": [], "sessions": [], "daily": []},
        "sandbox": sandbox_stats(ctx_dir),
        "db": db_path,
    }
    if not db_path or not os.path.exists(db_path):
        out["hermes"]["error"] = f"state.db не знайдено: {db_path}"
        return out
    pricing = load_pricing(pricing_path)
    try:
        con = _connect_ro(db_path)
    except sqlite3.Error as exc:
        out["hermes"]["error"] = f"не вдалось відкрити базу: {exc}"
        return out
    try:
        since = time.time() - days * 86400
        out["hermes"]["totals"] = usage_totals(con, since)
        out["hermes"]["totals"]["cost_split"] = cost_split(con, since)
        out["hermes"]["totals"]["cache"] = cache_economics(con, since, pricing)
        out["hermes"]["tools"] = tool_payload(con, since)
        out["hermes"]["sessions"] = session_rows(con, since, limit)
        out["hermes"]["daily"] = folds_by_day(con, since)
    except sqlite3.Error as exc:  # pragma: no cover - defensive
        out["hermes"]["error"] = f"помилка читання: {exc}"
    finally:
        con.close()
    return out
