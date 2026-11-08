# Decisions

Short records of the choices that shape the project, with what was rejected and why.

## 1. Forecast complaint counts, not "noise levels"

311 complaints are reports, not measurements. They track how often people call, which depends on population density, app awareness, enforcement and events as much as on sound. The first version of this repo scored "decibel-like" noise from hand-weighted subway, highway and flight proximity and then trained a model to predict that score from the same inputs, which is circular. v1 predicts the one quantity the data actually contains: next week's complaint count per ZIP. The dashboard says what the number means on its first screen.

## 2. Weekly, ZIP-level grain

- Daily counts per ZIP are mostly small integers with weekday noise; weekly counts are stable enough to forecast and still actionable (staffing, outreach).
- ZIP is the finest geography present on nearly every record. Latitude/longitude are missing or approximate for many rows. A finer grid (H3, community district) is a later option, not a v1 need.
- Weeks start Monday and are only kept when complete, so the last row is never a partial week.
- Missing ZIP-weeks are zero-filled. A dense panel makes `shift(k)` mean "k weeks ago", and zero is a real observation.

## 3. Evaluation: time holdout, baselines first

- Last 52 target weeks are held out; hyperparameters are chosen by expanding-window CV on whole weeks. A random split would let the model see weeks after the ones it is scored on.
- Every number is reported next to three naive baselines (last week, 4-week mean, same week last year). A model that does not beat them is not a result.
- Metrics: WAPE (scale-free across busy and quiet ZIPs), MASE (against seasonal-naive error on the training years), sMAPE, plus MAE/RMSE/R2 for familiarity. R2 alone is misleading on counts that span orders of magnitude.
- A rolling-origin check refits before each quarter of the holdout, so one lucky quarter cannot carry the headline.
- Leakage is tested directly: the features for week t must not change when every later week is altered.

## 4. Scale-free target

Counts differ by 50x between ZIPs. Predicting `y / mean52` lets one model serve all of them and makes lag features comparable. The prediction is multiplied back by the scale. Rejected: one model per ZIP (too little data per series), log transform (zero-heavy quiet ZIPs).

## 5. Conformal intervals instead of a raw quantile model

Quantile gradient boosting alone under-covers when the future differs from the past. Here the quantile models are fit before a calibration window and widened by the conformal residual quantile on that window (CQR). Coverage is then measured on the untouched holdout, overall and per ZIP, and shown on the dashboard rather than assumed.

## 6. Two model families, not a zoo

Random forest and histogram gradient boosting, small grids, same features. Enough to show a comparison under honest CV; no deep learning, because 177 ZIPs x ~250 weeks of tabular counts does not call for it. The original Readme's Spark, Dask, TensorFlow, PyTorch, Kubernetes and MLflow claims were removed because no code used them.

## 7. Data architecture: raw, panel, results, app

```
Socrata API -> data/raw/YYYY-MM.csv.gz   (cached, gitignored, idempotent)
            -> data/weekly_panel.csv.gz  (validated, committed)
            -> model -> metrics.json, backtest.csv.gz, forecast.csv (committed)
            -> web/public/data/*.json    (export) -> React app on Vercel
```

- Monthly raw files make re-runs cheap and the API throttling survivable; the most recent ~5 weeks are always re-fetched because 311 rows are revised after creation.
- The app reads precomputed tables, so deployment needs no secrets, no model files and no network. A weekly GitHub Action rebuilds the tables, runs the tests and commits.
- Aggregating on the server (SoQL `group by`) was tried first and timed out; pulling narrow raw rows and aggregating locally was faster and keeps the raw layer reusable.
- Rejected: Airflow (one weekly job), a database (a few MB of CSV), a model registry (one model, metrics committed beside the code).

## 8. Known limits

- Reporting behavior shifts over time; a policy or app change can break the seasonal pattern the model learned.
- No weather, holiday or event covariates yet.
- The map places each ZIP at the mean location of its complaints, not its polygon.
- Intervals are marginal; per-ZIP coverage varies and is reported.

## 9. What was tried and dropped

