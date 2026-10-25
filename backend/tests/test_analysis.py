"""Unit tests for the analysis core. Run: python -m unittest discover -s backend/tests -t backend
(or `pytest backend/tests`). Standard library only."""
import math
import tempfile
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from app import analysis as an
from app.analysis import Dataset, Pair, quantile
from app.loader import load_dataset

UTC = timezone.utc


def dt(day, hh=0, mm=0):
    return datetime(2026, 1, day, hh, mm, tzinfo=UTC)


def constant_error_dataset(errors_by_day: dict[int, float], last_day=8):
    """Every half-hour: actual 1000 MW; one forecast issued 08:00 on D-1 = 1000 + error[day]."""
    actuals, forecasts = {}, []
    for d in range(1, last_day + 1):
        for t in Dataset.slots(date(2026, 1, d)):
            actuals[t] = 1000.0
            forecasts.append((t, dt(d - 1, 8) if d > 1 else datetime(2025, 12, 31, 8, tzinfo=UTC),
                              1000.0 + errors_by_day.get(d, 0.0)))
    return Dataset(actuals, forecasts, date(2026, 1, 1), date(2026, 1, last_day))


class SelectionTests(unittest.TestCase):
    def setUp(self):
        t = dt(3)
        self.ds = Dataset({t: 500.0}, [(t, dt(2, 8, 0), 100.0), (t, dt(2, 9, 0), 200.0), (t, dt(2, 9, 30), 300.0)],
                          date(2026, 1, 3), date(2026, 1, 3))

    def test_latest_forecast_at_or_before_cutoff(self):
        self.assertEqual(self.ds.select(dt(3), dt(2, 9, 15))[1], 200.0)

    def test_publish_exactly_at_cutoff_is_usable(self):
        self.assertEqual(self.ds.select(dt(3), dt(2, 9, 0))[1], 200.0)

    def test_earlier_cutoff_gives_earlier_forecast(self):
        self.assertEqual(self.ds.select(dt(3), dt(2, 8, 59))[1], 100.0)

    def test_nothing_published_before_cutoff(self):
        self.assertIsNone(self.ds.select(dt(3), dt(2, 7, 0)))

    def test_cutoff_is_on_the_day_before_delivery(self):
        self.assertEqual(Dataset.cutoff_dt(date(2026, 1, 3), time(9, 0)), dt(2, 9, 0))

    def test_no_pair_ever_uses_a_forecast_published_after_the_cutoff(self):
        from app.config import DATA_ROOT
        ds = load_dataset(DATA_ROOT / "sample")
        for cutoff in (time(6, 0), time(9, 0), time(12, 0)):
            for p in ds.pairs(cutoff):
                self.assertLessEqual(p.publish, Dataset.cutoff_dt(p.day, cutoff))
                self.assertGreaterEqual(p.horizon_h, 0)


class MetricTests(unittest.TestCase):
    def test_quantile_matches_linear_interpolation(self):
        self.assertAlmostEqual(quantile([1, 2, 3, 4], 0.5), 2.5)
        self.assertAlmostEqual(quantile([1, 2, 3, 4], 0.9), 3.7)
        self.assertEqual(quantile([7], 0.9), 7)

    def test_summary_numbers(self):
        pairs = [Pair(date(2026, 1, 2), dt(2), f, 100.0, dt(1, 9), 15.0) for f in (110, 90, 120, 80)]
        s = an.summarize(pairs)
        self.assertEqual(s["n"], 4)
        self.assertAlmostEqual(s["mae_mw"], 15.0)
        self.assertAlmostEqual(s["rmse_mw"], round(math.sqrt(250), 1))
        self.assertAlmostEqual(s["bias_mw"], 0.0)
        self.assertAlmostEqual(s["nmae_pct"], 15.0)
        self.assertAlmostEqual(s["over_forecast_pct"], 50.0)

    def test_mape_skips_near_zero_actuals(self):
        pairs = [Pair(date(2026, 1, 2), dt(2), 60.0, 50.0, dt(1, 9), 15.0),
                 Pair(date(2026, 1, 2), dt(2, 0, 30), 220.0, 200.0, dt(1, 9), 15.5)]
        s = an.summarize(pairs)
        self.assertEqual(s["mape_excluded"], 1)
        self.assertAlmostEqual(s["mape_pct"], 10.0)

    def test_empty_summary(self):
        self.assertEqual(an.summarize([]), {"n": 0})

    def test_horizon_bins_use_every_published_forecast(self):
        t = dt(3)
        ds = Dataset({t: 100.0}, [(t, t - timedelta(hours=1), 110.0), (t, t - timedelta(hours=25), 150.0)],
                     date(2026, 1, 3), date(2026, 1, 3))
        bins = {b["from"]: b for b in an.by_horizon(ds, date(2026, 1, 3), date(2026, 1, 3))}
        self.assertEqual(bins[0]["bias_mw"], 10.0)
        self.assertEqual(bins[24]["bias_mw"], 50.0)


