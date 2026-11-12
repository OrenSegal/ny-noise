"""Forecast next week's noise complaints per ZIP.

Run `python -m nynoise.model` after `python -m nynoise.data`. It writes, under data/:
  metrics.json      holdout metrics vs. naive baselines, CV scores, permutation importance
  backtest.csv.gz   holdout predictions with 80% intervals (what the dashboard plots)
  forecast.csv      next-week forecast per ZIP

Design choices that matter:
  * Row at week t uses only weeks <= t; the target is the count in week t+1.
  * Time-based holdout (last 52 target weeks) and week-blocked CV; never a random split.
  * Target is scaled by each ZIP's 52-week mean so one model serves busy and quiet ZIPs.
  * The published model changes only when a challenger's CV gain exceeds its standard error (choose_model).
  * A rolling-origin check refits before each quarter of the holdout to show stability.
  * Intervals are quantile GBMs widened by split-conformal calibration (CQR), then
    checked for coverage on the untouched holdout.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GridSearchCV, TimeSeriesSplit

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HOLDOUT_WEEKS = 52
CALIB_WEEKS = 26
COVERAGE = 0.8
SES_TENTHS = range(2, 9)  # smoothing weights 0.2 .. 0.8 tried for the exponential-smoothing baseline
FEATURES = ["lag0", "lag1", "lag3", "mean4", "last_year", "log_scale", "woy_sin", "woy_cos"]


def make_features(panel: pd.DataFrame) -> pd.DataFrame:
    """One row per (zip, week t). `y` is week t+1's count (NaN for the latest week)."""
    p = panel.sort_values(["zip", "week"]).copy()
    g = p.groupby("zip")["n"]
    p["target_week"] = p["week"] + pd.Timedelta(weeks=1)
    p["y"] = g.shift(-1)
    p["scale"] = g.transform(lambda s: s.rolling(52).mean()) + 1  # mean of weeks t-51..t
    p["lag0"] = p["n"] / p["scale"]
    p["lag1"] = g.shift(1) / p["scale"]
    p["lag3"] = g.shift(3) / p["scale"]
    p["mean4"] = g.transform(lambda s: s.rolling(4).mean()) / p["scale"]
    p["last_year"] = g.shift(51) / p["scale"]  # same ISO week one year before the target week
    p["log_scale"] = np.log(p["scale"])
    for t in SES_TENTHS:  # baseline only, in raw counts; never a model feature
        p[f"ses{t}"] = g.transform(lambda s, t=t: s.ewm(alpha=t / 10, adjust=False).mean())
    woy = p["target_week"].dt.isocalendar().week.astype(float)
    p["woy_sin"] = np.sin(2 * np.pi * woy / 52)
    p["woy_cos"] = np.cos(2 * np.pi * woy / 52)
    return p.dropna(subset=FEATURES).reset_index(drop=True)


def baselines(df: pd.DataFrame, ses_tenths: int = 5) -> dict[str, np.ndarray]:
    s = df["scale"].to_numpy()
    last, mean4 = df["lag0"].to_numpy() * s, df["mean4"].to_numpy() * s
    return {
        "last_week": last,
        "mean_4_weeks": mean4,
        "same_week_last_year": df["last_year"].to_numpy() * s,
        "exp_smoothing": df[f"ses{ses_tenths}"].to_numpy(),
        "blend_last_week_mean_4": (last + mean4) / 2,
    }


def skill_interval(weeks: np.ndarray, y: np.ndarray, pred: np.ndarray, base: np.ndarray, n: int = 2000, seed: int = 0) -> dict:
    """WAPE skill of `pred` over `base` with a 95% interval from resampling whole weeks (ZIPs in a week move together)."""
    w = pd.DataFrame({"w": weeks, "m": np.abs(y - pred), "b": np.abs(y - base)}).groupby("w").sum()
    idx = np.random.default_rng(seed).integers(0, len(w), (n, len(w)))
    boots = 1 - w["m"].to_numpy()[idx].sum(axis=1) / w["b"].to_numpy()[idx].sum(axis=1)
    return {"skill": float(1 - w["m"].sum() / w["b"].sum()), "ci": [float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975))],
            "weeks_won": int((w["m"] < w["b"]).sum()), "weeks": int(len(w))}


