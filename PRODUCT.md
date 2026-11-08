# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Streamlit (Python), deployed on Streamlit Community Cloud from the public GitHub repo OrenSegal/ny-noise. Charts are Plotly; custom CSS is injected through `st.markdown`. The app reads committed tables in `data/` only: no network, no secrets, no model files at runtime.

## Users
Two audiences of equal weight, confirmed by the owner:
- Reviewers of the owner's work (hiring managers, engineers) who judge the project on evidence: backtest against baselines, interval calibration, honest limits.
- NYC residents, community boards and venue operators who want next week's complaint outlook for a ZIP code compared with its own normal.

## Product Purpose
Forecast next week's 311 noise complaints for 177 NYC ZIP codes with calibrated 80% intervals, and show how good that forecast is. Success: a visitor finds their ZIP's outlook in seconds, and a reviewer can verify within a minute that the evaluation is leakage-safe and honestly reported.

## Positioning
Most noise dashboards show a heat map of past complaints. This one forecasts, scores itself against naive baselines in the open (including the quarter it loses), and says plainly that complaints measure reporting, not decibels.

## Operating Context
Weekly cadence: data rebuilds every Tuesday by GitHub Action once the prior Monday-to-Sunday week is complete. Viewers arrive from a repo link or a shared URL, on desktop or phone. Interaction asked for by the owner: linked views (select a ZIP and every panel follows), a backtest scrubber (replay past weeks), a baseline race (toggle models and baselines and watch error change), and compare ZIPs (pin two or three side by side, indexed to each ZIP's own typical level).

## Capabilities and Constraints
- Data on hand (committed): weekly ZIP panel, per-ZIP forecast with 10th/90th percentiles, 52-week backtest predictions with intervals, weekday-by-hour-by-type counts, ZIP mean positions, metrics.json (holdout, rolling-origin quarters, interval coverage overall and by ZIP, permutation importance), manifest.
- No basemap tiles or WebGL: the map is a longitude/latitude scatter so it renders everywhere.
- The target is complaint counts, never decibels. This must stay visible on the first screen.
- Terminology: WAPE (weighted absolute percentage error), MASE (scaled against seasonal-naive error), sMAPE, coverage, baseline, holdout, rolling origin.
- Honest result to preserve: the model is about 4% better than last-week persistence on weighted error, wins 3 of 4 quarters, loses the Nov 2025 quarter that holds an unexplained citywide surge, and has worse RMSE and R2 than persistence.

## Brand Commitments
None beyond honesty of claims. No emoji. No invented numbers.

## Evidence on Hand
`data/metrics.json`, `data/backtest.csv.gz`, `data/forecast.csv`, `data/weekly_panel.csv.gz`, `data/hourly.csv`, `data/zips.csv`, `data/manifest.json`, `docs/decisions.md`. There are no borough or neighborhood labels, population figures, weather or event data; do not fabricate them.

## Product Principles
1. Evidence before claims: every accuracy statement sits next to the baseline it beats or loses to.
2. Everything is explorable: any number on screen can be traced to a ZIP, a week, and a model.
3. Your ZIP first: relative-to-normal is the unit that makes busy and quiet ZIPs comparable.
4. Say what the data is: complaints are reports, not sound.
5. Weak spots are shown, not hidden.

## Accessibility & Inclusion
Color is never the only carrier of meaning (forecast direction also encoded by value and label). Text contrast at least 4.5:1. Keyboard-reachable controls. Mobile-usable at 390px wide.
