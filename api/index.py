"""Vercel entry point.

Vercel's Python runtime looks for an ASGI app called `app` in this file. The
real application lives in backend/main.py; this only puts that directory on the
import path and re-exports it, so there is exactly one copy of the app.

vercel.json routes only /api/* here. Everything else — the HTML, the fourteen
JavaScript files, the stylesheet, the favicon — is served straight from
Vercel's CDN, which is faster than routing it through Python and means the
static half of the site costs no function invocations at all.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from main import app  # noqa: E402  (path must be set before this import)

__all__ = ["app"]