def score(y: np.ndarray, pred: np.ndarray, mase_scale: float | None = None) -> dict[str, float]:
    denom = np.abs(y) + np.abs(pred)
    out = {
        "mae": float(mean_absolute_error(y, pred)),
        "rmse": float(np.sqrt(mean_squared_error(y, pred))),
        "r2": float(r2_score(y, pred)),
        "wape": float(np.abs(y - pred).sum() / y.sum()),  # weighted % error, robust to ZIP size
        "smape": float(np.mean(np.where(denom == 0, 0, 2 * np.abs(y - pred) / np.where(denom == 0, 1, denom)))),
    }
    if mase_scale:  # <1 means better than repeating last week did in-sample on the training years
        out["mase"] = float(mean_absolute_error(y, pred) / mase_scale)
    return out


def week_blocked_splits(weeks: pd.Series, n_splits: int = 4):
    """Expanding-window CV split on whole weeks so no week straddles train/validation."""
    u = np.sort(weeks.unique())
    for tr, va in TimeSeriesSplit(n_splits).split(u):
        yield np.flatnonzero(weeks.isin(u[tr])), np.flatnonzero(weeks.isin(u[va]))


def _rel(df: pd.DataFrame) -> np.ndarray:
    return (df["y"] / df["scale"]).to_numpy()


def _quantile_model(q: float) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=200,
                                         learning_rate=0.05, random_state=0)


def choose_model(fold_mae: dict[str, np.ndarray], incumbent: str | None = None) -> dict:
    """Pick the model to publish. The lowest mean CV error is the challenger; an incumbent (last run's model) is
    replaced only when the challenger's mean gain over it, fold by fold, exceeds the standard error of that gain."""
    challenger = min(fold_mae, key=lambda k: fold_mae[k].mean())
    out = {"incumbent": incumbent, "challenger": challenger, "selected": challenger,
           "fold_mae": {k: [float(x) for x in v] for k, v in fold_mae.items()}}
    if incumbent in fold_mae and incumbent != challenger:
        d = fold_mae[incumbent] - fold_mae[challenger]
        out["cv_gain"], out["cv_gain_se"] = float(d.mean()), float(d.std(ddof=1) / np.sqrt(len(d)))
        if out["cv_gain"] <= out["cv_gain_se"]:
            out["selected"] = incumbent
    return out


