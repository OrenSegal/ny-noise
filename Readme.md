# NYC Noise Field

Where New York is loud, what goes with it block by block, and next week's 311 noise forecast by ZIP code.

**Live: [ny-noise.vercel.app](https://ny-noise.vercel.app)**

Two models, kept apart on purpose:

1. **A spatial model** that explains where complaints concentrate on a ~250 m hex grid, from 27 measured features of the surroundings, against complaints with repeat callers capped (below). Sound sources are measured where people live: each home is scored for expressways, arterials, through truck routes, surface and elevated rail (line fall-off) and bars, restaurants, outdoor dining, venues and liquor stores (inverse-square, within 150 m), then averaged over the block's homes. Also subway ridership at nearby stations, airports, heliports, open-air stadiums, indoor arenas, after-hours construction permits, fire stations, hospitals, parks, and the built form. It explains; it does not forecast, and its effects are associations, not causes.
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

6,530 hex cells (H3 resolution 9), 784k damped complaints (from 1.05M complaint-days and 1.6M raw reports) from 2024-11-04 to 2026-11-01. Scored with spatial cross-validation: each fold holds out whole ~36 km² areas, so a cell is never judged by a model that saw its neighbours.

| Model (spatial CV) | Poisson deviance explained | Rank correlation | MAE per cell |
|---|---|---|---|
| **Full: 27 features** | **0.758** | **0.87** | **52** |
| Residential units only (exposure) | 0.660 | 0.81 | 65 |
| Full, random folds (leaky) | 0.824 | 0.90 | 44 |
| Day only (06 to 22) | 0.708 | 0.86 | 29 |
| Night only (22 to 06) | 0.743 | 0.86 | 26 |

Urban factors add 0.098 of deviance over exposure alone. Random folds would overstate fit by about the same amount, which is why they are not the headline. Per-type checks all point the expected way: helicopter complaints rise near heliports (Spearman -0.33 with distance), commercial and street complaints with bar exposure at homes (0.56, 0.45), vehicle complaints with through truck exposure (0.09, weak), residential with housing units (0.83).

Strongest associations after exposure: liquor-store and bodega exposure, commercial floor area, building height, elevated rail, and distance to parks. Night is explained better than day; liquor stores and airports matter more at night, commercial floor area by day. Distances to the few airports and stadiums rank high partly because they encode location itself; read them as geography.

### Forecast: next week by ZIP

Scored once on the last 52 weeks (2025-11-03 to 2026-10-26, 9,204 ZIP-weeks), never seen in training or model selection.

| Forecast | MAE | WAPE | sMAPE | MASE | R² |
|---|---|---|---|---|---|
| **Random forest (selected)** | 22.98 | **26.8%** | 28.4% | **0.66** | 0.39 |
| Last week (persistence) | 23.91 | 27.9% | 33.3% | 0.69 | 0.58 |
| Mean of last 4 weeks | 24.60 | 28.7% | 29.6% | 0.71 | 0.18 |
| Histogram gradient boosting | 24.55 | 28.7% | 29.2% | 0.71 | 0.29 |
| Same week last year | 40.26 | 47.0% | 40.6% | 1.16 | -2.18 |

A modest edge: 4% lower weighted error than persistence, ahead in 3 of 4 rolling-origin quarters, behind on RMSE and R² (it lags big jumps in the busiest ZIPs). The quarter it loses holds an unexplained citywide surge (Nov 24 to Dec 8, 2025). 80% intervals covered 79.8% of the holdout; median ZIP 81%.

## The app

- **Heatmap** (default): a smooth ~50 m raster of complaints (repeat callers capped), filterable to day or night, or a continuous noise field for expressways, elevated rail, or bars and clubs, computed on a grid over the whole city so each road glows along its full open-air length. Hicks Street's BQE frontage reads as a hot ribbon against Brooklyn Heights behind it.
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
    B --> H[hex cells + 27 features]
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
python -m nynoise.factors   # hex grid + 27 features (downloads ~150 MB of sources once)
python -m nynoise.spatial   # spatial model, block CV, SHAP drivers
python -m nynoise.export    # JSON for the web app
```

```bash
cd web && npm install && npm run dev
```

Training is seeded; rerunning on the committed tables reproduces the metrics. Set `SOCRATA_APP_TOKEN` to avoid NYC Open Data throttling.

## Limitations

- 311 measures reporting, not sound. A dense, engaged block complains more than an equally loud quiet one.
- Repeat callers dominate raw counts (one Bronx address filed ~150,000 reports in two years; 1% of addresses file 26% of complaint-days). The map and spatial model count each address at most once per day per type and at most 24 times in two years; the ZIP forecast still models raw volume.
- Open Restaurants records cover the 2020-2023 temporary programme; ridership is 2024.
- Factor snapshots are current (2026 licences, permits, roads) against two years of complaints.
- Associations, not causes; distances to rare features partly encode location.
- No weather or event data; abrupt citywide shifts are not predictable from history.

Design choices and what was rejected: [docs/decisions.md](docs/decisions.md). Scope: [docs/PRD.md](docs/PRD.md).