class DecisionTests(unittest.TestCase):
    def test_buffer_ignores_errors_that_were_not_yet_known(self):
        # +100 over-forecast on days 1-5; a huge +5000 miss on days 6 and 7 must not leak into day 7's band
        ds = constant_error_dataset({**{d: 100.0 for d in range(1, 6)}, 6: 5000.0, 7: 5000.0})
        out = an.decision(ds, date(2026, 1, 7), time(9, 0), confidence=0.9)
        self.assertEqual(out["summary"]["buffer_mw"], 100.0)
        self.assertTrue(out["summary"]["band_available"])
        self.assertEqual(out["summary"]["history"]["days"], 5)

    def test_early_days_get_no_band_rather_than_borrowing_future_days(self):
        ds = constant_error_dataset({d: 100.0 for d in range(1, 9)})
        out = an.decision(ds, date(2026, 1, 2), time(9, 0), demand_mw=1500.0)
        sm = out["summary"]
        self.assertFalse(sm["band_available"])
        self.assertIsNone(sm["buffer_mw"])
        self.assertEqual(sm["history"]["first_band_date"], "2026-01-05")   # 3 days <= D-2 first exist for Jan 5
        self.assertNotIn("demand", sm)
        self.assertTrue(all(x["lower"] is None and x["firm"] is None for x in out["slots"]))
        self.assertIsNotNone(out["slots"][0]["forecast"])                  # the forecast itself is still shown

    def test_day_with_exactly_enough_history_gets_a_band(self):
        ds = constant_error_dataset({d: 100.0 for d in range(1, 9)})
        self.assertTrue(an.decision(ds, date(2026, 1, 5), time(9, 0))["summary"]["band_available"])
        self.assertFalse(an.decision(ds, date(2026, 1, 4), time(9, 0))["summary"]["band_available"])

    def test_buffer_is_never_negative_and_band_orders(self):
        ds = constant_error_dataset({d: -300.0 for d in range(1, 9)})          # forecasts too LOW
        out = an.decision(ds, date(2026, 1, 7), time(9, 0))
        self.assertEqual(out["summary"]["buffer_mw"], 0.0)
        for s in out["slots"]:
            self.assertLessEqual(s["lower"], s["forecast"])
            self.assertLessEqual(s["forecast"], s["upper"])

    def test_missing_forecast_is_reported_not_invented(self):
        ds = constant_error_dataset({})
        first = Dataset.slots(date(2026, 1, 5))[0]
        del ds._f[first]
        out = an.decision(ds, date(2026, 1, 5), time(9, 0))
        self.assertEqual(out["summary"]["missing_forecast_slots"], 1)
        self.assertIsNone(out["slots"][0]["forecast"])

    def test_demand_worksheet(self):
        ds = constant_error_dataset({d: 100.0 for d in range(1, 9)})
        out = an.decision(ds, date(2026, 1, 7), time(9, 0), demand_mw=1500.0)
        d = out["summary"]["demand"]
        # forecast is 1100 MW (actual 1000 + 100 error), so buying 1500 - 1100 = 400 MW centrally
        self.assertAlmostEqual(d["avg_procure_mw"], 400.0)
        # firm wind = forecast - 100 MW buffer = 1000, so the safe purchase is 500 MW
        self.assertAlmostEqual(d["avg_procure_safe_mw"], 500.0)
        self.assertAlmostEqual(d["extra_for_risk_mwh"], 100.0 * 48 * 0.5)

    def test_realised_block_needs_mostly_complete_day(self):
        ds = constant_error_dataset({})
        out = an.decision(ds, date(2026, 1, 5), time(9, 0))
        self.assertIn("realised", out["summary"])


