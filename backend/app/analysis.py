"""Analysis core: pure Python, no web framework, no heavy dependencies.

Conventions
-----------
* error = forecast - actual. Positive means the forecast OVER-estimated wind,
  which is the risky direction for a buyer (they would be short of power).
* Delivery day D is bought on D-1. A forecast is usable only if its
  publishTime <= the cutoff on D-1. Anything published later is never used.
"""
from __future__ import annotations

import bisect
import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from .config import (
    DEFAULT_CUTOFF, HISTOGRAM_BIN_MW, HORIZON_BIN_H, LEVEL_EDGES_MW, MAPE_MIN_ACTUAL_MW,
    MAX_HORIZON_H, MIN_HISTORY_DAYS,
)

UTC = timezone.utc
SLOT = timedelta(minutes=30)
SLOTS_PER_DAY = 48


# ----------------------------------------------------------------- helpers
def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_cutoff(value: str) -> time:
    try:
        hh, mm = value.split(":")
        return time(int(hh), int(mm))
    except Exception as exc:  # noqa: BLE001
        raise ValueError("cutoff must look like HH:MM") from exc


def quantile(sorted_vals: list[float], q: float) -> float:
    """Linear-interpolated quantile of an already sorted list (same as numpy default)."""
    n = len(sorted_vals)
    if n == 0:
        raise ValueError("quantile of empty data")
    pos = (n - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def r1(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


@dataclass(frozen=True)
class Pair:
    day: date
    target: datetime
    forecast: float
    actual: float
    publish: datetime
    horizon_h: float

    @property
    def error(self) -> float:
        return self.forecast - self.actual


# ----------------------------------------------------------------- dataset
class Dataset:
    def __init__(self, actuals, forecasts, window_start: date, window_end: date, *,
                 source: str = "snapshot", is_sample: bool = False, meta: dict | None = None):
        self.actuals: dict[datetime, float] = dict(actuals)
        forecasts = list(forecasts)
        self.raw_forecast_rows = len(forecasts)
        # WINDFOR can be hourly while actuals are half-hourly. If every forecast starts on the hour,
        # apply each one to both half-hours of its hour so :30 slots are not left empty.
        self.forecast_resolution_min = 30
        if forecasts and all(t.minute == 0 for t, _, _ in forecasts):
            self.forecast_resolution_min = 60
            forecasts += [(t + SLOT, pub, gen) for t, pub, gen in forecasts]
        staged: dict[datetime, dict[datetime, float]] = {}
        for target, publish, gen in forecasts:
            staged.setdefault(target, {})[publish] = gen          # duplicate (target, publish): last wins
        self._f: dict[datetime, tuple[list[datetime], list[float]]] = {}
        for target, by_pub in staged.items():
            pubs = sorted(by_pub)
            self._f[target] = (pubs, [by_pub[p] for p in pubs])
        self.window_start, self.window_end = window_start, window_end
        self.source, self.is_sample, self.meta = source, is_sample, meta or {}
        self._pairs_cache: dict = {}
        self._vint_cache: dict = {}

    # time grid ----------------------------------------------------------
    def days(self) -> list[date]:
        n = (self.window_end - self.window_start).days + 1
        return [self.window_start + timedelta(days=i) for i in range(n)]

    @staticmethod
    def slots(day: date) -> list[datetime]:
        start = datetime.combine(day, time(0, 0), tzinfo=UTC)
        return [start + SLOT * i for i in range(SLOTS_PER_DAY)]

    @staticmethod
    def cutoff_dt(day: date, cutoff: time) -> datetime:
        """The decision moment for delivery day `day`: `cutoff` on the day before."""
        return datetime.combine(day - timedelta(days=1), cutoff, tzinfo=UTC)

    # forecast selection -------------------------------------------------
    def select(self, target: datetime, cutoff_at: datetime):
        """Latest forecast for `target` with publishTime <= cutoff_at, or None."""
        entry = self._f.get(target)
        if not entry:
            return None
        pubs, gens = entry
        i = bisect.bisect_right(pubs, cutoff_at) - 1      # inclusive of publishTime == cutoff
        return None if i < 0 else (pubs[i], gens[i])

    def vintages(self, target: datetime) -> list[tuple[datetime, float]]:
        pubs, gens = self._f.get(target, ([], []))
        return list(zip(pubs, gens))

    def pairs(self, cutoff: time, start: date | None = None, end: date | None = None) -> list[Pair]:
        start, end = start or self.window_start, end or self.window_end
        key = (cutoff, start, end)
        if key not in self._pairs_cache:
            out, d = [], start
            while d <= end:
                cut = self.cutoff_dt(d, cutoff)
                for t in self.slots(d):
                    actual = self.actuals.get(t)
                    sel = self.select(t, cut) if actual is not None else None
                    if sel:
                        out.append(Pair(d, t, sel[1], actual, sel[0], (t - sel[0]).total_seconds() / 3600))
                d += timedelta(days=1)
            self._pairs_cache[key] = out
        return self._pairs_cache[key]

    def vintage_errors(self, start: date, end: date) -> list[tuple[float, float]]:
        """(lead time in hours, forecast - actual) for EVERY published forecast, not just the cutoff one."""
        key = ("v", start, end)
        if key not in self._vint_cache:
            out = []
            for target, (pubs, gens) in self._f.items():
                actual = self.actuals.get(target)
                if actual is None or not start <= target.date() <= end:
                    continue
                for p, g in zip(pubs, gens):
                    h = (target - p).total_seconds() / 3600
                    if 0 <= h <= MAX_HORIZON_H:
                        out.append((h, g - actual))
            self._vint_cache[key] = out
        return self._vint_cache[key]

    def demo_target(self) -> datetime | None:
        """Noon slot whose forecasts were revised the most - makes the clearest story."""
        cutoff, best, best_spread = parse_cutoff(DEFAULT_CUTOFF), None, -1.0
        for d in self.days():
            t = datetime.combine(d, time(12, 0), tzinfo=UTC)
            vs = [g for p, g in self.vintages(t) if 0 <= (t - p).total_seconds() / 3600 <= MAX_HORIZON_H]
            if (t in self.actuals and len(vs) > 4 and self.select(t, self.cutoff_dt(d, cutoff))
                    and error_history(self, d, cutoff)[1] >= MIN_HISTORY_DAYS):
                spread = max(vs) - min(vs)
                if spread > best_spread:
                    best, best_spread = t, spread
        return best


# ----------------------------------------------------------------- metrics
def _stats(errors: list[float], actuals: list[float] | None = None) -> dict:
    n = len(errors)
    abs_sorted = sorted(abs(e) for e in errors)
    mae = sum(abs_sorted) / n
    out = {"n": n, "mae_mw": r1(mae), "bias_mw": r1(sum(errors) / n),
           "abs_p90_mw": r1(quantile(abs_sorted, 0.9))}
    if actuals:
        mean_actual = sum(actuals) / n
        out["mean_actual_mw"] = r1(mean_actual)
        out["nmae_pct"] = r1(mae / mean_actual * 100) if mean_actual > 0 else None
    return out


def summarize(pairs: list[Pair]) -> dict:
    n = len(pairs)
    if n == 0:
        return {"n": 0}
    errs = [p.error for p in pairs]
    acts = [p.actual for p in pairs]
    s_err, abs_sorted = sorted(errs), sorted(abs(e) for e in errs)
    mape_terms = [abs(p.error) / p.actual for p in pairs if p.actual >= MAPE_MIN_ACTUAL_MW]
    out = _stats(errs, acts)
    out.update({
        "mean_forecast_mw": r1(sum(p.forecast for p in pairs) / n),
        "rmse_mw": r1(math.sqrt(sum(e * e for e in errs) / n)),
        "mape_pct": r1(sum(mape_terms) / len(mape_terms) * 100) if mape_terms else None,
        "mape_excluded": n - len(mape_terms),
        "abs_p50_mw": r1(quantile(abs_sorted, 0.5)),
        "abs_p95_mw": r1(quantile(abs_sorted, 0.95)),
        "shortfall_p90_mw": r1(max(0.0, quantile(s_err, 0.9))),   # over-forecast risk
        "surplus_p90_mw": r1(max(0.0, -quantile(s_err, 0.1))),
        "over_forecast_pct": r1(sum(e > 0 for e in errs) / n * 100),
    })
    return out


def by_horizon(ds: Dataset, start: date, end: date) -> list[dict]:
    nbins = MAX_HORIZON_H // HORIZON_BIN_H
    bins: list[list[float]] = [[] for _ in range(nbins)]
    for h, e in ds.vintage_errors(start, end):
        bins[min(int(h // HORIZON_BIN_H), nbins - 1)].append(e)
    return [{"from": i * HORIZON_BIN_H, "to": (i + 1) * HORIZON_BIN_H,
             "mid": i * HORIZON_BIN_H + HORIZON_BIN_H / 2, **_stats(errs)}
            for i, errs in enumerate(bins) if errs]


def _group(pairs: list[Pair], keyfn) -> dict:
    groups: dict = {}
    for p in pairs:
        groups.setdefault(keyfn(p), []).append(p)
    return groups


def by_hour(pairs: list[Pair]) -> list[dict]:
    return [{"hour": h, **_stats([p.error for p in g], [p.actual for p in g])}
            for h, g in sorted(_group(pairs, lambda p: p.target.hour).items())]


def daily(pairs: list[Pair]) -> list[dict]:
    out = []
    for d, g in sorted(_group(pairs, lambda p: p.day).items()):
        s = _stats([p.error for p in g], [p.actual for p in g])
        s.update({"date": d.isoformat(), "mean_forecast_mw": r1(sum(p.forecast for p in g) / len(g))})
        out.append(s)
    return out


def distribution(pairs: list[Pair]) -> dict:
    counts: dict[int, int] = {}
    for p in pairs:
        k = math.floor(p.error / HISTOGRAM_BIN_MW)
        counts[k] = counts.get(k, 0) + 1
    bins = [{"from": k * HISTOGRAM_BIN_MW, "to": (k + 1) * HISTOGRAM_BIN_MW,
             "mid": k * HISTOGRAM_BIN_MW + HISTOGRAM_BIN_MW / 2, "count": counts[k]} for k in sorted(counts)]
    return {"bin_mw": HISTOGRAM_BIN_MW, "bins": bins}


def by_level(pairs: list[Pair]) -> list[dict]:
    edges = LEVEL_EDGES_MW + [math.inf]
    out = []
    for lo, hi in zip(edges, edges[1:]):
        g = [p for p in pairs if lo <= p.actual < hi]
        if g:
            label = f"{lo / 1000:g}+ GW" if hi == math.inf else f"{lo / 1000:g} to {hi / 1000:g} GW"
            out.append({"label": label, **_stats([p.error for p in g], [p.actual for p in g])})
    return out


def accuracy(ds: Dataset, cutoff: time, start: date | None = None, end: date | None = None) -> dict:
    start, end = start or ds.window_start, end or ds.window_end
    pairs = ds.pairs(cutoff, start, end)
    horizons = [p.horizon_h for p in pairs]
    return {
        "cutoff": cutoff.strftime("%H:%M"), "start": start.isoformat(), "end": end.isoformat(),
        "summary": summarize(pairs),
        "decision_horizon_h": {"min": r1(min(horizons)), "max": r1(max(horizons))} if horizons else None,
        "by_horizon": by_horizon(ds, start, end),
        "by_hour": by_hour(pairs),
        "daily": daily(pairs),
        "distribution": distribution(pairs),
        "by_level": by_level(pairs),
        "pairs": [[round(p.forecast), round(p.actual)] for p in pairs],
    }


# ----------------------------------------------------------------- decision
def error_history(ds: Dataset, day: date, cutoff: time) -> tuple[list[float], int]:
    """Past errors (actual - forecast) that were known when buying for `day`. Never uses later days.

    At the cutoff on D-1 the outturn for D-1 is unfinished, so only delivery days <= D-2 count.
    Returns (errors, number_of_days).
    """
    known = [p for p in ds.pairs(cutoff) if p.day <= day - timedelta(days=2)]
    return [p.actual - p.forecast for p in known], len({p.day for p in known})


def _band_quantiles(errors: list[float], confidence: float) -> tuple[float, float]:
    """(lower, upper) quantiles of actual - forecast. Clamped so the band always contains the forecast."""
    s = sorted(errors)
    return min(quantile(s, 1 - confidence), 0.0), max(quantile(s, confidence), 0.0)


def backtest(ds: Dataset, cutoff: time, confidence: float) -> dict | None:
    """Walk-forward check of the band: for every day with enough strictly-past history,
    how often did the actual land below / above the band built from that history?"""
    n = below = above = days = 0
    for d in ds.days():
        hist, hist_days = error_history(ds, d, cutoff)
        if hist_days < MIN_HISTORY_DAYS:
            continue
        lo_q, hi_q = _band_quantiles(hist, confidence)
        today = ds.pairs(cutoff, d, d)
        if not today:
            continue
        days += 1
        for p in today:
            e = p.actual - p.forecast
            n += 1
            below += e < lo_q
            above += e > hi_q
    if n == 0:
        return None
    return {"days": days, "half_hours": n, "below_band_pct": r1(below / n * 100),
            "above_band_pct": r1(above / n * 100), "target_pct": r1((1 - confidence) * 100)}


def decision(ds: Dataset, day: date, cutoff: time, confidence: float = 0.9,
             demand_mw: float | None = None) -> dict:
    cut = ds.cutoff_dt(day, cutoff)
    hist, hist_days = error_history(ds, day, cutoff)
    band = hist_days >= MIN_HISTORY_DAYS          # strict: too little past history means NO band, never future days
    lo_q = hi_q = 0.0
    if band:
        lo_q, hi_q = _band_quantiles(hist, confidence)
    buffer_mw = max(0.0, -lo_q) if band else None

    slots, missing_f, missing_a, pubs, horizons = [], 0, 0, [], []
    for t in ds.slots(day):
        sel, actual = ds.select(t, cut), ds.actuals.get(t)
        missing_a += actual is None
        row = {"time": iso(t), "forecast": None, "actual": r1(actual), "lower": None, "upper": None,
               "firm": None, "issued": None, "lead_h": None, "error": None}
        if sel is None:
            missing_f += 1
        else:
            publish, f = sel
            pubs.append(publish)
            horizons.append((t - publish).total_seconds() / 3600)
            firm = max(0.0, f - buffer_mw) if band else None
            row.update(forecast=r1(f), issued=iso(publish), lead_h=r1(horizons[-1]),
                       error=r1(f - actual) if actual is not None else None)
            if band:
                row.update(lower=r1(max(0.0, f + lo_q)), upper=r1(f + hi_q), firm=r1(firm))
                if demand_mw is not None:
                    row["procure"] = r1(max(0.0, demand_mw - f))
                    row["procure_safe"] = r1(max(0.0, demand_mw - firm))
        slots.append(row)

    have = [x for x in slots if x["forecast"] is not None]
    history = {"days": hist_days, "half_hours": len(hist), "required_days": MIN_HISTORY_DAYS}
    if not band:   # tell the UI when a band becomes possible instead of guessing
        first = next((d for d in ds.days() if error_history(ds, d, cutoff)[1] >= MIN_HISTORY_DAYS), None)
        history["first_band_date"] = first.isoformat() if first else None
    summary: dict = {
        "slots_with_forecast": len(have), "missing_forecast_slots": missing_f, "missing_actual_slots": missing_a,
        "cutoff_at": iso(cut), "confidence": confidence,
        "buffer_mw": r1(buffer_mw), "band_available": band, "history": history,
    }
    if band:
        summary["backtest"] = backtest(ds, cutoff, confidence)
    if have:
        fs = [x["forecast"] for x in have]
        peak, low = max(have, key=lambda x: x["forecast"]), min(have, key=lambda x: x["forecast"])
        summary.update({
            "avg_forecast_mw": r1(sum(fs) / len(fs)), "energy_mwh": r1(sum(fs) * 0.5),
            "avg_firm_mw": r1(sum(x["firm"] for x in have) / len(have)) if band else None,
            "firm_energy_mwh": r1(sum(x["firm"] for x in have) * 0.5) if band else None,
            "peak": {"time": peak["time"], "mw": peak["forecast"]},
            "trough": {"time": low["time"], "mw": low["forecast"]},
            "issued_first": iso(min(pubs)), "issued_last": iso(max(pubs)),
            "lead_h_min": r1(min(horizons)), "lead_h_max": r1(max(horizons)),
        })
        known = [x for x in have if x["actual"] is not None]
        if len(known) >= 40:                                   # outturn (almost) complete: hindsight check
            summary["realised"] = {
                "n": len(known),
                "mae_mw": r1(sum(abs(x["error"]) for x in known) / len(known)),
                "bias_mw": r1(sum(x["error"] for x in known) / len(known)),
                "within_band_pct": r1(sum(x["lower"] <= x["actual"] <= x["upper"] for x in known) / len(known) * 100)
                if band else None,
            }
        if demand_mw is not None and band:
            c, s_ = sum(x["procure"] for x in have), sum(x["procure_safe"] for x in have)
            summary["demand"] = {"demand_mw": demand_mw, "procure_mwh": r1(c * 0.5), "procure_safe_mwh": r1(s_ * 0.5),
                                 "extra_for_risk_mwh": r1((s_ - c) * 0.5),
                                 "avg_procure_mw": r1(c / len(have)), "avg_procure_safe_mw": r1(s_ / len(have))}
    return {"date": day.isoformat(), "cutoff": cutoff.strftime("%H:%M"), "slots": slots, "summary": summary}


def vintage_view(ds: Dataset, target: datetime, cutoff: time) -> dict | None:
    vs = [(p, g) for p, g in ds.vintages(target) if 0 <= (target - p).total_seconds() / 3600 <= MAX_HORIZON_H]
    if not vs:
        return None
    cut = ds.cutoff_dt(target.date(), cutoff)
    sel = ds.select(target, cut)
    actual = ds.actuals.get(target)
    return {
        "target": iso(target), "actual": r1(actual), "cutoff_at": iso(cut),
        "cutoff_horizon_h": r1((target - cut).total_seconds() / 3600),
        "chosen_publish": iso(sel[0]) if sel else None,
        "vintages": [{"publish": iso(p), "horizon_h": r1((target - p).total_seconds() / 3600), "generation": r1(g)}
                     for p, g in vs],
    }


def meta(ds: Dataset) -> dict:
    from .config import CUTOFF_OPTIONS
    window = [t for d in ds.days() for t in ds.slots(d)]
    demo = ds.demo_target()
    actual_vals = [ds.actuals[t] for t in window if t in ds.actuals]
    return {
        "source": ds.source, "is_sample": ds.is_sample, "snapshot": ds.meta,
        "delivery_start": ds.window_start.isoformat(), "delivery_end": ds.window_end.isoformat(),
        "default_cutoff": DEFAULT_CUTOFF, "cutoff_options": CUTOFF_OPTIONS, "max_horizon_h": MAX_HORIZON_H,
        "min_history_days": MIN_HISTORY_DAYS,
        "default_date": demo.date().isoformat() if demo else ds.window_start.isoformat(),
        "demo_target": iso(demo) if demo else None,
        "capacity_hint_mw": round(max(actual_vals)) if actual_vals else 15000,
        "quality": {
            "actual_slots": len(actual_vals), "expected_slots": len(window),
            "missing_actual_slots": len(window) - len(actual_vals),
            "forecast_rows": ds.raw_forecast_rows,
            "forecast_resolution_min": ds.forecast_resolution_min,
            "targets_with_forecast": sum(t in ds._f for t in window),
        },
    }
