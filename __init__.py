"""context-economy — agent half.

The plugin ships no tools and no hooks: it exists to serve the panel backend
(``dashboard/plugin_api.py``) and to carry the desktop half
(``desktop/plugin.js``), which the desktop app copies into
``$HERMES_HOME/desktop-plugins/context-economy/``.
"""
from __future__ import annotations


def register(ctx):
    return None