class BacktestTests(unittest.TestCase):
    def test_no_exceedances_when_errors_are_stable(self):
        ds = constant_error_dataset({d: 100.0 for d in range(1, 9)})
        bt = an.backtest(ds, time(9, 0), 0.9)
        self.assertEqual((bt["days"], bt["half_hours"]), (4, 192))          # Jan 5..8
        self.assertEqual((bt["below_band_pct"], bt["above_band_pct"]), (0.0, 0.0))
        self.assertEqual(bt["target_pct"], 10.0)

    def test_a_surprise_day_is_counted_as_outside_the_band(self):
        ds = constant_error_dataset({**{d: 100.0 for d in range(1, 8)}, 8: 500.0})
        bt = an.backtest(ds, time(9, 0), 0.9)
        self.assertEqual(bt["below_band_pct"], 25.0)                        # all 48 of Jan 8's 192 half-hours

    def test_demo_day_always_has_a_strict_band(self):
        from app.config import DATA_ROOT
        ds = load_dataset(DATA_ROOT / "sample")
        day = date.fromisoformat(an.meta(ds)["default_date"])
        self.assertTrue(an.decision(ds, day, time(9, 0))["summary"]["band_available"])


class ResolutionTests(unittest.TestCase):
    def test_hourly_forecasts_cover_both_half_hours(self):
        hour, half = dt(3, 6, 0), dt(3, 6, 30)
        ds = Dataset({hour: 100.0, half: 110.0}, [(hour, dt(2, 8), 90.0)], date(2026, 1, 3), date(2026, 1, 3))
        self.assertEqual(ds.forecast_resolution_min, 60)
        self.assertEqual(ds.select(half, dt(2, 9))[1], 90.0)
        self.assertEqual(ds.raw_forecast_rows, 1)

    def test_mixed_resolution_is_left_alone(self):
        hour, half = dt(3, 6, 0), dt(3, 6, 30)
        ds = Dataset({hour: 100.0}, [(hour, dt(2, 8), 90.0), (half, dt(2, 8), 95.0)], date(2026, 1, 3), date(2026, 1, 3))
        self.assertEqual(ds.forecast_resolution_min, 30)
        self.assertEqual(ds.select(half, dt(2, 9))[1], 95.0)


class LoaderTests(unittest.TestCase):
    def test_non_finite_negative_and_misaligned_rows_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "actuals.csv").write_text(
                "startTime,generation\n2026-01-02T00:00:00Z,100\n2026-01-02T00:30:00Z,nan\n"
                "2026-01-02T01:00:00Z,-5\n2026-01-02T01:15:00Z,50\n2026-01-02T01:30:00Z,inf\n")
            (p / "forecasts.csv").write_text(
                "startTime,publishTime,generation\n2026-01-02T00:00:00Z,2026-01-01T09:00:00Z,90\n"
                "2026-01-02T00:00:00Z,2026-01-01T10:00:00Z,-1\n")
            ds = load_dataset(p)
            self.assertEqual(ds.meta["skipped_rows"], {"actuals": 4, "forecasts": 1})
            self.assertEqual(len(ds.actuals), 1)

    def test_bad_rows_are_skipped_and_counted(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / "actuals.csv").write_text("startTime,generation\n2026-01-02T00:00:00Z,100\nbad,row\n")
            (p / "forecasts.csv").write_text(
                "startTime,publishTime,generation\n2026-01-02T00:00:00Z,2026-01-01T09:00:00Z,90\n,,\n")
            ds = load_dataset(p)
            self.assertEqual(ds.meta["skipped_rows"], {"actuals": 1, "forecasts": 1})
            self.assertEqual(ds.window_start, date(2026, 1, 2))
            self.assertEqual(ds.source, "snapshot")


if __name__ == "__main__":
    unittest.main()
