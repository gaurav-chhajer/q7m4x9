# Windward

A decision desk for UK day-ahead power buyers. For any delivery day it shows **the wind forecast you actually had at the cutoff**, how wrong that forecast tends to be, and **how much wind to hold back** when planning purchases.

Built for the REint Full Stack SWE challenge. Data: Elexon BMRS (`FUELHH` actual wind, `WINDFOR` wind forecasts).

- **Live app:** https://wind-ward-web-application.vercel.app/
- **Public repository:** https://github.com/gaurav-chhajer/q7m4x9
- **Walkthrough video:** Pending recording and upload. Add the unlisted YouTube URL before submission.

See [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) for remaining submission steps and [DEMO_OUTLINE.md](DEMO_OUTLINE.md) for the video plan.

## What it does

| Screen | Purpose |
|---|---|
| Scroll intro | Follows one real half-hour through the decision: every forecast issued for it, the cutoff, the last usable forecast, and what actually happened. |
| Decision desk | Pick a delivery day and decision time. See the forecast, a risk band built from past errors, the suggested buffer in MW, and a procurement worksheet. CSV export. |
| Accuracy lab | MAE, RMSE, bias, percentile misses, error by lead time, by day, by hour, by wind level, and forecast vs actual. CSV export. |
| Method | Plain-language rules, data coverage, and limitations. |

## Run it

### Docker

Start Docker Desktop with Linux containers enabled. From the repository root:

```bash
docker compose up --build -d
# open http://localhost:8080
docker compose ps
```

The repo includes a real Elexon snapshot for the challenge window, plus generated sample data as a fallback. The backend prefers the real snapshot. A red banner appears if sample data is in use.

The frontend runs in nginx on port 8080 and proxies `/api` to the backend inside the Docker network. The backend is not published on a host port. API documentation is available at http://localhost:8080/api/docs. Compose waits for backend readiness before starting the frontend.

```powershell
# Check that data is loaded
Invoke-RestMethod http://localhost:8080/api/ready
# Diagnose a problem
docker compose logs backend frontend
# Stop the app
docker compose down
```

The Docker build excludes host `node_modules`, generated frontend output, Python caches, and local environment files. Backend data is mounted read-only from `backend/data`, so it can be refreshed without rebuilding the image.

### Refresh the Elexon snapshot

The real snapshot is already included; ingestion is optional for first startup. Refreshing requires internet access and can take several minutes depending on the API.

```bash
python -m pip install requests
python scripts/ingest.py
# or: docker compose --profile ingest run --rm ingest
```

This writes `backend/data/snapshot/` (`actuals.csv`, `forecasts.csv`, `meta.json`). The backend prefers the snapshot over the sample automatically. Restart the backend afterwards (`docker compose restart backend`) and confirm the banner has gone.

### Local development

Use Python 3.12 and Node.js 20, matching the Docker and CI configuration. Run each terminal from the repository root. Commands below work in Windows PowerShell without activation scripts.

```powershell
# Terminal 1: create an environment and start the API
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --port 8000 --reload
```

```powershell
# Terminal 2: start Vite, which proxies /api to port 8000
cd frontend
npm ci
npm run dev
```

Open the URL Vite prints. API docs: http://localhost:8000/api/docs. On macOS/Linux, use `.venv/bin/python` in place of `.\.venv\Scripts\python.exe`. To load data from another directory, set `WINDWARD_DATA_DIR` before starting the backend.

## Tests

From the repository root, after creating the virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -t backend -v
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
```

`backend/tests/test_ingest.py` runs the whole ingestion pipeline against a fake Elexon API, including refusing to write incomplete data.

The tests that matter most: no forecast published after the cutoff is ever selected, a forecast published exactly at the cutoff is usable, and the error band never uses errors that were not yet known when the decision was made.

Verification on 25 October 2026: 36 backend tests passed with none skipped; all 10 frontend tests and the production build passed. Docker images built successfully, the backend became healthy, and the local homepage and readiness endpoint returned HTTP 200. Readiness reported 1,488 actual slots and 11,873 forecast rows with `is_sample: false`. These results are point-in-time checks; rerun them after changes. CI runs the backend suite and frontend tests/build on pushes and pull requests.

## Key decisions

**Which forecast.** For each half-hour of delivery day D, take the latest forecast with `publishTime <= cutoff` on D-1 (default 09:00). Selection is a binary search over the issue times; forecasts issued later are never used.

**Delivery window.** Purchases are made on D-1, so "decisions made in January 2026" covers delivery days **2 Jan to 1 Feb 2026**. Change it with `--delivery-start` and `--delivery-end` in `scripts/ingest.py`.

**Hourly forecasts.** WINDFOR targets sit on the hour while FUELHH actuals are half-hourly. When every forecast starts on the hour, the backend applies each one to both half-hours of its hour (detected automatically, shown on the Method page).

**Sign convention.** Miss = forecast minus actual. Positive means the forecast was too high, the risky direction for a buyer.

**Buffer and band.** Two different things come from the same past misses at the same decision time. At the default P90 setting, the *buffer* uses the empirical P90 shortfall, floored at zero, targeting a 10% exceedance rate. This is not a guarantee. P80 and P95 are also available. The *band* starts at P10 to P90 of actual-minus-forecast errors at P90, widens if needed to include the forecast, and clips its lower edge at zero. Its nominal coverage is 80%; realised coverage can differ. A day's band uses only delivery days up to D-2, because D-1 is unfinished at decision time. With fewer than 3 such days there is **no band and no buffer**: with the included snapshot and default cutoff, 2–5 January have no band and 6 January is the first eligible date. The forecast itself remains visible, and no future errors are used to train its band.

**Back-test.** The worksheet reports a retrospective evaluation across the full data window, including outcomes after the selected decision date. It is not information available at that decision time. This is a walk-forward check: rebuilding each day's band from strictly past errors, how often actual wind fell below or above it, against the intended 10%. The errors are pooled across hours and wind levels, so treat the buffer as a rough guide.

**Static snapshot.** This is a historical January pilot, not a live operational feed. The included snapshot contains 1,488 half-hourly actuals and 11,873 forecast rows for delivery days 2 January–1 February 2026. All delivery slots have an eligible forecast at all 18 supported cutoffs, 06:00–14:30 in half-hour steps, in the checked snapshot. `scripts/ingest.py` is the repeatable pipeline; the loader prefers the snapshot and uses synthetic sample data only as a fallback. Ingestion validates nonnegative finite values, deduplicates records, retries requests, splits rejected time ranges, and normally refuses coverage below 95%. It validates target coverage, not eligibility at every cutoff. The analysis uses the Python standard library; FastAPI handles HTTP and Uvicorn serves the local API.

**Docker and Vercel.** `docker compose up` runs the full stack locally. Vercel does not run containers, so the deployed app uses Vercel's native build: static frontend plus a Python function.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/meta` | Data window, quality counts, default day, sample flag |
| `GET /api/decision?date=&cutoff=&confidence=&demand_mw=` | 48 half-hours with forecast, band, actual, buffer, summary |
| `GET /api/accuracy?cutoff=&start=&end=` | Metrics and all chart series |
| `GET /api/vintages?target=&cutoff=` | Every forecast issued for one half-hour (powers the intro) |
| `GET /api/health` | Liveness: the process is up |
| `GET /api/ready` | Readiness: 200 only when a non-empty dataset is loaded |

