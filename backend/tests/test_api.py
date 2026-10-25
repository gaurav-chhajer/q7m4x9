"""HTTP-level tests. Skipped automatically if FastAPI is not installed (pip install -r requirements-dev.txt)."""
import unittest

try:
    from fastapi.testclient import TestClient
    from app.main import app
    HAVE_FASTAPI = True
except ImportError:  # pragma: no cover
    HAVE_FASTAPI = False


@unittest.skipUnless(HAVE_FASTAPI, "fastapi / httpx not installed")
class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").json(), {"status": "ok"})

    def test_ready_reflects_a_loaded_dataset(self):
        body = self.client.get("/api/ready").json()
        self.assertEqual(body["status"], "ready")
        self.assertGreater(body["forecast_rows"], 0)

    def test_early_day_has_no_band(self):
        body = self.client.get("/api/decision", params={"date": "2026-01-02"}).json()
        self.assertFalse(body["summary"]["band_available"])
        self.assertIsNone(body["summary"]["buffer_mw"])

    def test_meta_flags_sample_data(self):
        body = self.client.get("/api/meta").json()
        self.assertIn("is_sample", body)
        self.assertEqual(body["quality"]["expected_slots"], 31 * 48)

    def test_decision_shape(self):
        meta = self.client.get("/api/meta").json()
        body = self.client.get("/api/decision", params={"date": meta["default_date"], "cutoff": "09:00"}).json()
        self.assertEqual(len(body["slots"]), 48)
        self.assertIn("buffer_mw", body["summary"])

    def test_date_outside_window_is_404(self):
        self.assertEqual(self.client.get("/api/decision", params={"date": "2030-01-01"}).status_code, 404)

    def test_bad_cutoff_is_422(self):
        self.assertEqual(self.client.get("/api/accuracy", params={"cutoff": "25:99"}).status_code, 422)

    def test_accuracy_has_all_sections(self):
        body = self.client.get("/api/accuracy").json()
        for key in ("summary", "by_horizon", "by_hour", "daily", "distribution", "by_level", "pairs"):
            self.assertIn(key, body)
