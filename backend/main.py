import math
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from physics.data import (
    GRAV_CONSTANT,
    GRAV_ACCEL,
    CHAPTERS,
    CHAPTER_VARIABLES,
    VARIABLE_NAMES,
    TIPS,
    MARGINALIA,
    REFERENCE,
    REFERENCE_SOURCE,
    INERTIA_BODIES,
    INERTIA_THEOREMS,
)
from physics.solvers import SOLVERS

app = FastAPI(title="MechanicsMania")

# The frontend ships about 1.5 MB of unminified JavaScript, and there is no
# build step to shrink it. Compressing on the way out costs one line and takes
# far more off the wire than any amount of hand-trimming would, without
# touching a byte of the source a reader might want to look at.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SolveRequest(BaseModel):
    chapter: str
    solveFor: str
    knowns: dict


from fastapi.responses import FileResponse

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    """Browsers probe /favicon.ico regardless of what the page declares, and an
    unanswered probe is a 404 in the log on every single visit. Serve the SVG:
    every browser this app targets renders it, and it saves shipping a second
    copy of the same drawing in a legacy format."""
    return FileResponse(FRONTEND_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/config")
def get_config():
    return {
        # The frontend must never carry its own copy of g: animations, the
        # setup wizard and the solvers all have to agree on one value.
        "gravity": GRAV_ACCEL,
        # Big G travels with little g for the same reason: three frontend
        # files each carried their own 6.674e-11, so changing the backend
        # value would leave a substitution line disagreeing with the
        # answer printed beside it.
        "gravConstant": GRAV_CONSTANT,
        "chapters": CHAPTERS,
        "chapterVariables": CHAPTER_VARIABLES,
        "variableNames": VARIABLE_NAMES,
        "tips": TIPS,
        "marginalia": MARGINALIA,
        "reference": REFERENCE,
        "referenceSource": REFERENCE_SOURCE,
        "inertiaBodies": INERTIA_BODIES,
        "inertiaTheorems": INERTIA_THEOREMS,
    }


@app.post("/api/solve")
def solve(req: SolveRequest):
    solver = SOLVERS.get(req.chapter)
    if solver is None:
        return {"ok": False, "message": f"Unknown chapter '{req.chapter}'."}

    # A physically impossible input should read as "cannot be solved", never as
    # a crashed request. Python returns a COMPLEX number for a negative base
    # raised to a fractional power, which then fails to serialise and produced
    # a 500; a zero denominator did the same. Individual guards catch these at
    # the source, and this is the backstop for any arithmetic edge left.
    try:
        result = solver(req.knowns, req.solveFor)
    except (ZeroDivisionError, ValueError, TypeError, OverflowError):
        result = None

    if isinstance(result, dict) and isinstance(result.get("solution"), complex):
        result = None

    # inf and nan serialise to invalid JSON, so returning one raised AFTER the
    # guard above and surfaced to the reader as "could not reach the solver" --
    # blaming the server for what is really an out-of-range input.
    if isinstance(result, dict) and not math.isfinite(result.get("solution", 0)):
        return {
            "ok": False,
            "message": "Those numbers overflow what the calculator can represent. Try values closer to everyday scale.",
        }

    if result is None:
        return {
            "ok": False,
            "message": "You haven't given enough values to calculate this yet. Try filling in a few more.",
        }

    return {
        "ok": True,
        "solveFor": req.solveFor,
        "variableName": VARIABLE_NAMES.get(req.solveFor, req.solveFor),
        **result,
    }


DEV_MODE = os.environ.get("MECHANICSMANIA_DEV", "").lower() in ("1", "true", "yes")


class TunedStaticFiles(StaticFiles):
    """Caching that suits whichever way this is being run.

    Under active edit, a cached app.js is a bug factory: you change a file, the
    browser serves the old one, and you debug a version that is not on disk. So
    development serves no-store.

    Deployed, the opposite is true. The frontend is about 1.5 MB unminified
    (roughly 410 KB once gzipped), and re-downloading all of it on every visit
    is the single largest avoidable cost a reader pays. index.html stays
    revalidated so a deploy is picked up immediately; everything it references
    is cached for a day.

    Set MECHANICSMANIA_DEV=1 for the development behaviour.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if DEV_MODE:
            response.headers["Cache-Control"] = "no-store"
        elif path in ("", "index.html"):
            # Always ask; a 304 is a few hundred bytes and it means a deploy is
            # live for everyone on their next navigation.
            response.headers["Cache-Control"] = "no-cache"
        else:
            response.headers["Cache-Control"] = "public, max-age=86400"
        return response


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", TunedStaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