## Deploy to Vercel

1. Keep the included snapshot committed, or regenerate it and validate the results before committing.
2. Push to the public repository. Its random name, `q7m4x9`, follows the brief's anonymous repository-name requirement; the brief does not require a separate GitHub account.
3. Import the repository into Vercel. Use the repository root as Root Directory and the Other framework preset. `vercel.json` sets `framework: null`, builds `frontend/dist`, includes backend files in the Python function, and routes `/api` requests to that function.
4. Deploy and open the public URL in a private window. Check the homepage, `/api/health`, and `/api/ready`; readiness should report `is_sample: false`. Check that charts load and the SVG favicon appears.

The public homepage and readiness endpoint at the link above were rechecked successfully on 25 October 2026. A successful deployment does not replace the final private-window interaction checks in the submission checklist.

## Assumptions and limits

- One month is a small sample; the band describes January's conditions, and the first days of the window have too little history for a band.
- The hourly-to-half-hourly mapping is an assumption (see Hourly forecasts above).
- The frontend lockfile is included; use `npm ci` to install its dependency versions.
- The band is pooled across the day and does not yet widen for windier hours.
- Wind curtailment and embedded wind are not modelled.
- The worksheet illustrates national residual demand with a flat national demand input. A utility must establish its contracted or allocated wind share before using this for its own purchases.
- Only forecast vintages within 48 hours of delivery are retained. Older fallback forecasts are outside this pilot scope; missing eligible forecasts remain gaps.
- Three days is the pilot minimum for a band. Correlated half-hours and a short history limit tail calibration.
- Fonts load from Google Fonts. To self-host, replace the `<link>` in `frontend/index.html` with `@fontsource` packages.

## Project layout

```
api/index.py            Vercel entry point for the FastAPI app
backend/app/            analysis.py (all maths), loader.py, main.py (HTTP), config.py
backend/tests/          unit and API tests
backend/data/           snapshot/ (included Elexon data) and sample/ (synthetic fallback)
scripts/                ingest.py (Elexon to CSV), make_sample.py
frontend/src/           App, components/ (intro, desk, lab, method, background), lib/
frontend/public/        SVG favicon matching the header icon
frontend/test/          formatting, presentation text, and CSV helper tests
docker-compose.yml      backend + nginx frontend (+ one-off ingest profile)
vercel.json             Vercel build and routing
.github/workflows/ci.yml backend tests and frontend tests/build
SUBMISSION_CHECKLIST.md verified work and remaining submission steps
DEMO_OUTLINE.md         timed customer and technical walkthrough plan
```

## AI usage disclosure

OpenAI Codex was used to review the implementation against the assignment, investigate deployment routing, add the header SVG as a favicon, refine statistical and procurement explanations, update documentation, configure Docker build exclusions, and run validation checks. This disclosure describes the assistance documented in this development session; any additional AI tools used earlier should also be disclosed by the author before submission.

## Submission status

The React/Python implementation, Docker setup, public deployment, and public repository are available. Before submitting, record and upload an unlisted YouTube walkthrough and replace the video notice above with its URL. The brief requires a customer overview of at most five minutes and a technical overview of at most five minutes, with the entire video at most ten minutes. Evaluation starts with the video. Verify every submitted URL in a private window, confirm the AI disclosure describes the complete process, and submit the form linked in the original challenge document. The brief also limits assignment work to 16 hours; record your actual effort honestly.

## Data attribution

Contains data from Elexon BMRS, used under the BMRS data licence terms.
