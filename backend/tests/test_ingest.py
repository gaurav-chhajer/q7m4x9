"""Pipeline test for scripts/ingest.py using a fake Elexon API (no network). Skipped if `requests` is missing."""
import importlib.util
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
try:
    spec = importlib.util.spec_from_file_location("ingest", ROOT / "scripts" / "ingest.py")
    ingest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ingest)
except ImportError:  # requests not installed
    ingest = None

UTC = timezone.utc
DAY = datetime(2026, 1, 2, tzinfo=UTC)


def z(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class FakeResp:
    status_code = 200

    def __init__(self, body):
        self._body, self.text = body, ""

    def json(self):
        return self._body


class FakeSession:
    """Answers every request with the same canned rows; the pipeline must filter and de-duplicate."""

    def __init__(self, wind_rows=48):
        self.wind_rows = wind_rows

    def get(self, url, params=None, timeout=None):
        if "/FUELHH/" in url:
            rows = [{"fuelType": "WIND", "startTime": z(DAY + timedelta(minutes=30 * i)),
                     "publishTime": z(DAY + timedelta(minutes=30 * i + 40)), "generation": 5000 + i}
                    for i in range(self.wind_rows)]
            rows.append({"fuelType": "CCGT", "startTime": z(DAY), "publishTime": z(DAY), "generation": 9999})
            rows.append({"fuelType": "WIND", "startTime": z(DAY + timedelta(minutes=30 * 48)),     # outside the window
                         "publishTime": z(DAY), "generation": 1})
            return FakeResp(rows)
        rows = []
        for h in range(24):
            target = DAY + timedelta(hours=h)
            for pub in (datetime(2026, 1, 1, 4, 30, tzinfo=UTC), datetime(2026, 1, 1, 10, 30, tzinfo=UTC)):
                rows.append({"startTime": z(target), "publishTime": z(pub), "generation": 4000 + h})
        rows.append({"startTime": z(DAY), "publishTime": z(datetime(2025, 12, 28, tzinfo=UTC)), "generation": 1})  # >48 h ahead
        rows.append({"startTime": z(DAY + timedelta(days=3)), "publishTime": z(DAY), "generation": 1})            # outside window
        rows.append({"startTime": z(DAY), "publishTime": z(datetime(2026, 1, 1, 16, 30, tzinfo=UTC)), "generation": None})
        return FakeResp(rows)


@unittest.skipIf(ingest is None, "requests not installed")
class IngestTests(unittest.TestCase):
    def test_filters_dedups_and_writes_a_loadable_snapshot(self):
        from app.loader import load_dataset
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            stats = ingest.run(date(2026, 1, 2), date(2026, 1, 2), FakeSession(), out, log=lambda *_: None)
            self.assertEqual(stats["actuals"], 48)                  # WIND only, in window, de-duplicated
            self.assertEqual(stats["forecast_rows"], 48)            # 24 targets x 2 issues; stale, out-of-window, null dropped
            self.assertTrue(stats["hourly"])
            self.assertEqual(stats["issue_times_utc"], ["04:30", "10:30"])
            meta = json.loads((out / "meta.json").read_text())
            self.assertFalse(meta["synthetic"])
            ds = load_dataset(out)                                  # what the backend will do with it
            self.assertEqual((ds.window_start, ds.window_end), (date(2026, 1, 2), date(2026, 1, 2)))
            self.assertEqual(ds.forecast_resolution_min, 60)

    def test_incomplete_data_is_refused_and_nothing_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "snap"
            with self.assertRaises(SystemExit) as ctx:
                ingest.run(date(2026, 1, 2), date(2026, 1, 2), FakeSession(wind_rows=10), out, log=lambda *_: None)
            self.assertIn("Not writing a snapshot", str(ctx.exception))
            self.assertFalse(out.exists())

    def test_allow_incomplete_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            stats = ingest.run(date(2026, 1, 2), date(2026, 1, 2), FakeSession(wind_rows=10), Path(tmp),
                               allow_incomplete=True, log=lambda *_: None)
            self.assertTrue(stats["problems"])


if __name__ == "__main__":
    unittest.main()