def train(panel: pd.DataFrame, incumbent: str | None = None) -> dict:
    df = make_features(panel)
    labeled = df.dropna(subset=["y"]).sort_values("week").reset_index(drop=True)
    weeks = np.sort(labeled["target_week"].unique())
    if len(weeks) < HOLDOUT_WEEKS + CALIB_WEEKS + 30:
        raise ValueError("not enough history to train: build a longer panel")
    test_start = weeks[-HOLDOUT_WEEKS]
    train_df = labeled[labeled["target_week"] < test_start].reset_index(drop=True)
    test_df = labeled[labeled["target_week"] >= test_start].reset_index(drop=True)

    candidates = {
        "random_forest": (RandomForestRegressor(random_state=0, n_jobs=-1),
                          {"n_estimators": [200], "max_depth": [8, 14], "min_samples_leaf": [5, 20]}),
        "hist_gradient_boosting": (HistGradientBoostingRegressor(random_state=0),
                                   {"max_iter": [150, 300], "learning_rate": [0.03, 0.1],
                                    "max_depth": [3, 6]}),
    }
    cv = list(week_blocked_splits(train_df["week"]))
    fitted, cv_scores, fold_mae = {}, {}, {}
    for name, (est, grid) in candidates.items():
        gs = GridSearchCV(est, grid, cv=cv, scoring="neg_mean_absolute_error", n_jobs=-1)
        gs.fit(train_df[FEATURES], _rel(train_df))
        fitted[name], cv_scores[name] = gs.best_estimator_, {
            "cv_mae_relative": float(-gs.best_score_), "params": gs.best_params_}
        fold_mae[name] = -np.array([gs.cv_results_[f"split{i}_test_score"][gs.best_index_] for i in range(len(cv))])
    selection = choose_model(fold_mae, incumbent)
    best = selection["selected"]

    y_true = test_df["y"].to_numpy()
    s_test = test_df["scale"].to_numpy()
    preds = {k: np.clip(m.predict(test_df[FEATURES]), 0, None) * s_test for k, m in fitted.items()}
    # smoothing weight chosen on the training weeks only
    ses = min(SES_TENTHS, key=lambda t: np.abs(train_df["y"] - train_df[f"ses{t}"]).sum())
    mase_scale = float(np.abs(train_df["y"].to_numpy() - baselines(train_df)["last_week"]).mean())  # one-step naive
    holdout = {k: score(y_true, v, mase_scale) for k, v in {**baselines(test_df, ses), **preds}.items()}
    best_base = min(baselines(test_df, ses), key=lambda k: holdout[k]["wape"])
    skill = 1 - holdout[best]["wape"] / holdout[best_base]["wape"]

    # Intervals: quantile models fit before the calibration weeks, conformal-widened on them.
    calib_start = np.sort(train_df["target_week"].unique())[-CALIB_WEEKS]
    fit_df = train_df[train_df["target_week"] < calib_start]
    cal_df = train_df[train_df["target_week"] >= calib_start]
    lo_m = _quantile_model((1 - COVERAGE) / 2).fit(fit_df[FEATURES], _rel(fit_df))
    hi_m = _quantile_model(1 - (1 - COVERAGE) / 2).fit(fit_df[FEATURES], _rel(fit_df))
    cal_lo, cal_hi = lo_m.predict(cal_df[FEATURES]), hi_m.predict(cal_df[FEATURES])
    r = _rel(cal_df)
    nonconf = np.maximum(cal_lo - r, r - cal_hi)
    q = float(np.quantile(nonconf, min(1, COVERAGE * (1 + 1 / len(nonconf)))))

    def interval(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        s = frame["scale"].to_numpy()
        lo = np.clip(lo_m.predict(frame[FEATURES]) - q, 0, None) * s
        hi = (hi_m.predict(frame[FEATURES]) + q) * s
        return lo, hi

    lo, hi = interval(test_df)
    point = preds[best]
    lo, hi = np.minimum(lo, point), np.maximum(hi, point)
    coverage = float(((y_true >= lo) & (y_true <= hi)).mean())

    imp = permutation_importance(fitted[best], test_df[FEATURES], _rel(test_df),
                                 scoring="neg_mean_absolute_error", n_repeats=5, random_state=0)
    importance = dict(sorted(zip(FEATURES, imp.importances_mean.round(5).tolist()),
                             key=lambda kv: -kv[1]))

    per_zip = (pd.DataFrame({"zip": test_df["zip"], "hit": (y_true >= lo) & (y_true <= hi)})
               .groupby("zip")["hit"].mean())
    by_zip = pd.DataFrame({"zip": test_df["zip"], "hit": (y_true >= lo) & (y_true <= hi), "y": y_true}).groupby("zip").mean()
    tercile = pd.qcut(by_zip["y"], 3, labels=["low", "mid", "high"])
    volume_coverage = [{"tercile": t, "zips": int(len(g)), "mean_weekly": float(g["y"].mean()), "coverage": float(g["hit"].mean())}
                       for t, g in by_zip.groupby(tercile, observed=True)]
    zip_coverage = {"min": float(per_zip.min()), "p10": float(per_zip.quantile(0.1)),
                    "median": float(per_zip.median()), "share_below_60pct": float((per_zip < 0.6).mean())}

    # Rolling origin: refit before each quarter of the holdout, score that quarter vs. baselines.
    rolling = []
    for q_weeks in np.array_split(np.sort(test_df["target_week"].unique()), 4):
        q_df = test_df[test_df["target_week"].isin(q_weeks)]
        fit = labeled[labeled["target_week"] < q_weeks[0]]
        est = clone(fitted[best]).fit(fit[FEATURES], _rel(fit))
        qp = np.clip(est.predict(q_df[FEATURES]), 0, None) * q_df["scale"].to_numpy()
        qy = q_df["y"].to_numpy()
        row = {"start": f"{pd.Timestamp(q_weeks[0]):%Y-%m-%d}", "end": f"{pd.Timestamp(q_weeks[-1]):%Y-%m-%d}",
               "model": score(qy, qp, mase_scale)}
        row.update({k: score(qy, v, mase_scale) for k, v in baselines(q_df, ses).items()})
        row["best_baseline"] = min(baselines(q_df, ses), key=lambda k: row[k]["wape"])
        rolling.append(row)

    backtest = pd.DataFrame({"zip": test_df["zip"], "target_week": test_df["target_week"],
                             "actual": y_true, "pred": point, "lo": lo, "hi": hi})

    # Forecast: refit the winner on every labeled row, predict the unlabeled latest week.
    final = fitted[best].fit(labeled[FEATURES], _rel(labeled))
    latest = df[df["week"] == df["week"].max()]
    fpoint = np.clip(final.predict(latest[FEATURES]), 0, None) * latest["scale"].to_numpy()
    flo, fhi = interval(latest)
    forecast = pd.DataFrame({"zip": latest["zip"].to_numpy(), "target_week": latest["target_week"].to_numpy(),
                             "pred": fpoint, "lo": np.minimum(flo, fpoint), "hi": np.maximum(fhi, fpoint),
                             "last_week": latest["n"].to_numpy(), "typical": latest["scale"].to_numpy() - 1})

    metrics = {
        "best_model": best,
        "best_baseline": best_base,
        "wape_skill_vs_best_baseline": float(skill),
        "exp_smoothing_alpha": ses / 10,
        "skill": {k: {"baseline": k, **skill_interval(test_df["target_week"].to_numpy(), y_true, preds[best], baselines(test_df, ses)[k])}
                  for k in dict.fromkeys([best_base, "last_week"])},
        "holdout": holdout,
        "cv": cv_scores,
        "selection": selection,
        "interval": {"nominal": COVERAGE, "empirical_coverage": coverage,
                     "conformal_widening_relative": q},
        "interval_by_zip": zip_coverage,
        "interval_by_volume": volume_coverage,
        "rolling_origin": rolling,
        "permutation_importance": importance,
        "holdout_weeks": [f"{pd.Timestamp(test_start):%Y-%m-%d}", f"{test_df['target_week'].max():%Y-%m-%d}"],
        "train_rows": int(len(train_df)), "holdout_rows": int(len(test_df)),
    }
    return {"metrics": metrics, "backtest": backtest, "forecast": forecast}


def main(data_dir: Path = DATA_DIR) -> dict:
    previous = data_dir / "metrics.json"  # last run's published model is the incumbent
    incumbent = json.loads(previous.read_text()).get("best_model") if previous.exists() else None
    out = train(pd.read_csv(data_dir / "weekly_panel.csv.gz", dtype={"zip": str}, parse_dates=["week"]), incumbent)
    out["backtest"].to_csv(data_dir / "backtest.csv.gz", index=False)
    out["forecast"].to_csv(data_dir / "forecast.csv", index=False)
    (data_dir / "metrics.json").write_text(json.dumps(out["metrics"], indent=2))
    print(json.dumps(out["metrics"], indent=2))
    return out["metrics"]


if __name__ == "__main__":
    main()
