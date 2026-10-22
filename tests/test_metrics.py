"""Tests for context-economy metrics (stdlib unittest — no dev dependencies).

Run:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dashboard"))
import metrics  # noqa: E402


def build_db(path: str) -> str:
    con = sqlite3.connect(path)
    con.executescript(
        """
        create table sessions(
            id text primary key, model text, message_count int, tool_call_count int,
            input_tokens int, output_tokens int, estimated_cost_usd real,
            started_at real, ended_at real);
        create table messages(
            session_id text, role text, tool_name text, content text,
            timestamp real, compacted int);
        create table session_model_usage(
            session_id text, task text, api_call_count int, input_tokens int,
            output_tokens int, cache_read_tokens int, estimated_cost_usd real,
            first_seen real);
        """
    )
    now = time.time()
    con.execute("insert into sessions values(?,?,?,?,?,?,?,?,?)",
                ("s1", "deepseek/x", 10, 4, 1000, 100, 0.5, now - 3600, now))
    con.execute("insert into sessions values(?,?,?,?,?,?,?,?,?)",
                ("s2", "strata", 3, 1, 500, 20, 0.0, now - 7200, now))
    for tool, n, size in (("terminal", 3, 3000), ("read_file", 2, 1000), ("patch", 1, 1000)):
        for _ in range(n):
            con.execute("insert into messages values(?,?,?,?,?,?)",
                        ("s1", "tool", tool, "x" * size, now - 600, 0))
    for _ in range(7):
        con.execute("insert into messages values(?,?,?,?,?,?)",
                    ("s2", "tool", "terminal", "y", now - 600, 1))
    con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?)",
                ("s1", "", 4, 1000, 100, 750, 0.5, now - 3600))
    con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?)",
                ("s1", "title_generation", 1, 100, 5, 0, 0.01, now - 3600))
    con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?)",
                ("s2", "", 2, 500, 20, 0, 0.0, now - 7200))
    con.commit()
    con.close()
    return path


def build_ctx(root: str) -> str:
    d = Path(root) / "ctx" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    (d / "stats-pid-1.json").write_text(json.dumps({
        "total_calls": 3, "bytes_returned": 300, "bytes_indexed": 900,
        "kept_out": 400, "updated_at": int(time.time() * 1000),
        "by_tool": {"ctx_execute_file": {"calls": 2, "bytes": 200},
                    "ctx_index": {"calls": 1, "bytes": 100}},
    }), encoding="utf-8")
    (d / "stats-pid-2.json").write_text(json.dumps({
        "total_calls": 1, "bytes_returned": 50, "bytes_indexed": 0,
        "kept_out": 0, "updated_at": 0,
        "by_tool": {"ctx_execute_file": {"calls": 1, "bytes": 50}},
    }), encoding="utf-8")
    return str(Path(root) / "ctx")


class MetricsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = build_db(os.path.join(self.tmp, "state.db"))
        self.ctx = build_ctx(self.tmp)

    def con(self):
        return metrics._connect_ro(self.db)

    def test_range_mapping(self):
        self.assertEqual(metrics.range_days("24h"), 1)
        self.assertEqual(metrics.range_days("7d"), 7)
        self.assertEqual(metrics.range_days("30d"), 30)
        self.assertEqual(metrics.range_days("nonsense"), 7)
        self.assertEqual(metrics.range_days(None), 7)

    def test_tool_payload(self):
        con = self.con()
        rows = metrics.tool_payload(con, time.time() - 86400)
        con.close()
        self.assertEqual(rows[0]["tool"], "terminal")
        self.assertEqual(rows[0]["bytes"], 9007)  # 3 × 3000 + 7 folded rows
        self.assertAlmostEqual(rows[0]["pct"], 75.0, delta=0.5)
        self.assertAlmostEqual(sum(r["pct"] for r in rows), 100.0, places=1)

    def test_usage_totals(self):
        con = self.con()
        tot = metrics.usage_totals(con, time.time() - 86400)
        con.close()
        self.assertEqual(tot["input"], 1600)
        self.assertEqual(tot["output"], 125)
        self.assertEqual(tot["api_calls"], 7)
        self.assertAlmostEqual(tot["cache_pct"], 31.9, places=1)  # 750 / (1600 + 750)
        tasks = {t["task"] for t in tot["by_task"]}
        self.assertIn("main", tasks)
        self.assertIn("title_generation", tasks)

    def test_folds_by_day(self):
        con = self.con()
        days = metrics.folds_by_day(con, time.time() - 86400)
        con.close()
        self.assertEqual(sum(d["folded"] for d in days), 7)

    def test_sessions_carry_folded(self):
        con = self.con()
        rows = metrics.session_rows(con, time.time() - 86400)
        con.close()
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(by_id["s2"]["folded"], 7)
        self.assertEqual(by_id["s1"]["model"], "deepseek/x")

    def test_sandbox_aggregates(self):
        sb = metrics.sandbox_stats(self.ctx)
        self.assertEqual(sb["calls"], 4)
        self.assertEqual(sb["returned"], 350)
        self.assertEqual(sb["indexed"], 900)
        self.assertEqual(sb["kept_out"], 400)
        self.assertEqual(sb["files"], 2)
        self.assertEqual(sb["by_tool"][0],
                         {"tool": "ctx_execute_file", "calls": 3, "bytes": 250})

    def test_missing_db_is_graceful(self):
        out = metrics.snapshot(os.path.join(self.tmp, "nope.db"), None, "7d")
        self.assertIn("не знайдено", out["hermes"]["error"])
        self.assertEqual(out["sandbox"]["calls"], 0)

    def test_cost_split_cloud_vs_local(self):
        path = os.path.join(self.tmp, "cost.db")
        con = sqlite3.connect(path)
        con.executescript(
            """create table session_model_usage(
                   session_id text, task text, api_call_count int, input_tokens int,
                   output_tokens int, cache_read_tokens int, estimated_cost_usd real,
                   actual_cost_usd real, billing_provider text, first_seen real);"""
        )
        now = time.time()
        con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?,?,?)",
                    ("a", "", 1, 1000, 10, 0, 1.5, 0, "openrouter", now - 100))
        con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?,?,?)",
                    ("b", "", 1, 5000, 10, 0, 0.0, 0, "custom", now - 100))
        con.commit()
        con.close()
        ro = metrics._connect_ro(path)
        split = metrics.cost_split(ro, now - 86400)
        ro.close()
        self.assertAlmostEqual(split["cloud_cost"], 1.5, places=4)
        self.assertAlmostEqual(split["local_cost"], 0.0, places=4)
        self.assertEqual(split["cloud_input"], 1000)
        self.assertEqual(split["local_input"], 5000)
        self.assertFalse(split["actual_known"])

    def test_cache_economics_splits_cloud_and_local(self):
        path = os.path.join(self.tmp, "cache.db")
        con = sqlite3.connect(path)
        con.executescript(
            """create table session_model_usage(
                   session_id text, task text, api_call_count int, input_tokens int,
                   output_tokens int, cache_read_tokens int, estimated_cost_usd real,
                   actual_cost_usd real, billing_provider text, model text, first_seen real);"""
        )
        now = time.time()
        # 1M cached tokens on a cloud model: input 0.15, cache 0.003 per 1M -> 0.147 USD saved
        con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?,?,?,?)",
                    ("a", "", 1, 0, 0, 1_000_000, 0.5, 0, "openrouter", "cloud/model", now - 10))
        con.execute("insert into session_model_usage values(?,?,?,?,?,?,?,?,?,?,?)",
                    ("b", "", 1, 100, 0, 2_000_000, 0.0, 0, "custom", "local/model", now - 10))
        con.commit()
        con.close()
        pricing = {"cloud/model": {"input": 0.15, "cache_read": 0.003}}
        ro = metrics._connect_ro(path)
        econ = metrics.cache_economics(ro, now - 86400, pricing)
        ro.close()
        self.assertEqual(econ["cloud_tokens"], 1_000_000)
        self.assertEqual(econ["local_tokens"], 2_000_000)
        self.assertAlmostEqual(econ["cloud_saved_usd"], 0.147, places=4)
        self.assertTrue(econ["pricing_source"])
        self.assertEqual(econ["unpriced_cloud_tokens"], 0)

    def test_cache_economics_without_pricing_flags_tokens(self):
        path = os.path.join(self.tmp, "cache2.db")
        con = sqlite3.connect(path)
        con.executescript(
            """create table session_model_usage(
                   session_id text, cache_read_tokens int, input_tokens int,
                   estimated_cost_usd real, billing_provider text, model text, first_seen real);"""
        )
        con.execute("insert into session_model_usage values(?,?,?,?,?,?,?)",
                    ("a", 5_000_000, 0, 0.1, "openrouter", "mystery/model", time.time()))
        con.commit()
        con.close()
        ro = metrics._connect_ro(path)
        econ = metrics.cache_economics(ro, time.time() - 86400, {})
        ro.close()
        self.assertEqual(econ["cloud_saved_usd"], 0.0)
        self.assertEqual(econ["unpriced_cloud_tokens"], 5_000_000)

    def test_snapshot_shape(self):
        out = metrics.snapshot(self.db, self.ctx, "30d")
        self.assertEqual(out["range"], "30d")
        self.assertEqual(out["range_days"], 30)
        self.assertIsNone(out["hermes"]["error"])
        self.assertTrue(out["hermes"]["tools"])
        self.assertTrue(out["hermes"]["sessions"])
        self.assertEqual(out["sandbox"]["calls"], 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
