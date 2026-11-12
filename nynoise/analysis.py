"""Pure helpers behind the dashboard: baselines per ZIP-week, running error, bands, coverage."""
from __future__ import annotations

import numpy as np
import pandas as pd

# "model" is whichever candidate the run selected; export labels it from metrics["best_model"]
MODELS = {"model": "Selected model", "last_week": "Last week",
          "mean_4_weeks": "4-week mean", "same_week_last_year": "Same week last year"}
MODEL_NAMES = {"random_forest": "Random forest", "hist_gradient_boosting": "Histogram gradient boosting"}
BANDS = ["Well below", "Below", "Near typical", "Above", "Well above"]
EDGES = [-np.inf, -0.30, -0.10, 0.10, 0.30, np.inf]


def band(vs_typical: pd.Series) -> pd.Series:
    """Classify forecast-vs-typical into the five atlas classes."""
    return pd.cut(vs_typical, EDGES, labels=BANDS)


def race_frame(panel: pd.DataFrame, backtest: pd.DataFrame) -> pd.DataFrame:
    """Long table [zip, target_week, actual, model, pred]: the selected model and the three naive baselines.

    Baselines use only weeks <= t for the forecast of week t+1, matching nynoise.model.baselines.
    """
    p = panel.sort_values(["zip", "week"]).copy()
    g = p.groupby("zip")["n"]
    p["target_week"] = p["week"] + pd.Timedelta(weeks=1)
    p["last_week"] = p["n"]
    p["mean_4_weeks"] = g.transform(lambda s: s.rolling(4).mean())
    p["same_week_last_year"] = g.shift(51)
    wide = backtest.merge(p[["zip", "target_week", "last_week", "mean_4_weeks", "same_week_last_year"]],
                          on=["zip", "target_week"], how="left").rename(columns={"pred": "model"})
    long = wide.melt(id_vars=["zip", "target_week", "actual"], value_vars=list(MODELS),
                     var_name="model", value_name="pred")
    return long.dropna(subset=["pred"])


def running_error(race: pd.DataFrame) -> pd.DataFrame:
    """Per model and week: that week's WAPE and the cumulative WAPE since the holdout began."""
    w = (race.assign(err=(race["actual"] - race["pred"]).abs())
         .groupby(["model", "target_week"], as_index=False)[["err", "actual"]].sum()
         .sort_values(["model", "target_week"]))
    w["week_wape"] = w["err"] / w["actual"]
    w["cum_wape"] = w.groupby("model")["err"].cumsum() / w.groupby("model")["actual"].cumsum()
    return w


def quarter_error(race: pd.DataFrame, n: int = 4) -> pd.DataFrame:
    """WAPE per model in `n` equal blocks of holdout weeks (the rolling-origin view, no refit)."""
    weeks = np.sort(race["target_week"].unique())
    block = {w: i for i, chunk in enumerate(np.array_split(weeks, n)) for w in chunk}
    r = race.assign(block=race["target_week"].map(block), err=(race["actual"] - race["pred"]).abs())
    q = r.groupby(["block", "model"])[["err", "actual"]].sum()
    q["wape"] = q["err"] / q["actual"]
    span = r.groupby("block")["target_week"].agg(["min", "max"])
    q = q.reset_index().merge(span, left_on="block", right_index=True)
    q["quarter"] = q["min"].dt.strftime("%b %Y") + " to " + q["max"].dt.strftime("%b %Y")
    return q


def interval_hits(backtest: pd.DataFrame) -> pd.DataFrame:
    return backtest.assign(hit=(backtest["actual"] >= backtest["lo"]) & (backtest["actual"] <= backtest["hi"]))


def surge_weeks(panel: pd.DataFrame, threshold: float = 0.25) -> pd.DatetimeIndex:
    """Weeks whose citywide total is more than `threshold` above the mean of the previous 4 weeks."""
    city = panel.groupby("week")["n"].sum().sort_index()
    ratio = city / city.rolling(4).mean().shift(1)
    return ratio.index[ratio > 1 + threshold]


def zip_summary(race: pd.DataFrame, hits: pd.DataFrame) -> pd.DataFrame:
    """Per ZIP over the holdout: model MAE and WAPE, last-week WAPE, interval coverage."""
    def wape(m):
        r = race[race["model"] == m].assign(err=lambda d: (d["actual"] - d["pred"]).abs())
        g = r.groupby("zip")[["err", "actual"]].sum()
        return g["err"] / g["actual"]
    mae = (race[race["model"] == "model"].assign(err=lambda d: (d["actual"] - d["pred"]).abs())
           .groupby("zip")["err"].mean())
    return pd.DataFrame({"mae": mae, "wape": wape("model"), "wape_last_week": wape("last_week"),
                         "coverage": hits.groupby("zip")["hit"].mean()})
