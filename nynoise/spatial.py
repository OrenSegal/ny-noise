"""What is associated with noise complaints near a point: a cross-sectional model on the hex grid.

Run `python -m nynoise.spatial` after `python -m nynoise.factors`. Writes data/spatial_metrics.json
and data/cells_scored.csv.gz.

This model explains where complaints concentrate over a two-year window; it does not forecast
and its drivers are associations, not causes. Key choices:
  * Target: complaint count per cell over 104 weeks, Poisson loss (counts, many zeros).
  * Exposure: residential units (PLUTO) are a feature and the baseline. The headline is the
    skill of the full model over a units-only model, not raw fit.
  * Spatial cross-validation: folds are whole H3 resolution-6 parents (~36 km^2), so a cell is
    never scored by a model that saw its neighbours. Random-fold scores are reported beside it
    to show how much they flatter.
  * SHAP values are in log-rate space; we report them as multiplicative effects, exp(value).
"""
from __future__ import annotations

import json
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import d2_tweedie_score, mean_absolute_error
from sklearn.model_selection import GroupKFold, KFold

from nynoise.data import DATA_DIR

FEATURES = {
    # name: (label, group, unit)
    "log_units": ("Residential units in cell", "People", "log units"),
    "floors": ("Average building height", "Built form", "floors"),
    "log_retail": ("Retail floor area in cell", "Business", "log sq ft"),
    "log_commercial": ("Commercial floor area in cell", "Business", "log sq ft"),
    "bar_exposure": ("Bars and clubs heard from homes", "Nightlife", "bar-equivalents at 30 m"),
    "d_bar": ("Distance from homes to the nearest bar", "Nightlife", "ft"),
    "restaurant_exposure": ("Restaurants heard from homes", "Nightlife", "equivalents at 30 m"),
    "d_restaurant": ("Distance from homes to the nearest restaurant", "Nightlife", "ft"),
    "venue_exposure": ("Theatres, venues and nightclubs heard from homes", "Nightlife", "equivalents at 30 m"),
    "offprem_exposure": ("Bodegas and liquor stores near homes", "Business", "equivalents at 30 m"),
    "highway_exposure": ("Expressway traffic heard from homes", "Roads", "line-equivalents at 30 m"),
    "d_highway": ("Distance from homes to an open-air expressway", "Roads", "ft"),
    "arterial_exposure": ("Major-avenue traffic heard from homes", "Roads", "line-equivalents at 30 m"),
    "truck_exposure": ("Through truck routes heard from homes", "Roads", "line-equivalents at 30 m"),
    "rail_exposure": ("Above-ground rail heard from homes", "Rail and air", "line-equivalents at 30 m"),
    "elevated_exposure": ("Elevated rail heard from homes", "Rail and air", "line-equivalents at 30 m"),
    "d_elevated_rail": ("Distance from homes to elevated rail", "Rail and air", "ft"),
    "n_stations": ("Rail and subway stations within 600 m", "Rail and air", "stations"),
    "d_airport": ("Distance to LGA, JFK or EWR", "Rail and air", "ft"),
    "d_heliport": ("Distance to a heliport", "Rail and air", "ft"),
    "n_ahv": ("After-hours construction permits within 300 m", "Construction", "permits / 2 yrs"),
    "d_stadium": ("Distance to an open-air stadium", "Nightlife", "ft"),
    "d_arena": ("Distance to an indoor arena (MSG, Barclays)", "Nightlife", "ft"),
    "d_fire_station": ("Distance to a fire station", "Sirens", "ft"),
    "d_hospital": ("Distance to a hospital", "Sirens", "ft"),
    "d_park": ("Distance to a park of 1 ha or more", "Green space", "ft"),
}
PARAMS = dict(loss="poisson", max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
              min_samples_leaf=40, l2_regularization=1.0, random_state=0)
CHECKS = [  # (complaint type, feature, expected sign): does each type line up with its obvious driver?
    ("helicopter", "d_heliport", -1), ("commercial", "bar_exposure", 1), ("vehicle", "truck_exposure", 1),
    ("street", "bar_exposure", 1), ("residential", "log_units", 1)]


def design(cells: pd.DataFrame) -> pd.DataFrame:
    X = cells.copy()
    X["log_units"] = np.log1p(X["units"])
    X["log_retail"] = np.log1p(X["retail_area"])
    X["log_commercial"] = np.log1p(X["commercial_area"])
    return X


def spatial_groups(cells: pd.DataFrame, res: int = 6) -> np.ndarray:
    return np.array([h3.cell_to_parent(c, res) for c in cells["h3"]])


def _score(y, p) -> dict:
    p = np.clip(p, 1e-6, None)
    return {"d2_poisson": float(d2_tweedie_score(y, p, power=1)), "spearman": float(spearmanr(y, p).statistic),
            "mae": float(mean_absolute_error(y, p))}


def oof_predict(X: pd.DataFrame, y: np.ndarray, cols: list[str], splitter, groups=None) -> np.ndarray:
    pred = np.zeros(len(y))
    for tr, va in splitter.split(X, y, groups):
        m = HistGradientBoostingRegressor(**PARAMS).fit(X.iloc[tr][cols], y[tr])
        pred[va] = m.predict(X.iloc[va][cols])
    return pred


