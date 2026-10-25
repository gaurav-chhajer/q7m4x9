"""Reads the data snapshot (CSV + meta.json) into a Dataset.

Real data lives in data/snapshot/ (written by scripts/ingest.py). If it is absent,
the app falls back to data/sample/ (synthetic) and flags it loudly via the API.
"""
from __future__ import annotations

import csv
import json
import math
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path

from .analysis import Dataset
from .config import DATA_ROOT

UTC = timezone.utc


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).astimezone(UTC)


def _aligned(t: datetime) -> bool:
    """Target times must sit on a half-hour boundary."""
    return t.minute in (0, 30) and t.second == 0 and t.microsecond == 0


def _valid_mw(x: float) -> bool:
    return math.isfinite(x) and x >= 0


def _read_actuals(path: Path):
    out, skipped = {}, 0
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                t, g = parse_ts(row["startTime"]), float(row["generation"])
            except (KeyError, ValueError, TypeError):
                skipped += 1
                continue
            if _aligned(t) and _valid_mw(g):
                out[t] = g
            else:
                skipped += 1
    return out, skipped


def _read_forecasts(path: Path):
    out, skipped = [], 0
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                t, pub, g = parse_ts(row["startTime"]), parse_ts(row["publishTime"]), float(row["generation"])
            except (KeyError, ValueError, TypeError):
                skipped += 1
                continue
            if _aligned(t) and _valid_mw(g):
                out.append((t, pub, g))
            else:
                skipped += 1
    return out, skipped


def load_dataset(folder: Path) -> Dataset:
    actuals, bad_a = _read_actuals(folder / "actuals.csv")
    forecasts, bad_f = _read_forecasts(folder / "forecasts.csv")
    meta_path = folder / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    if not actuals or not forecasts:
        raise RuntimeError(f"{folder} has no usable rows")
    if "delivery_start" in meta and "delivery_end" in meta:
        start, end = date.fromisoformat(meta["delivery_start"]), date.fromisoformat(meta["delivery_end"])
    else:  # infer from the actuals
        days = sorted({t.date() for t in actuals})
        start, end = days[0], days[-1]
    meta["skipped_rows"] = {"actuals": bad_a, "forecasts": bad_f}
    synthetic = bool(meta.get("synthetic")) or folder.name == "sample"
    return Dataset(actuals, forecasts, start, end, source="sample" if synthetic else "snapshot",
                   is_sample=synthetic, meta=meta)


@lru_cache(maxsize=1)
def get_dataset() -> Dataset:
    for name in ("snapshot", "sample"):
        folder = DATA_ROOT / name
        if (folder / "actuals.csv").exists() and (folder / "forecasts.csv").exists():
            try:
                return load_dataset(folder)
            except RuntimeError:
                continue
    raise RuntimeError("No data found. Run `python scripts/ingest.py` (real data) or `python scripts/make_sample.py`.")
