#!/usr/bin/env python3
"""Fetch wind actuals (FUELHH) and wind forecasts (WINDFOR) from Elexon BMRS and write the snapshot.

    pip install requests
    python scripts/ingest.py                       # delivery days 2026-01-02 .. 2026-02-01

Why those dates: purchases are made on D-1, so decisions "made in January 2026" cover
delivery days 2 Jan to 1 Feb. Change with --delivery-start / --delivery-end.

Output (backend/data/snapshot/):
    actuals.csv    startTime,generation
    forecasts.csv  startTime,publishTime,generation   (only forecasts 0-48 h ahead of their target)
    meta.json      provenance, row counts, forecast issue times
The script REFUSES to write a snapshot that is empty or under 95% complete (override: --allow-incomplete),
so a half-fetched dataset can't silently replace a good one. No API key is needed.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from collections import Counter
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path

import requests

BASE = "https://data.elexon.co.uk/bmrs/api/v1"
UTC = timezone.utc
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "backend" / "data" / "snapshot"
MAX_HORIZON_H = 48
MIN_COVERAGE = 0.95


class RangeRejected(Exception):
    """The API refused the window (HTTP 400): split it and retry."""


def ts(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ")


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def good_mw(value) -> bool:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(x) and x >= 0


def get_json(session, dataset: str, params: dict):
    url = f"{BASE}/datasets/{dataset}/stream"
    for attempt in range(5):
        try:
            resp = session.get(url, params=params, timeout=90)
        except requests.RequestException as exc:
            err = str(exc)
        else:
            if resp.status_code == 200:
                body = resp.json()
                return body["data"] if isinstance(body, dict) and "data" in body else body
            if resp.status_code == 400:
                raise RangeRejected(resp.text[:200])
            err = f"HTTP {resp.status_code}"
        wait = 2 ** attempt
        print(f"  retry {attempt + 1}/5 after {err} (waiting {wait}s)", file=sys.stderr)
        time.sleep(wait)
    raise SystemExit(f"Giving up on {dataset} {params}. Check your connection and the Elexon API status.")


def fetch_window(session, dataset, start: datetime, end: datetime):
    """Fetch [start, end) by publish time; if the API rejects the range, split it in half."""
    params = {"publishDateTimeFrom": ts(start), "publishDateTimeTo": ts(end)}
    try:
        return get_json(session, dataset, params)
    except RangeRejected as exc:
        if end - start <= timedelta(hours=1):
            raise SystemExit(f"{dataset} rejected even a 1-hour window: {exc}")
        mid = start + (end - start) / 2
        return fetch_window(session, dataset, start, mid) + fetch_window(session, dataset, mid, end)


def chunks(start: datetime, end: datetime, step: timedelta):
    while start < end:
        yield start, min(start + step, end)
        start += step


def atomic_csv(path: Path, header: list[str], rows):
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    tmp.replace(path)


def run(delivery_start: date, delivery_end: date, session, out_dir: Path = DEFAULT_OUT,
        chunk_hours: int = 24, allow_incomplete: bool = False, log=print) -> dict:
    first = datetime.combine(delivery_start, dtime(0), tzinfo=UTC)
    last_excl = datetime.combine(delivery_end + timedelta(days=1), dtime(0), tzinfo=UTC)
    step = timedelta(hours=chunk_hours)
    expected = (delivery_end - delivery_start).days * 48 + 48

    # ---- actuals: FUELHH, fuelType WIND -------------------------------------
    log("Fetching actual wind generation (FUELHH)...")
    actuals: dict[datetime, tuple[datetime, float]] = {}      # startTime -> (publishTime, MW); latest publish wins
    for a, b in chunks(first, last_excl + timedelta(hours=6), step):
        for row in fetch_window(session, "FUELHH", a, b):
            if row.get("fuelType") != "WIND" or not good_mw(row.get("generation")):
                continue
            start_t = parse(row["startTime"])
            pub = parse(row.get("publishTime", row["startTime"]))
            if first <= start_t < last_excl and (start_t not in actuals or pub >= actuals[start_t][0]):
                actuals[start_t] = (pub, float(row["generation"]))
        log(f"  {a:%Y-%m-%d %H:%M} -> {len(actuals)} half-hours so far")

    # ---- forecasts: WINDFOR ---------------------------------------------------
    log("Fetching wind forecasts (WINDFOR)...")
    forecasts: dict[tuple[datetime, datetime], float] = {}
    horizon = timedelta(hours=MAX_HORIZON_H)
    for a, b in chunks(first - horizon, last_excl, step):
        for row in fetch_window(session, "WINDFOR", a, b):
            if not good_mw(row.get("generation")):
                continue
            target, pub = parse(row["startTime"]), parse(row["publishTime"])
            if first <= target < last_excl and timedelta(0) <= target - pub <= horizon:
                forecasts[(target, pub)] = float(row["generation"])
        log(f"  {a:%Y-%m-%d %H:%M} -> {len(forecasts)} kept forecast rows so far")

    # ---- validate BEFORE writing anything ---------------------------------------
    targets = {t for t, _ in forecasts}
    hourly = bool(targets) and all(t.minute == 0 for t in targets)
    expected_targets = expected // 2 if hourly else expected
    issue_times = [f"{k}" for k, _ in Counter(p.strftime("%H:%M") for _, p in forecasts).most_common(8)]
    problems = []
    if not actuals:
        problems.append("No WIND rows came back from FUELHH.")
    if not forecasts:
        problems.append("No usable forecasts came back from WINDFOR.")
    if actuals and len(actuals) < MIN_COVERAGE * expected:
        problems.append(f"Actuals are only {len(actuals)} of {expected} half-hours.")
    if forecasts and len(targets) < MIN_COVERAGE * expected_targets:
        problems.append(f"Forecasts cover only {len(targets)} of {expected_targets} target times.")
    if problems and not allow_incomplete:
        raise SystemExit("Not writing a snapshot:\n  " + "\n  ".join(problems) +
                         "\nCheck your dates and the Elexon API status, or pass --allow-incomplete to write it anyway.")

    # ---- write -----------------------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    atomic_csv(out_dir / "actuals.csv", ["startTime", "generation"], ((iso(t), v[1]) for t, v in sorted(actuals.items())))
    atomic_csv(out_dir / "forecasts.csv", ["startTime", "publishTime", "generation"],
               ((iso(t), iso(p), g) for (t, p), g in sorted(forecasts.items())))
    stats = {"actuals": len(actuals), "actuals_expected": expected, "forecast_rows": len(forecasts),
             "targets": len(targets), "targets_expected": expected_targets, "hourly": hourly,
             "issue_times_utc": issue_times, "problems": problems}
    (out_dir / "meta.json").write_text(json.dumps({
        "synthetic": False,
        "source": "Elexon BMRS Insights API (FUELHH fuelType=WIND, WINDFOR)",
        "endpoints": [f"{BASE}/datasets/FUELHH/stream", f"{BASE}/datasets/WINDFOR/stream"],
        "delivery_start": delivery_start.isoformat(), "delivery_end": delivery_end.isoformat(),
        "generated_at": iso(datetime.now(UTC)),
        "rows": {"actuals": len(actuals), "forecasts": len(forecasts)},
        "forecast_resolution": "hourly" if hourly else "half-hourly",
        "issue_times": issue_times,
    }, indent=2))

    log(f"\nWrote {out_dir}\n  actuals:   {len(actuals)} of {expected} expected half-hours")
    log(f"  forecasts: {len(forecasts)} rows covering {len(targets)} target times "
        f"({'hourly, on the hour only' if hourly else 'half-hourly'})")
    log(f"  forecasts are issued at (UTC, most common first): {', '.join(issue_times)}")
    if hourly:
        log("  NOTE: WINDFOR is hourly. The app applies each forecast to both half-hours of its hour.")
    for p in problems:
        log(f"  WARNING: {p}")
    log("Next: restart the backend and check the sample banner is gone.")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delivery-start", type=date.fromisoformat, default=date(2026, 1, 2))
    ap.add_argument("--delivery-end", type=date.fromisoformat, default=date(2026, 2, 1))
    ap.add_argument("--chunk-hours", type=int, default=24, help="size of each API request window")
    ap.add_argument("--allow-incomplete", action="store_true", help="write the snapshot even if coverage is under 95%%")
    args = ap.parse_args()
    session = requests.Session()
    session.headers["Accept"] = "application/json"
    run(args.delivery_start, args.delivery_end, session, DEFAULT_OUT, args.chunk_hours, args.allow_incomplete)


if __name__ == "__main__":
    main()
