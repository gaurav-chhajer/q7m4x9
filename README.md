# Windward

A decision desk for UK day-ahead power buyers. For any delivery day it shows **the wind forecast you actually had at the cutoff**, how wrong that forecast tends to be, and **how much wind to hold back** when planning purchases.

Built for the REint Full Stack SWE challenge. Data: Elexon BMRS (`FUELHH` actual wind, `WINDFOR` wind forecasts).

- **Live app:** _add your Vercel URL here_
- **Walkthrough video:** _add your unlisted YouTube URL here_

## What it does

| Screen | Purpose |
|---|---|
| Scroll intro | Follows one real half-hour through the decision: every forecast issued for it, the cutoff, the last usable forecast, and what actually happened. |
| Decision desk | Pick a delivery day and decision time. See the forecast, a risk band built from past errors, the suggested buffer in MW, and a procurement worksheet. CSV export. |
| Accuracy lab | MAE, RMSE, bias, percentile misses, error by lead time, by day, by hour, by wind level, and forecast vs actual. CSV export. |
| Method | Plain-language rules, data coverage, and limitations. |

## Run it

### Docker (everything, one command)

```bash
docker compose up --build
# open http://localhost:8080
```

The repo ships with **generated sample data** so this works immediately. A red banner is shown while sample data is in use. Load the real data first (next section) for real numbers.

### Load the real Elexon data (one time, about 2 minutes, needs internet)

```bash
pip install requests
python scripts/ingest.py
# or: docker compose --profile ingest run --rm ingest
```

This writes `backend/data/snapshot/` (`actuals.csv`, `forecasts.csv`, `meta.json`). The backend prefers the snapshot over the sample automatically. Restart the backend afterwards (`docker compose restart backend`) and confirm the banner has gone.

### Local development

```bash
# terminal 1: API (Windows PowerShell: run the commands on separate lines or join them with ';', not '&&')
cd backend && pip install -r requirements.txt && uvicorn app.main:app --port 8000 --reload
# terminal 2: UI (proxies /api to :8000)
cd frontend && npm install && npm run dev
```

API docs: http://localhost:8000/api/docs

## Tests

```bash
pip install -r backend/requirements-dev.txt
python -m unittest discover -s backend/tests -t backend -v   # or: pytest backend/tests
cd frontend && npm test
```

`backend/tests/test_ingest.py` runs the whole ingestion pipeline against a fake Elexon API, including refusing to write incomplete data.

The tests that matter most: no forecast published after the cutoff is ever selected, a forecast published exactly at the cutoff is usable, and the error band never uses errors that were not yet known when the decision was made.

## Key decisions

**Which forecast.** For each half-hour of delivery day D, take the latest forecast with `publishTime <= cutoff` on D-1 (default 09:00). Selection is a binary search over the issue times; forecasts issued later are never used.

**Delivery window.** Purchases are made on D-1, so "decisions made in January 2026" covers delivery days **2 Jan to 1 Feb 2026**. Change it with `--delivery-start` and `--delivery-end` in `scripts/ingest.py`.

**Hourly forecasts.** WINDFOR targets sit on the hour while FUELHH actuals are half-hourly. When every forecast starts on the hour, the backend applies each one to both half-hours of its hour (detected automatically, shown on the Method page).

**Sign convention.** Miss = forecast minus actual. Positive means the forecast was too high, the risky direction for a buyer.

**Buffer and band.** Two different things from the same past misses at the same decision time. The *buffer* is one-sided: at P90 it is the shortfall that wind exceeded 1 half-hour in 10. The *band* is two-sided: P10 to P90 of past errors around the forecast, so about 80% of outcomes should fall inside it. A day's band uses only delivery days up to D-2, because D-1 is unfinished at decision time. With fewer than 3 such days there is **no band and no buffer** (2 to 5 Jan with the default settings); the forecast is still shown, and nothing from later days is ever used.

**Back-test.** The worksheet reports a walk-forward check: rebuilding each day's band from strictly past errors, how often actual wind fell below or above it, against the intended 10%. The errors are pooled across hours and wind levels, so treat the buffer as a rough guide.

**Static snapshot.** The scope is a closed historical month, so the data is fetched once and served from CSV files. This makes the demo fast and reliable, keeps Vercel functions tiny, and makes every number reproducible. `scripts/ingest.py` is the repeatable pipeline. The backend uses only the Python standard library plus FastAPI, which keeps cold starts short.

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

## Deploy to Vercel (free Hobby plan)

1. Run the ingestion script and commit `backend/data/snapshot/`.
2. Push this repo to a public GitHub repository **with an anonymous name**, and check `git config user.name` and `user.email` first so no identifying details end up in commits.
3. In Vercel choose **Add New, Project**, import the repo, keep the root directory, and deploy. `vercel.json` already sets the build, output and API routing.
4. Open the live URL in a private window. Check the sample banner is gone and that `/api/health` responds.

## Assumptions and limits

- One month is a small sample; the band describes January's conditions, and the first days of the window have too little history for a band.
- The hourly-to-half-hourly mapping is an assumption (see Hourly forecasts above).
- Run `npm install` once and commit `frontend/package-lock.json` so builds use `npm ci` and are reproducible.
- The band is pooled across the day and does not yet widen for windier hours.
- Wind curtailment and embedded wind are not modelled.
- The worksheet assumes flat demand and is a planning aid only.
- Fonts load from Google Fonts. To self-host, replace the `<link>` in `frontend/index.html` with `@fontsource` packages.

## Project layout

```
api/index.py            Vercel entry point for the FastAPI app
backend/app/            analysis.py (all maths), loader.py, main.py (HTTP), config.py
backend/tests/          unit and API tests
backend/data/           snapshot/ (real, you generate) and sample/ (synthetic)
scripts/                ingest.py (Elexon to CSV), make_sample.py
frontend/src/           App, components/ (intro, desk, lab, method, background), lib/
docker-compose.yml      backend + nginx frontend (+ one-off ingest profile)
vercel.json             Vercel build and routing
```

## AI usage disclosure

_Required by the brief. Replace this paragraph with your own account._ Example: "I used Claude (Anthropic) to help design the architecture and to draft the code, tests and documentation. I reviewed all generated code, ran the test suites, loaded and checked the real Elexon data, and changed X and Y."

## Data attribution

Contains data from Elexon BMRS, used under the BMRS data licence terms.
