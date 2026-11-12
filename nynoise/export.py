"""Export the analytical tables as compact JSON for the web app (web/public/data/).

Run `python -m nynoise.export` after the data, model, factors and spatial steps.
Arrays are columnar and rounded so the whole bundle stays small; the schema is checked by tests.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from nynoise import analysis as an
from nynoise.data import DATA_DIR
from nynoise.spatial import FEATURES

WEB = DATA_DIR.parent / "web" / "public" / "data"
HISTORY_WEEKS = 104


def _r(a, nd=3):
    return [None if pd.isna(v) else round(float(v), nd) for v in a]


def cells_json(cells: pd.DataFrame, scored: pd.DataFrame, meta: dict) -> dict:
    c = cells.merge(scored, on="h3")
    feats = list(FEATURES)
    fidx = {f: i for i, f in enumerate(feats)}
    years = meta["weeks"] / 52
    types = [t for t in ("residential", "street", "vehicle", "commercial", "helicopter", "park", "other") if t in c]
    X = c.assign(log_units=np.log1p(c["units"]), log_retail=np.log1p(c["retail_area"]),
                 log_commercial=np.log1p(c["commercial_area"]),
                 log_income=np.log(c["median_income"].clip(lower=1)) if "median_income" in c else 0.0)
    as_list = lambda s: s if isinstance(s, list) else json.loads(s)
    return {
        "months": meta["months"], "window": [meta["window_start"], meta["window_end"]], "years": years,
        "features": feats, "types": types,
        "h3": c["h3"].tolist(),
        "complaints": c["complaints"].astype(int).tolist(),
        "reports": c["reports"].astype(int).tolist(),
        "days": c["complaint_days"].astype(int).tolist(), "top_share": _r(c["top_address_share"], 2),
        "expected": _r(c["expected"], 1), "oof": _r(c["oof_expected"], 1), "base": _r(c["base_expected"], 1),
        "units": c["units"].astype(int).tolist(), "night": _r(c["night_share"], 2),
        "type_counts": [c[t].astype(int).tolist() for t in types],
        "monthly": [[round(v, 1) for v in as_list(m)] for m in c["monthly"]],
        "x": [_r(X[f], 2) for f in feats],
        "drivers": [[[fidx[f], m] for f, m in as_list(d)] for d in c["drivers"]],
        "quieters": [[[fidx[f], m] for f, m in as_list(d)] for d in c["quieters"]],
    }


def heat_json(complaints: pd.DataFrame, exposure: pd.DataFrame) -> dict:
    """~66 m points for the map's density layers: damped complaints (all, night) and the exposure field."""
    ex = exposure[exposure[["highway", "elevated", "bar", "traffic"]].sum(axis=1) > 0]  # empty grid points draw nothing anyway
    return {"complaints": {"lat": complaints["lat"].tolist(), "lon": complaints["lon"].tolist(),
                           "all": _r(complaints["all"], 2), "night": _r(complaints["night"], 2)},
            "exposure": {"lat": ex["lat"].tolist(), "lon": ex["lon"].tolist(),
                         **{k: _r(ex[k], 3) for k in ("highway", "elevated", "bar")}, "traffic": _r(ex["traffic"], 1)}}


def forecast_json(fc: pd.DataFrame, zips: pd.DataFrame, panel: pd.DataFrame, bt: pd.DataFrame) -> dict:
    f = fc.merge(zips, on="zip")
    weeks = sorted(panel["week"].unique())[-HISTORY_WEEKS:]
    hist = panel[panel["week"].isin(weeks)].pivot(index="zip", columns="week", values="n").reindex(f["zip"]).fillna(0)
    bweeks = sorted(bt["target_week"].unique())
    piv = {k: bt.pivot(index="zip", columns="target_week", values=k).reindex(f["zip"]) for k in ("pred", "lo", "hi", "actual")}
    return {
        "target_week": f"{f['target_week'].iloc[0]:%Y-%m-%d}",
        "weeks": [f"{w:%Y-%m-%d}" for w in pd.to_datetime(weeks)],
        "bt_weeks": [f"{w:%Y-%m-%d}" for w in pd.to_datetime(bweeks)],
        "zips": [{"zip": r.zip, "lat": round(r.lat, 5), "lon": round(r.lon, 5), "pred": round(r.pred, 1), "lo": round(r.lo, 1),
                  "hi": round(r.hi, 1), "last": int(r.last_week), "typical": round(r.typical, 1),
                  "n": hist.loc[r.zip].astype(int).tolist(),
                  "bt": {k: _r(piv[k].loc[r.zip], 1) for k in piv}} for r in f.itertuples()],
    }


def scorecard_json(metrics: dict, race: pd.DataFrame, hits: pd.DataFrame, surges) -> dict:
    run = an.running_error(race)
    weeks = sorted(run["target_week"].unique())
    cov = hits.groupby("target_week")["hit"].mean().reindex(weeks)
    return {**metrics, "race": {"weeks": [f"{w:%Y-%m-%d}" for w in pd.to_datetime(weeks)],
                                **{m: _r(run[run["model"] == m].set_index("target_week")["cum_wape"].reindex(weeks), 4) for m in an.MODELS}},
            "weekly_coverage": _r(cov, 3),
            "surges": [f"{w:%Y-%m-%d}" for w in surges if w >= weeks[0] - pd.Timedelta(weeks=1)],
            "model_labels": {**an.MODELS, "model": an.MODEL_NAMES[metrics["best_model"]]}}


def main(data_dir: Path = DATA_DIR, out: Path = WEB) -> None:
    out.mkdir(parents=True, exist_ok=True)
    z = dict(dtype={"zip": str})
    panel = pd.read_csv(data_dir / "weekly_panel.csv.gz", parse_dates=["week"], **z)
    bt = pd.read_csv(data_dir / "backtest.csv.gz", parse_dates=["target_week"], **z)
    fc = pd.read_csv(data_dir / "forecast.csv", parse_dates=["target_week"], **z)
    zips = pd.read_csv(data_dir / "zips.csv", **z)
    metrics = json.loads((data_dir / "metrics.json").read_text())
    race = an.race_frame(panel, bt, round(metrics["exp_smoothing_alpha"] * 10))
    files = {
        "cells.json": cells_json(pd.read_csv(data_dir / "cells.csv.gz"), pd.read_csv(data_dir / "cells_scored.csv.gz"),
                                 json.loads((data_dir / "cells_meta.json").read_text())),
        "spatial.json": json.loads((data_dir / "spatial_metrics.json").read_text()),
        "forecast.json": forecast_json(fc, zips, panel, bt),
        "scorecard.json": scorecard_json(metrics, race, an.interval_hits(bt), an.surge_weeks(panel)),
        "hourly.json": pd.read_csv(data_dir / "hourly.csv").to_dict(orient="list"),
        "heat.json": heat_json(pd.read_csv(data_dir / "heat_points.csv.gz"), pd.read_csv(data_dir / "exposure_points.csv.gz")),
        "manifest.json": json.loads((data_dir / "manifest.json").read_text()),
    }
    for name, obj in files.items():
        (out / name).write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False))
        print(f"{name}: {(out / name).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
