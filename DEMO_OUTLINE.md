# Video outline

Target duration: nine minutes, with a clear change of audience at 4:30. The brief caps each initial overview at five minutes and the total video at ten minutes. Rehearse once before recording. Use your own words and demonstrate understanding of every claim.

## Customer presentation from 0:00 to 4:30

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:40 | Homepage and introduction | A day-ahead buyer must plan before actual wind is known. Windward reconstructs the forecast available at the decision time and quantifies historical misses. This pilot covers January 2026 purchasing decisions. |
| 0:40–1:20 | Forecast publication story | Multiple forecasts refer to the same delivery interval. Only the latest one published at or before the cutoff can inform the decision; later revisions would introduce hindsight. |
| 1:20–2:20 | Desk, 20 January, 09:00; then another cutoff | Delivery date and decision date differ by one day. Show forecast issue time, half-hour profile, and actuals as a retrospective comparison. Explain MW versus daily MWh/GWh. |
| 2:20–3:10 | P90 worksheet and historical evaluation | Explain the empirical shortfall buffer and the desired exceedance rate. It is a rough guide, not a guarantee. The full-window evaluation is retrospective. The worksheet is a national residual-demand illustration; a utility requires its own wind allocation. |
| 3:10–4:00 | Accuracy lab | At 09:00 in the checked snapshot: MAE 2,042 MW, bias +1,747.9 MW, and over-forecasting in 84.7% of half-hours. The P90 walk-forward lower-band exceedance is 12.7%, versus a 10% target. Confirm these values in the final deployment before quoting them. Show one chart that helps explain the business risk. |
| 4:00–4:30 | CSV and Method | Export a day. Explain real Elexon sources, hourly forecast mapping, the short historical window, and why evidence matters more than guaranteed savings. Do not invent cost savings or trading returns. |

## Technical review from 4:30 to 9:00

| Time | Show | Explain |
| --- | --- | --- |
| 4:30–5:15 | Repository layout | React/Vite calls FastAPI via `/api`. Thin HTTP handlers delegate to a framework-independent analysis module. A CSV snapshot keeps this historical pilot reproducible and simple. |
| 5:15–6:00 | `scripts/ingest.py` and snapshot metadata | FUELHH is filtered to WIND; WINDFOR retains target, publication time, and generation. Explain retries, splitting rejected ranges, deduplication, coverage checks, and the 48-hour vintage scope. |
| 6:00–6:50 | `Dataset.select`, `cutoff_dt`, `error_history` | Binary search chooses the latest eligible publication, inclusively. January purchases cover 2 January–1 February deliveries. Band training stops at D-2, and insufficient-history dates receive no band. |
| 6:50–7:30 | Metrics and band code | Explain forecast-minus-actual sign convention, MAE/RMSE/bias, empirical quantiles, widening to include the forecast, and clipping at zero. A walk-forward test trains on the past but the summary spans the entire historical window. |
| 7:30–8:15 | Tests and CI | Show a successful complete backend run and frontend tests/build. Highlight cutoff boundary and leakage tests, not just test counts. Discuss the remaining lack of browser integration coverage. |
| 8:15–8:45 | Docker and deployment | Docker runs nginx plus API locally. Vercel serves the frontend and Python function. Show readiness and the working public URL. Only claim Docker execution once you have actually run it. |
| 8:45–9:00 | Tradeoffs and AI disclosure | Summarise the static historical scope, hourly mapping, limited calibration, and utility allocation follow-up. State the actual AI assistance and the checks performed. |

## Recording checklist

- Increase editor and browser font sizes; close unrelated tabs and hide credentials.
- Prepare the app, key source files, and successful test output before recording.
- Keep narration focused on decisions and evidence; avoid scrolling through every file.
- Use a visible transition between customer pitch and technical review.
- Verify final duration, audio, readability, and signed-out video access.
- Upload as Unlisted, then place the final watch URL in README.md and the submission form.