After the first holdout evaluation I tried a richer feature set: extra lags and rolling windows (2, 8, 13 weeks), 4-week volatility, federal-holiday days in the target week, and citywide context (the whole city's recent level). Selection rule, set beforehand: keep it only if training-period CV error improves. It did not (CV MAE 0.2902 vs 0.2875 relative; holiday days had near-zero importance), so v1 features were restored and the final numbers are v1's. Because I had already seen the holdout when trying this, the dropped variant could not honestly have been presented as a held-out gain either way; the point of recording it is that it was not selected on the holdout.

## 10. The Nov 2025 surge

The first holdout quarter has citywide weekly totals jumping from about 14,000 to 20,000-24,000 for three weeks from 2025-11-24, then collapsing to about 10,000. The cause is not identified. It is the main reason the model loses that quarter to last-week persistence. It is kept in the evaluation: excluding it would improve the headline and weaken the claim.

## 11. Map without a basemap

The first version used a tiled map. It could not be verified in the preview environment and added a dependency on a tile service and WebGL. The final version is a plain longitude/latitude scatter with a corrected aspect ratio: it renders identically everywhere, and the NYC outline is recognizable from the 177 ZIP positions.

## 12. Dashboard: evidence first, everything linked

The dashboard follows a statistical-atlas world (classed tints, framed plates, italic captions under figures) because the job is reading data, not browsing. Two choices matter beyond looks. The map's legend is a histogram of ZIPs per class that doubles as the filter, so the distribution and the control are one object. Error is shown as a race with the baselines on the same axes, with the surge weeks shaded, so the weak quarter cannot be missed. Every figure on the Scorecard is computed from the same backtest table the headline reads, and a test asserts the end of the cumulative curve equals the reported WAPE.

Tried and removed: a click-on-bubble pin on the map (selection events did not register in the preview environment and could not be verified, so ZIPs are pinned from the table or the picker); a tiled basemap (see 11).

## 13. A second model for "why here", on a hex grid

The forecast says how many complaints a ZIP will get; it cannot say why a block is loud. A cross-sectional model on H3 resolution-9 cells (~174 m edge, the "250 m" grain) explains two years of complaints from 24 measured features: road class and truck routes (OSM, NYC DOT), surface and elevated rail, stations, airports and heliports (OSM), bar, restaurant, venue and off-premises liquor licences (NY SLA), after-hours construction variances (NYC DOB), fire stations and hospitals for sirens, parks, and PLUTO built form. Distances are computed in EPSG:2263 feet, never haversine to a line.

- Exposure first: residential units are both a feature and the baseline; the headline is the gain over a units-only model, because more people means more callers.
- Spatial cross-validation by H3 resolution-6 parents. Random folds are reported beside it (0.74 against 0.67 deviance explained) to show the leak.
- Poisson gradient boosting; SHAP values are in log-rate space and shown as multipliers.
- Per-type sanity checks (helicopter vs heliports, commercial vs bars, vehicle vs truck routes) must point the right way before any driver is shown. All five do; vehicle vs truck routes is weak.
- Language is "associated with" throughout. Distances to rare features (three airports, a handful of stadiums) rank high partly as location proxies; the app says so.
- Rejected: per-ZIP factor regression (too coarse to say what is near a point), causal claims, a GLM as the primary model (kept as an option; the GBM with SHAP gave per-cell explanations at better held-out fit).

## 14. Repeat callers

Raw 311 counts are dominated by a few addresses: one Bronx building filed about 150,000 residential complaints in two years, one Upper West Side address most of the city's helicopter complaints. For the spatial model each exact address counts at most once per day per complaint type ("complaint-days"), which cut the window from 1.6M reports to 1.05M complaint-days. Raw reports stay available and the app shows them when they differ a lot. The ZIP forecast still models raw volume, since that is what 311 receives; this is listed as a limitation.

## 15. From Streamlit to React + deck.gl

The owner asked for an immersive, sound-like experience rather than a dashboard of circles. Streamlit could not run a GPU heat terrain with animated rings at frame rate, and its plot selection events proved unreliable. The pipeline now exports compact JSON (about 2.5 MB, 0.7 MB gzipped) and a static React app renders it with deck.gl (H3 hexagons, rings), MapLibre (CARTO dark basemap) and Observable Plot, deployed on Vercel. The Streamlit app was removed. Motion stops under reduced-motion preferences.
