"""Windward API. Thin HTTP layer over analysis.py; all maths lives there."""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import analysis
from .config import DEFAULT_CUTOFF
from .loader import get_dataset

CUTOFF_RE = r"^([01]\d|2[0-3]):[0-5]\d$"
router = APIRouter()


def _ds():
    try:
        return get_dataset()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _day(value: str, ds) -> date:
    try:
        d = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dates must look like YYYY-MM-DD.") from exc
    if not ds.window_start <= d <= ds.window_end:
        raise HTTPException(status_code=404, detail=f"No data for {d}. Delivery days available: "
                                                    f"{ds.window_start} to {ds.window_end}.")
    return d


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready():
    """Readiness: 200 only when a usable dataset is loaded (health only says the process is up)."""
    ds = _ds()
    if not ds.actuals or not ds.raw_forecast_rows:
        raise HTTPException(status_code=503, detail="Dataset is empty.")
    return {"status": "ready", "source": ds.source, "is_sample": ds.is_sample,
            "actual_slots": len(ds.actuals), "forecast_rows": ds.raw_forecast_rows}


@router.get("/meta")
def get_meta():
    return analysis.meta(_ds())


@router.get("/decision")
def get_decision(date: str, cutoff: str = Query(DEFAULT_CUTOFF, pattern=CUTOFF_RE),
                 confidence: float = Query(0.9, ge=0.5, le=0.99), demand_mw: float | None = Query(None, ge=0)):
    ds = _ds()
    return analysis.decision(ds, _day(date, ds), analysis.parse_cutoff(cutoff), confidence, demand_mw)


@router.get("/accuracy")
def get_accuracy(cutoff: str = Query(DEFAULT_CUTOFF, pattern=CUTOFF_RE), start: str | None = None, end: str | None = None):
    ds = _ds()
    s = _day(start, ds) if start else None
    e = _day(end, ds) if end else None
    if s and e and s > e:
        raise HTTPException(status_code=422, detail="start must be on or before end.")
    return analysis.accuracy(ds, analysis.parse_cutoff(cutoff), s, e)


@router.get("/vintages")
def get_vintages(target: str, cutoff: str = Query(DEFAULT_CUTOFF, pattern=CUTOFF_RE)):
    ds = _ds()
    try:
        t = datetime.fromisoformat(target.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="target must be an ISO timestamp.") from exc
    _day(t.date().isoformat(), ds)
    view = analysis.vintage_view(ds, t, analysis.parse_cutoff(cutoff))
    if view is None:
        raise HTTPException(status_code=404, detail="No forecasts for that half-hour.")
    return view


app = FastAPI(title="Windward API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.include_router(router, prefix="/api")
app.include_router(router, include_in_schema=False)   # same routes without /api, in case a host strips the prefix


@app.middleware("http")
async def cache_headers(request, call_next):
    """The snapshot is static, so let the CDN cache successful reads."""
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and "/docs" not in request.url.path:
        response.headers.setdefault("Cache-Control", "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400")
    return response
