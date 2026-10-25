# Submission checklist

Reviewed on 25 October 2026 against the supplied challenge brief. Checked items have evidence from this session. Local wording and documentation changes still need to be pushed and deployed.

## Completed and verified

- [x] React frontend and Python FastAPI backend implemented.
- [x] Decision dates cover January purchases: delivery 2 January through 1 February 2026.
- [x] Latest forecast selected with publication time at or before the D-1 cutoff.
- [x] Local snapshot loads 1,488 actual half-hours with no rejected rows and reports real Elexon data.
- [x] All 1,488 delivery slots have an eligible forecast at all 18 supported decision cutoffs.
- [x] Accuracy metrics, charts, per-day view, historical risk band, and CSV exports implemented.
- [x] Public homepage and health, readiness, metadata, decision, accuracy, and vintage endpoints return HTTP 200 at https://wind-ward-web-application.vercel.app/.
- [x] Deployed metadata reports `is_sample: false`.
- [x] SVG favicon responds successfully on the live deployment.
- [x] GitHub API confirms `gaurav-chhajer/WindWard` is public.
- [x] README live URL updated and known Codex assistance disclosed.
- [x] Statistical wording explains empirical coverage, band adjustments, correlated observations, and retrospective evaluation.
- [x] Worksheet explicitly describes national residual demand and the need for utility-specific wind allocation.
- [x] Full backend suite: 36 tests pass, none skipped, after installing declared development dependencies.
- [x] Frontend: all 10 tests pass and production build succeeds after the wording changes. Vite reports an advisory about a JavaScript chunk exceeding 500 kB; this does not fail the build.
- [x] Dockerfiles, nginx proxy, readiness check, and Compose configuration present.
- [x] Timed video outline prepared in DEMO_OUTLINE.md.

## Finish locally and publish

- [ ] Commit and push the reviewed files. Review `git diff` first, then use:

  ```powershell
  git add README.md SUBMISSION_CHECKLIST.md DEMO_OUTLINE.md frontend/src/components/DecisionDesk.jsx frontend/src/components/Method.jsx frontend/src/components/Intro.jsx
  git commit -m "Prepare challenge submission and clarify analysis assumptions"
  git push
  ```

  The changes are currently local. Confirm the corresponding Vercel deployment succeeds before recording the final video. Do not imply a local change is already live.

- [ ] Check the GitHub Actions run for the pushed commit. Both backend and frontend jobs should be green. Local success does not establish CI success.

- [ ] Verify Docker startup. Docker is not available on PATH in this environment, so this was not run. Install/start Docker Desktop with Linux containers, then from the repository root:

  ```powershell
  docker compose config
  docker compose up --build -d
  docker compose ps
  Invoke-RestMethod http://localhost:8080/api/ready
  ```

  Open http://localhost:8080 and exercise the desk and lab. The backend should be healthy, readiness should say `ready`, and sample mode should be false. Diagnose with `docker compose logs backend frontend`. Stop with `docker compose down` when finished.

## Submission requirements requiring your input

- [ ] Choose an anonymous GitHub repository name. The brief requests a random name; the current name `WindWard` does not meet that instruction. In the repository settings, rename it to your chosen random string. Keep it public. Update the local remote:

  ```powershell
  git remote set-url origin https://github.com/gaurav-chhajer/YOUR_RANDOM_REPO_NAME.git
  git remote -v
  ```

  This is a remote change requiring your choice. Recheck the Vercel Git integration and deploy after renaming. The brief explicitly requires an anonymous repo name; it does not explicitly require rewriting history or deleting your account identity.

- [ ] Confirm the AI disclosure accurately describes your complete development process. The current text records known Codex assistance only. Add any earlier tools and their actual uses; remove the sentence about additional tools once you have completed that review. Do not claim manual work or tools you did not use.

- [ ] Record your own presentation using DEMO_OUTLINE.md. Keep the customer overview at or below five minutes and technical overview at or below five minutes, with the complete video at or below ten minutes. Target nine minutes to leave margin.

- [ ] Upload the video to YouTube with visibility set to Unlisted. Wait for processing, open it signed out, check audio and screen readability, and copy the final watch URL. Recording your pitch, signing into your account, and uploading were not performed in this session.

- [ ] Replace the README walkthrough placeholder with the final unlisted video URL. Commit and push that update.

- [ ] Submit the form linked in the original challenge document. Include the final public repository URL, working app URL, video URL, and any other fields requested. Review your personal answers before submitting. This session did not submit the form.

## Final signed-out acceptance check

- [ ] Open app, repository, and YouTube URLs in an incognito/private window without signing in. HTTP checks above establish public endpoint access, not a complete visual browser test.
- [ ] Homepage has no error banner, charts render, and the tab displays the wind SVG.
- [ ] Open Decision desk on 20 January at 09:00. Change cutoff to 14:30 and confirm data refreshes.
- [ ] Select 2 January: the forecast remains visible and insufficient-history messaging replaces the risk band.
- [ ] Change P80/P90/P95 and confirm buffer and band update. Explain these as empirical targets.
- [ ] Enter illustrative national demand and verify the worksheet totals. Do not pitch national wind as the utility's contracted supply.
- [ ] Open Accuracy lab and Method. Check charts, units, source, dates, and limitations.
- [ ] Download day and metrics CSVs; verify headers and values match selected settings.
- [ ] Check narrow/mobile layout, keyboard navigation, visible focus, and reduced-motion preference.
- [ ] Verify the video has both customer and technical sections, runs at most ten minutes, and plays without access requests.

## Optional follow-up improvements

These are not additional requirements in the brief and should not distract from a working submission or the 16-hour assignment limit.

- [ ] Add a browser integration test for cutoff changes, early dates, CSV download, and API failure.
- [ ] Add ingestion validation for eligible forecast coverage per cutoff, rather than only existence of any forecast per target.
- [ ] Consider retaining older forecast vintages as flagged fallback values; the pilot currently retains only 0–48-hour vintages. Avoid changing the historical snapshot without revalidation.
- [ ] If developing for a utility, introduce an explicit contracted wind share or allocation model with clear units and tests.
- [ ] Assess calibration by day and forecast level, respecting correlated half-hours; avoid claiming a stable tail probability from a small sample.

Reproduce local checks:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -t backend -v
npm --prefix frontend test
npm --prefix frontend run build
```
