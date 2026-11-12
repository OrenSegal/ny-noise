"""Rewrite the results blocks of Readme.md from the committed metrics.

Run `python -m nynoise.readme` after the model and spatial steps (the weekly refresh job does).
Only the text between `<!-- results:NAME -->` and `<!-- /results:NAME -->` is replaced, so the
numbers in the Readme cannot drift from data/metrics.json and data/spatial_metrics.json.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from nynoise.analysis import MODEL_NAMES
from nynoise.data import DATA_DIR
from nynoise.model import HOLDOUT_WEEKS

README = DATA_DIR.parent / "Readme.md"
LABELS = {**MODEL_NAMES, "last_week": "Last week (persistence)", "mean_4_weeks": "Mean of last 4 weeks",
          "same_week_last_year": "Same week last year"}


def forecast_block(m: dict) -> str:
    h, best, base = m["holdout"], m["best_model"], m["best_baseline"]
    rows = []
    for k, v in sorted(h.items(), key=lambda kv: kv[1]["wape"]):
        cells = [f"{v['mae']:.2f}", f"{v['wape']:.1%}", f"{v['smape']:.1%}", f"{v['mase']:.2f}", f"{v['r2']:.2f}"]
        name = LABELS.get(k, k) + (" (selected)" if k == best else "")
        rows.append("| " + " | ".join(f"**{c}**" if k == best else c for c in [name] + cells) + " |")
    quarters = m["rolling_origin"]
    ahead = sum(q["model"]["wape"] < q["last_week"]["wape"] for q in quarters)
    rmse = "behind" if h[best]["rmse"] > h["last_week"]["rmse"] else "ahead"
    return "\n".join([
        f"Scored on the most recent {HOLDOUT_WEEKS} weeks ({m['holdout_weeks'][0]} to {m['holdout_weeks'][1]}, "
        f"{m['holdout_rows']:,} ZIP-weeks), which that run held out of training and model selection. The refresh job reruns "
        "every week, so the holdout slides forward a week at a time and consecutive scorecards share all but one week. "
        "This block is rewritten from `data/metrics.json` by `python -m nynoise.readme`.",
        "", "| Forecast | MAE | WAPE | sMAPE | MASE | R² |", "|---|---|---|---|---|---|", *rows, "",
        f"{m['wape_skill_vs_best_baseline']:.1%} lower weighted error than {LABELS.get(base, base).lower()}, the best naive baseline; "
        f"ahead of last week in {ahead} of {len(quarters)} rolling-origin quarters; {rmse} on RMSE "
        f"({h[best]['rmse']:.0f} against {h['last_week']['rmse']:.0f}). 80% intervals covered "
        f"{m['interval']['empirical_coverage']:.1%} of the holdout; median ZIP {m['interval_by_zip']['median']:.0%}.",
    ])


def spatial_block(s: dict, meta: dict, cells: pd.DataFrame) -> str:
    def row(name, sc, bold=False):
        c = [name, f"{sc['d2_poisson']:.3f}", f"{sc['spearman']:.2f}", f"{sc['mae']:.0f}"]
        return "| " + " | ".join(f"**{x}**" if bold else x for x in c) + " |"

    checks = "; ".join(f"{c['type']} complaints against {s['features'][c['feature']]['label'].lower()} {c['spearman']:+.2f}"
                       for c in s["checks"])
    return "\n".join([
        f"{s['cells']:,} hex cells (H3 resolution {meta['h3_resolution']}), {cells['complaints'].sum() / 1e3:.0f}k damped complaints "
        f"(from {cells['complaint_days'].sum() / 1e6:.2f}M complaint-days and {cells['reports'].sum() / 1e6:.1f}M raw reports) "
        f"from {meta['window_start']} to {meta['window_end']}. Scored with spatial cross-validation: each fold holds out whole "
        "~36 km² areas, so a cell is never judged by a model that saw its neighbours.",
        "", "| Model (spatial CV) | Poisson deviance explained | Rank correlation | MAE per cell |", "|---|---|---|---|",
        row(f"Full: {len(s['features'])} features", s["spatial_cv"]["full"], True),
        row("Residential units only (exposure)", s["spatial_cv"]["units_only"]),
        row("Full, random folds (leaky)", s["random_cv_full"]),
        row("Day only (06 to 22)", s["by_time"]["day"]["spatial_cv"]),
        row("Night only (22 to 06)", s["by_time"]["night"]["spatial_cv"]), "",
        f"Urban and census factors add {s['skill_d2_over_units_only']:.3f} of deviance over exposure alone. "
        f"Spearman correlations for the per-type checks: {checks}.",
    ])


def render(text: str, blocks: dict[str, str]) -> str:
    for name, body in blocks.items():
        pat = re.compile(rf"(<!-- results:{name} -->\n).*?(\n<!-- /results:{name} -->)", re.S)
        if not pat.search(text):
            raise ValueError(f"Readme has no results:{name} markers")
        text = pat.sub(lambda mo: mo.group(1) + body + mo.group(2), text)
    return text


def blocks(data_dir: Path = DATA_DIR) -> dict[str, str]:
    load = lambda f: json.loads((data_dir / f).read_text())
    return {"forecast": forecast_block(load("metrics.json")),
            "spatial": spatial_block(load("spatial_metrics.json"), load("cells_meta.json"), pd.read_csv(data_dir / "cells.csv.gz"))}


if __name__ == "__main__":
    README.write_text(render(README.read_text(), blocks()))
