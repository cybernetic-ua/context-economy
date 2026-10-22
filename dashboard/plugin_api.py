"""API for the context-economy desktop plugin.

Routes mount under /api/plugins/context-economy/ inside the gateway process.
Read-only: every query runs against a mode=ro SQLite connection.
"""
from __future__ import annotations

import os
import time

from fastapi import APIRouter

try:  # loaded as part of a package
    from . import metrics
except ImportError:  # loaded as a standalone module file
    import importlib.util
    from pathlib import Path

    _spec = importlib.util.spec_from_file_location(
        "context_economy_metrics", Path(__file__).with_name("metrics.py"))
    metrics = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(metrics)  # type: ignore[union-attr]

router = APIRouter()

_CACHE: dict = {"key": None, "at": 0.0, "data": None}
_CACHE_TTL = 2.0


def _hermes_home() -> str:
    try:
        from hermes_cli.config import get_hermes_home  # type: ignore

        return str(get_hermes_home())
    except Exception:
        return os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")


def _state_db() -> str:
    explicit = os.environ.get("HERMES_STATE_DB")
    if explicit:
        return explicit
    return os.path.join(_hermes_home(), "state.db")


def _pricing_path() -> str:
    return os.path.join(_hermes_home(), "models_dev_cache.json")


def _ctx_dir() -> str:
    explicit = os.environ.get("CONTEXT_MODE_DIR")
    if explicit and os.path.isdir(os.path.join(explicit, "sessions")):
        return explicit
    home = os.path.expanduser("~/.hermes/context-mode")
    if os.path.isdir(os.path.join(home, "sessions")):
        return home
    alt = os.path.join(_hermes_home(), "context-mode")
    if os.path.isdir(os.path.join(alt, "sessions")):
        return alt
    return explicit or home


@router.get("/stats")
async def stats(range: str = metrics.DEFAULT_RANGE, limit: int = 200) -> dict:
    key = range.lower()
    cache_key = f"{key}:{limit}:{_state_db()}:{_ctx_dir()}"
    if _CACHE["data"] is not None and _CACHE["key"] == cache_key and time.time() - _CACHE["at"] < _CACHE_TTL:
        return _CACHE["data"]
    data = metrics.snapshot(_state_db(), _ctx_dir(), key, max(1, min(limit, 200)),
                            pricing_path=_pricing_path())
    _CACHE.update(key=cache_key, at=time.time(), data=data)
    return data


@router.get("/health")
async def health() -> dict:
    db = _state_db()
    return {
        "ok": os.path.exists(db),
        "db": db,
        "db_exists": os.path.exists(db),
        "ctx_dir": _ctx_dir(),
        "ranges": list(metrics.RANGES),
        "pricing": os.path.exists(_pricing_path()),
    }
