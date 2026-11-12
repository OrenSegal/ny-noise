# NYC Noise Field

Where New York is loud, what goes with it block by block, and next week's 311 noise forecast by ZIP code.

**Live: [ny-noise.vercel.app](https://ny-noise.vercel.app)**

Two models, kept apart on purpose:

1. **A spatial model** that explains where complaints concentrate on a ~250 m hex grid, from 30 measured features of the surroundings, against complaints with repeat callers capped (below). Sound sources are measured where people live: each home is scored for expressways, arterials, through truck routes, surface and elevated rail (line fall-off) and bars, restaurants, outdoor dining, venues and liquor stores (inverse-square, within 150 m), then averaged over the block's homes. An estimated road-traffic level in relative dB weights every expressway and avenue by the daily volume DOT counts measured on roads of its class. Census renter share and median income (ACS 2020-2024, by tract) control for who reports. Also subway ridership at nearby stations, airports, heliports, open-air stadiums, indoor arenas, after-hours construction permits, fire stations, hospitals, parks, and the built form. It explains; it does not forecast, and its effects are associations, not causes.
2. **A forecast** of next week's complaints for each of 177 ZIP codes, with calibrated 80% ranges, scored against naive baselines.

## Who it is for

| Who | Question it answers | Where |
|---|---|---|
| Renters and buyers | How noisy is this address compared with the rest of the city, at night, and what around it goes with that? | Address search, block drawer (percentile, night share, top associations) |
| Venues, community boards, 311 and enforcement staff | Which blocks run louder than their fabric predicts, and what will next week look like by ZIP? | Observed / expected lens, ranked list, ZIP forecast with ranges |
| Planners and researchers | Which urban features go with complaints, by how much, and how robustly? | Factor curves, sanity checks, spatial-CV scores, CSV download of every block |
| Reviewers of the work | Is the evaluation honest? | Baseline race, rolling-origin quarters, interval coverage, decision log |

What it cannot tell you: how loud a place is in decibels (311 records reports), whether a bar *causes* complaints (associations only), or anything about one apartment rather than a ~250 m block. Links are shareable: the URL keeps the lens and the selected block.

## Results

### Spatial model: what goes with noise near a point

<!-- results:spatial -->
6,532 hex cells (H3 resolution 9), 785k damped complaints (from 1.05M complaint-days and 1.6M raw reports) from 2024-11-11 to 2026-11-08. Scored with spatial cross-validation: each fold holds out whole ~36 km² areas, so a cell is never judged by a model that saw its neighbours.

| Model (spatial CV) | Poisson deviance explained | Rank correlation | MAE per cell |
|---|---|---|---|
| **Full: 30 features** | **0.775** | **0.88** | **49** |
| Residential units only (exposure) | 0.660 | 0.81 | 65 |
| Full, random folds (leaky) | 0.827 | 0.90 | 43 |
| Day only (06 to 22) | 0.715 | 0.87 | 29 |
| Night only (22 to 06) | 0.770 | 0.86 | 25 |

Urban and census factors add 0.115 of deviance over exposure alone. Spearman correlations for the per-type checks: helicopter complaints against distance to a heliport -0.34; commercial complaints against bars and clubs heard from homes +0.56; vehicle complaints against through truck routes heard from homes +0.09; street complaints against bars and clubs heard from homes +0.46; residential complaints against residential units in cell +0.83.
<!-- /results:spatial -->

Renter share is the strongest after housing: a block in a tract with 78% renters runs about 1.5x the complaints of one with 11%, everything else equal. That is reporting propensity as much as sound, and it is why the observed / expected lens is the fairer comparison between neighbourhoods. Measured traffic volume adds little; people rarely call 311 about steady traffic. Random folds would overstate fit by about the same amount, which is why they are not the headline. Each complaint type lines up with its obvious source: helicopter complaints rise near heliports, commercial and street complaints with bar exposure at homes, residential with housing units; vehicle complaints track through truck exposure only weakly.

Strongest associations after exposure: liquor-store and bodega exposure, commercial floor area, building height, elevated rail, and distance to parks. Night is explained better than day; liquor stores and airports matter more at night, commercial floor area by day. Distances to the few airports and stadiums rank high partly because they encode location itself; read them as geography.

### Forecast: next week by ZIP

<!-- results:forecast -->
Scored on the most recent 52 weeks (2025-11-10 to 2026-11-02, 9,204 ZIP-weeks), which that run held out of training and model selection. The refresh job reruns every week, so the holdout slides forward a week at a time and consecutive scorecards share all but one week. This block is rewritten from `data/metrics.json` by `python -m nynoise.readme`.

| Forecast | MAE | WAPE | sMAPE | MASE | R² |
|---|---|---|---|---|---|
| **Histogram gradient boosting (selected)** | **22.38** | **26.2%** | **28.6%** | **0.64** | **0.56** |
| Random forest | 22.90 | 26.8% | 28.3% | 0.66 | 0.36 |
| Last week (persistence) | 23.97 | 28.0% | 33.3% | 0.69 | 0.58 |
| Mean of last 4 weeks | 24.30 | 28.4% | 29.6% | 0.70 | 0.20 |
| Same week last year | 40.33 | 47.1% | 40.6% | 1.16 | -2.18 |

6.7% lower weighted error than last week (persistence), the best naive baseline; ahead of last week in 3 of 4 rolling-origin quarters; behind on RMSE (157 against 156). 80% intervals covered 79.7% of the holdout; median ZIP 81%.
<!-- /results:forecast -->

A modest edge. The model lags big jumps in the busiest ZIPs, and the first holdout quarter holds an unexplained citywide surge (Nov 24 to Dec 8, 2025) that no forecast here anticipated.

## The app

- **Heatmap** (default): a smooth ~50 m raster of complaints (repeat callers capped), filterable to day or night, or a continuous noise field for all roads (volume-weighted, in relative dB), expressways, elevated rail, or bars, computed on a grid over the whole city so each road glows along its full open-air length. Hicks Street's BQE frontage reads as a hot ribbon against Brooklyn Heights behind it.
- **Block map**: a flat map of ~250 m hex blocks in seven classed bins with printed break values; the legend is a histogram of blocks per class and filters the map. Lenses: complaints, expected from the city's fabric, observed against expected, or any single factor. A ranked list shows the top blocks for the current lens; a month scrubber replays two years on fixed breaks.
- **Find an address** (NYC Planning GeoSearch) to jump to its block.
- **Click any block**: its percentile among NYC blocks overall and at night, complaints against expectation, raw reports and how much of them one address filed, night share, the factors most associated with its noise as multipliers, complaint types, and a month-by-month trace.
- **Below the map**: factor importance and dependence curves, the sanity checks, next week's ZIP forecast with its backtest, the forecast-versus-baseline race, interval coverage, and a weekday-by-hour heatmap.

React + deck.gl + MapLibre (CARTO dark basemap) + Observable Plot, on Vercel. Fonts: Bricolage Grotesque and Schibsted Grotesk (SIL OFL), self-hosted.

## Pipeline

```mermaid
flowchart LR
    A[311 API] -->|monthly, cached| B[data/raw]
    S[DOB permits, SLA licences, DOT truck routes, PLUTO, OpenStreetMap] -->|cached| B
    B --> C[weekly ZIP panel]
    B --> H[hex cells + 30 features]
    C --> D[forecast model<br/>time holdout, CQR intervals]
    H --> E[spatial model<br/>block CV, SHAP]
    D --> J[web/public/data/*.json]
    E --> J
    J --> W[React app on Vercel]
    G[GitHub Action, weekly] -.-> A
```

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

```bash
python -m nynoise.data      # 311 ingest -> weekly ZIP panel
python -m nynoise.model     # forecast, backtest, metrics
python -m nynoise.factors   # hex grid + 30 features (downloads ~150 MB of sources once)
python -m nynoise.spatial   # spatial model, block CV, SHAP drivers
python -m nynoise.export    # JSON for the web app
python -m nynoise.readme    # rewrite the results tables above from data/*.json
```

```bash
cd web && npm install && npm run dev
```

Training is seeded; rerunning on the committed tables reproduces the metrics. Set `SOCRATA_APP_TOKEN` to avoid NYC Open Data throttling.

## Limitations

- 311 measures reporting, not sound. A dense, engaged block complains more than an equally loud quiet one.
- Repeat callers dominate raw counts (one Bronx address filed ~150,000 reports in two years; 1% of addresses file 26% of complaint-days). The map and spatial model count each address at most once per day per type and at most 24 times in two years; the ZIP forecast still models raw volume.
- Open Restaurants records cover the 2020-2023 temporary programme; ridership is 2024; traffic volumes are class medians from DOT counts since 2009, not per-street measurements.
- Census values come from ACS 2020-2024 via Census Reporter (the Census Bureau API now requires a key).
- Factor snapshots are current (2026 licences, permits, roads) against two years of complaints.
- Associations, not causes; distances to rare features partly encode location.
- No weather or event data; abrupt citywide shifts are not predictable from history.

Design choices and what was rejected: [docs/decisions.md](docs/decisions.md). Scope: [docs/PRD.md](docs/PRD.md).
