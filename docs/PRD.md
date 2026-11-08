# PRD: NYC Noise Forecast

Status: v1, 2026-11-07. Replaces the original scaffold, which had no spec; this PRD is derived from the original Readme's promises and records which were kept and which were cut.

## Problem

New Yorkers, community boards and venue operators ask the same question: which neighborhoods will be loud next week, and is that unusual for them? The only public signal is 311 noise complaints, which are noisy, seasonal and different in volume by orders of magnitude between ZIP codes.

## Users and jobs

| User | Job | What they need |
|---|---|---|
| Resident or renter | Compare a neighborhood against its own norm | ZIP-level forecast, "vs typical" |
| Community board / venue operator | Plan staffing and outreach | Weekly forecast with an honest range, time-of-week pattern |
| Hiring manager reading the repo | Judge data-science rigor | Reproducible pipeline, leakage-safe evaluation, baselines |

## Scope

Original Readme promise and what v1 does with it:

| Promise | v1 decision | Why |
|---|---|---|
| Fetch NYC open data | Kept: 311 noise complaints, Jan 2022 to present | The only source with citywide, long-run, geocoded noise signal |
| Clean and preprocess | Kept: ZIP validation, dense weekly panel, zero-fill | Missing weeks are real zeros; dense panel makes lags correct |
| Feature engineering | Kept, redefined: lags, rolling mean, same-week-last-year, seasonality | Features available at prediction time only |
| Noise score from subway/highway/construction/flights | Rebuilt in v2 as a spatial model | v1 cut the hand-weighted score (placeholder coordinates, target leakage). v2 measures 24 real factors per ~250 m cell and explains complaints with spatial CV and SHAP. Live flight tracks still out (OpenSky needs OAuth); airports and heliports enter as distances. |
| Decibel levels | Cut | 311 has no measurements. The dashboard says so on its first screen. |
| Train and compare models | Kept: random forest vs gradient boosting, time-blocked CV, naive baselines | |
| Heatmap dashboard | Kept as ZIP bubble map + explorer + time-of-week + model card | |
| Spark, Dask, TF, PyTorch, Kubernetes, MLflow, Airflow | Cut | None were used; a weekly GitHub Action does the refresh |

Non-goals: real-time alerts, address-level prediction, causal claims about noise sources, per-complaint-type forecasts.

## Requirements

Data
- D1. Ingestion is idempotent and resumable: monthly raw files are cached; re-runs fetch only missing months and the most recent ~5 weeks.
- D2. The weekly panel is validated on every build (no duplicate ZIP-weeks, dense, Monday-start, non-negative) and fails loudly.
- D3. A manifest records build time, source, row counts and date range; the dashboard shows data freshness.

Modelling
- M1. Prediction target is next week's count per ZIP. Features at week t use only weeks <= t (tested by perturbing the future).
- M2. Evaluation is a time holdout of the last 52 weeks. Model selection uses expanding-window CV on whole weeks.
- M3. Always report naive baselines (last week, 4-week mean, same week last year) and a scale-free error (WAPE).
- M4. Forecasts carry an 80% interval; empirical coverage on the holdout is reported, not assumed.
- M5. Fixed seeds; `python -m nynoise.model` reproduces `data/metrics.json` from the committed panel.

Product
- P1. Deployed as a static React app on Vercel with zero secrets and no API calls at runtime: it reads exported JSON.
- P2. First screen: forecast total, holdout error vs baseline, interval coverage, data freshness.
- P3. Views: forecast map, ZIP explorer with backtest and interval, weekday-by-hour heatmap by type, model card with limitations.
- P4. Weekly refresh runs in CI; CI runs tests and boots the dashboard.

## Success criteria

- Selected model beats the best naive baseline on holdout WAPE (reported as a percentage on the dashboard).
- Interval coverage within a few points of 80% on the holdout.
- Fresh clone to running dashboard in two commands.
- Tests cover panel construction, no-lookahead, target alignment, model-vs-baseline, interval sanity, and API paging.

## Risks and open questions

- Socrata throttles anonymous clients. Mitigation: monthly cache, retry with backoff, optional `SOCRATA_APP_TOKEN` (set it as a repo secret for the weekly refresh).
- 311 behavior shifts (policy changes, app changes). Mitigation: rolling features and a yearly holdout; retraining weekly.
- ZIP is a postal unit, not a neighborhood. Acceptable for v1; a later version could use community districts or H3 cells.
- Next candidates: weather and holiday covariates, community-district geography, per-type forecasts.

## v2 additions (2026-11-07)

- S1. Spatial model on H3 resolution-9 cells: complaint-days over 104 weeks against 24 measured factors; spatial block CV; skill reported over a units-only baseline; per-type sanity checks; SHAP drivers per cell as multipliers.
- S2. Immersive map: thermal hex terrain, rings at hotspots, lenses (complaints, expected, surprise, single factor), month replay, click-for-drivers.
- Non-goals unchanged: no causal claims, no decibels, no real-time.