def fit(cells: pd.DataFrame) -> dict:
    X = design(cells)
    y = X["complaints"].to_numpy(float)
    cols = list(FEATURES)
    groups = spatial_groups(X)
    blocked = GroupKFold(n_splits=5)
    oof_full = oof_predict(X, y, cols, blocked, groups)
    oof_base = oof_predict(X, y, ["log_units"], blocked, groups)
    oof_random = oof_predict(X, y, cols, KFold(5, shuffle=True, random_state=0))

    model = HistGradientBoostingRegressor(**PARAMS).fit(X[cols], y)
    import shap

    sv = shap.TreeExplainer(model).shap_values(X[cols])
    contrib = pd.DataFrame(sv, columns=cols, index=X.index)

    importance = contrib.abs().mean().sort_values(ascending=False)
    curves = {}
    for c in cols:
        q = pd.qcut(X[c].rank(method="first"), 12, labels=False)
        g = pd.DataFrame({"x": X[c], "s": contrib[c], "q": q}).groupby("q").agg(x=("x", "median"), s=("s", "mean"))
        curves[c] = {"x": g["x"].round(3).tolist(), "effect": np.exp(g["s"]).round(4).tolist()}

    checks = []
    for typ, feat, sign in CHECKS:
        if typ in X:
            rho = spearmanr(X[typ], X[feat]).statistic
            dec = pd.qcut(X[feat].rank(method="first"), 10, labels=False)
            checks.append({"type": typ, "feature": feat, "expected_sign": sign, "spearman": round(float(rho), 3),
                           "agrees": bool(np.sign(rho) == sign),
                           "decile_mean": X.groupby(dec)[typ].mean().round(3).tolist(),
                           "decile_x": X.groupby(dec)[feat].median().round(1).tolist()})

    out = X[["h3"]].copy()
    out["expected"] = model.predict(X[cols])
    out["oof_expected"] = oof_full
    out["base_expected"] = oof_base
    order = np.argsort(-contrib.to_numpy(), axis=1)
    out["drivers"] = [[[cols[j], round(float(np.exp(contrib.iat[i, j])), 3)] for j in order[i, :3] if contrib.iat[i, j] > 0]
                      for i in range(len(X))]
    out["quieters"] = [[[cols[j], round(float(np.exp(contrib.iat[i, j])), 3)] for j in order[i, ::-1][:2] if contrib.iat[i, j] < 0]
                       for i in range(len(X))]
    # Day (06-22) and night (22-06) fitted separately: which factors matter after dark?
    by_time = {}
    if "night" in X:
        for name, yt in {"day": (X["complaints"] - X["night"]).to_numpy(float), "night": X["night"].to_numpy(float)}.items():
            mt = HistGradientBoostingRegressor(**PARAMS).fit(X[cols], yt)
            st = pd.DataFrame(shap.TreeExplainer(mt).shap_values(X[cols]), columns=cols).abs().mean().sort_values(ascending=False)
            by_time[name] = {"spatial_cv": _score(yt, oof_predict(X, yt, cols, blocked, groups)),
                             "importance": {k: round(float(v), 4) for k, v in st.items()}}

    metrics = {
        "target": "noise complaints per hex cell over 104 weeks",
        "by_time": by_time,
        "cells": int(len(X)), "cv": "GroupKFold(5) on H3 resolution-6 parents",
        "spatial_cv": {"full": _score(y, oof_full), "units_only": _score(y, oof_base)},
        "random_cv_full": _score(y, oof_random),
        "skill_d2_over_units_only": float(_score(y, oof_full)["d2_poisson"] - _score(y, oof_base)["d2_poisson"]),
        "base_rate_log": float(np.mean(model.predict(X[cols]))),
        "importance": {k: round(float(v), 4) for k, v in importance.items()},
        "curves": curves, "checks": checks,
        "features": {k: {"label": v[0], "group": v[1], "unit": v[2]} for k, v in FEATURES.items()},
    }
    return {"metrics": metrics, "scored": out}


def main(data_dir: Path = DATA_DIR) -> dict:
    cells = pd.read_csv(data_dir / "cells.csv.gz")
    res = fit(cells)
    res["scored"].assign(drivers=res["scored"]["drivers"].map(json.dumps), quieters=res["scored"]["quieters"].map(json.dumps)) \
        .to_csv(data_dir / "cells_scored.csv.gz", index=False)
    (data_dir / "spatial_metrics.json").write_text(json.dumps(res["metrics"], indent=2))
    m = res["metrics"]
    print(json.dumps({k: m[k] for k in ("cells", "spatial_cv", "random_cv_full", "skill_d2_over_units_only")}, indent=2))
    print("top drivers:", list(m["importance"])[:8])
    print("checks:", [(c["type"], c["feature"], c["spearman"], c["agrees"]) for c in m["checks"]])
    return m


if __name__ == "__main__":
    main()
