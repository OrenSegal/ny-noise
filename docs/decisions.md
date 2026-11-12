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
- Metrics: WAPE (scale-free across busy and quiet ZIPs), MASE (against the in-sample error of repeating last week; seasonal-naive is the weakest baseline here and flattered the ratio), sMAPE, plus MAE/RMSE/R2 for familiarity. R2 alone is misleading on counts that span orders of magnitude.
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

## 16. Venues measured as sound at homes, not counts within 300 m

v2 counted bars, restaurants and venues within 300 m of the cell centre. That smeared one bar across a whole neighbourhood and measured from an arbitrary point. A hard 30 m cutoff fails the other way: from a cell centre most homes would read zero. Now each venue's contribution is computed at every residential lot (PLUTO) as (30 m / distance)², the inverse-square fall-off of sound with a 30 m reference, floored at 10 m so a bar in the same building counts 9 rather than infinity, and ignored beyond 150 m. The cell value is the average over its homes weighted by residential units, so the people who can complain set the number. The distance from homes to the nearest bar and the nearest restaurant are added the same way. Roads and rail moved to the same at-home approach later (see 17); permits keep a count.

## 17. Roads and rail measured at homes too, and a ~65 m heat layer

Hicks Street, beside the BQE trench below Brooklyn Heights, did not stand out: a 300 m window around a ~250 m cell centre mixed homes on the expressway with homes two blocks inland. Line sources now use the same at-home approach as venues, with the cylindrical fall-off of a line: each lot scores 30 m / distance to the nearest line (floored at 10 m, zero beyond 500 m), about 3 dB less per doubling of distance. Tunnels and covered sections are excluded. Expressways, arterials, through truck routes, surface rail and elevated rail each get an exposure, and distance to the nearest expressway and elevated line are kept as home averages. Homes on Hicks Street now average 0.37 expressway exposure (95th percentile citywide) against 0.08 two blocks inland.

The map's default view is now a flat heatmap built from H3 resolution-10 points (~65 m): complaint-days (all, day, night) are summed as a density, and exposure is averaged as a level on a fixed scale so dense neighbourhoods do not look louder for having more homes. The ~250 m blocks remain the unit of the model, the legend, the ranking and the drawer. The ranking of a measured factor skips cells with no homes, whose value falls back to the cell centre.

## 18. Arenas are not stadiums; time of day

Madison Square Garden and Barclays Center are indoor arenas; crowds and traffic are the noise, not the event. Major venues of 1.5 ha or more from OpenStreetMap are split into open-air stadiums and indoor arenas (by name or a covered tag; Forest Hills Stadium stays open-air), with a distance to each.

Time of day matters: 311 has a creation time, so night (22:00 to 06:00) complaint-days are counted per cell. The app filters the heatmap to day or night and the drawer gives a block's night percentile. Separate day and night spatial models are fitted with the same block CV; night is explained slightly better (D² 0.69 vs 0.61 for day), and airport distance and off-premises liquor density matter more at night, commercial floor area more by day.

## 19. One voice per address

Even after counting complaint-days, 1% of exact locations (2,545) filed 26% of them, and a block's colour could come from one person. Each address now counts at most 24 complaint-days over the two-year window (about one a month); above that, each of its days is scaled down so the address totals 24. Timing is kept, so day/night and month views stay consistent. This cut 1.05M complaint-days to 784k. The spatial model got markedly more predictable from the city's fabric (block-CV D² 0.678 to 0.758; gain over housing alone 0.070 to 0.098), which is what removing reporter noise rather than signal should look like. The drawer still shows raw reports, address-days and the top address's share. Rejected: counting distinct addresses only (erases genuinely chronic sources) and per-capita rates (the model already conditions on housing; "observed / expected" is the per-fabric view).

## 20. A field, not points

The exposure layer is computed on every ~65 m grid cell in the modelled area, homes or not, so an expressway is drawn along its whole open-air length out to 500 m, through parks and industrial land. Both heat layers are rasterised in the browser into a ~50 m image with a Gaussian splat (exposure as a weighted mean, complaints as a density on a square-root scale fixed from the whole city) and drawn as one bitmap; the GPU interpolates it at every zoom. deck.gl's HeatmapLayer was dropped: its pixel-radius kernel left a lattice of dots at street zoom and re-scaled colours with every pan.

## 21. Two more sources

Open Restaurants sidewalk and roadway seating (NYC Open Data pitm-atqc, 2020-2023) enters as outdoor-dining exposure at homes, and 2024 MTA subway ridership (data.ny.gov wujg-7c2s, aggregated per station on the server) replaces a plain station count. Both add little after the existing nightlife and density features (importance 0.04 and 0.01), and are kept as measured nulls. Considered next: DOT traffic volume counts to weight roads by vehicles (patchy coverage), permitted street events, DOT street-works permits, and ACS renter share and income as reporting-propensity controls.

## 22. Traffic volumes by road class, and who reports

DOT's automated counts cover about 3,400 road segments since 2009, too few to map traffic street by street; a "nearest count" feature would mostly measure where DOT happened to count. The counts are used instead to calibrate a daily volume per OSM road class (counts snapped to a road of that class within 60 ft; medians: expressway 44,600, trunk 15,800, primary 13,700, secondary 8,200 vehicles). The estimated traffic level at a home is 10 log10(1 + sum over classes of volume x 30 m / distance), so energies from several roads add as sound does. It ranks low in the model (people rarely call 311 about steady traffic) but becomes the map's "All roads" field.

311 measures willingness to report as well as sound. Renter share and median household income per 2020 census tract (ACS 2020-2024 5-year, B25003 and B19013, via Census Reporter because the Census Bureau API now requires a key) enter as reporting-propensity controls, averaged over each block's homes. Renter share became the strongest factor after housing (about 1.5x from 11% to 78% renters); income is weakly negative. Block-CV D2 rose from 0.758 to 0.769. With them in the model, "observed / expected" compares a block with blocks that have similar housing and similar reporters, not just similar buildings.
