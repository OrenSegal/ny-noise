"""Ingest NYC 311 noise complaints and build the analytical tables.

Layers (all under data/):
  raw/YYYY-MM.csv.gz   one file per month of complaint rows, cached, gitignored
  weekly_panel.csv.gz  dense ZIP x week counts (committed; what the model reads)
  hourly.csv, zips.csv small dashboard tables (committed)
  manifest.json        what was built, when, from how many raw rows

Run `python -m nynoise.data`. Re-runs only download months not yet cached, plus
the most recent ~5 weeks (311 data is revised and backfilled shortly after the fact).
Needs `requests` (requirements-dev.txt); the dashboard does not.
Set SOCRATA_APP_TOKEN to avoid anonymous throttling.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

URL = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
START = "2022-01-01"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PAGE = 25_000
REFRESH_DAYS = 35
COLS = ["zip", "created", "type", "lat", "lon"]


def _request(session, params: dict, tries: int = 7) -> list[dict]:
    """GET with exponential backoff on throttling/server errors."""
    headers = {"X-App-Token": os.environ["SOCRATA_APP_TOKEN"]} if os.getenv("SOCRATA_APP_TOKEN") else {}
    import requests

    for i in range(tries):
        try:
            r = session.get(URL, params=params, headers=headers, timeout=120)
            if r.status_code not in (429, 500, 502, 503, 504):
                r.raise_for_status()
                return r.json()
        except (requests.Timeout, requests.ConnectionError):
            pass
        if i == tries - 1:
            raise RuntimeError(f"Socrata still failing after {tries} tries; re-run to resume from cache")
        time.sleep(5 * 2 ** i)


def fetch_month(session, start: str, end: str) -> pd.DataFrame:
    """Raw noise-complaint rows with created_date in [start, end)."""
    rows, offset = [], 0
    while True:
        page = _request(session, {
            "$select": "incident_zip,created_date,complaint_type,latitude,longitude",
            "$where": f"complaint_type like 'Noise%' AND created_date >= '{start}T00:00:00' "
                      f"AND created_date < '{end}T00:00:00'",
            "$order": "unique_key",  # stable paging; created_date is not unique
            "$limit": PAGE, "$offset": offset,
        })
        rows += page
        if len(page) < PAGE:
            break
        offset += PAGE
    df = pd.DataFrame(rows, columns=["incident_zip", "created_date", "complaint_type", "latitude", "longitude"])
    df.columns = COLS
    return df


def load_raw(raw_dir: Path, session=None, start: str = START, today: pd.Timestamp | None = None) -> pd.DataFrame:
    """Read every monthly raw file, downloading missing or still-moving months first."""
    today = today or pd.Timestamp.today().normalize()
    raw_dir.mkdir(parents=True, exist_ok=True)
    months = pd.date_range(start, today + pd.offsets.MonthBegin(1), freq="MS")
    for a, b in zip(months[:-1], months[1:]):
        f = raw_dir / f"{a:%Y-%m}.csv.gz"
        if f.exists() and b <= today - pd.Timedelta(days=REFRESH_DAYS):
            continue
        if session is None:
            import requests
            session = requests.Session()
        print(f"fetching {a:%Y-%m}", flush=True)
        fetch_month(session, a.strftime("%Y-%m-%d"), b.strftime("%Y-%m-%d")).to_csv(f, index=False)
    frames = [pd.read_csv(f, dtype={"zip": str}) for f in sorted(raw_dir.glob("*.csv.gz"))]
    raw = pd.concat(frames, ignore_index=True)
    raw["created"] = pd.to_datetime(raw["created"])
    return raw


def weekly_panel(raw: pd.DataFrame, min_total: int = 500) -> pd.DataFrame:
    """Raw rows -> dense Monday-start weekly panel [zip, week, n].

    - keeps 5-digit ZIPs with at least `min_total` complaints (drops typos/non-NYC)
    - fills missing zip-weeks with 0 (no complaints is a real observation)
    - drops the trailing week unless the data reaches its Sunday
    """
    d = raw.dropna(subset=["zip"])
    d = d[d["zip"].str.fullmatch(r"\d{5}")]
    d = d[d.groupby("zip")["zip"].transform("size") >= min_total]
    week = d["created"].dt.to_period("W-SUN").dt.start_time.rename("week")
    last_week = week.max() if d["created"].max().day_of_week == 6 else week.max() - pd.Timedelta(weeks=1)
    wk = d.groupby(["zip", week]).size().rename("n").reset_index()
    wk = wk[wk["week"] <= last_week]
    full = pd.MultiIndex.from_product(
        [sorted(wk["zip"].unique()), pd.date_range(wk["week"].min(), last_week, freq="7D")],
        names=["zip", "week"],
    )
    out = wk.set_index(["zip", "week"]).reindex(full, fill_value=0).reset_index()
    return out.sort_values(["zip", "week"]).reset_index(drop=True)


def hourly_profile(raw: pd.DataFrame, last_week: pd.Timestamp) -> pd.DataFrame:
    """Complaints by type x weekday (Mon=0) x hour over the 52 weeks to `last_week`."""
    cut = last_week - pd.Timedelta(weeks=51)
    d = raw[(raw["created"] >= cut) & (raw["created"] < last_week + pd.Timedelta(days=7))]
    g = d.groupby([d["type"], d["created"].dt.day_of_week.rename("dow"), d["created"].dt.hour.rename("hour")])
    return g.size().rename("n").reset_index()


def zip_centroids(raw: pd.DataFrame, zips) -> pd.DataFrame:
    """Mean complaint location per ZIP, used as the map position."""
    d = raw[raw["zip"].isin(zips)].dropna(subset=["lat", "lon"])
    return d.groupby("zip", as_index=False)[["lat", "lon"]].mean()


def validate(panel: pd.DataFrame) -> None:
    """Fail loudly if the panel is not the dense, clean table the model assumes."""
    assert not panel.duplicated(["zip", "week"]).any(), "duplicate zip-week rows"
    assert (panel["n"] >= 0).all(), "negative counts"
    assert (panel["week"].dt.day_of_week == 0).all(), "weeks must start on Monday"
    sizes = panel.groupby("zip").size()
    assert sizes.nunique() == 1, "panel is not dense: ZIPs have different numbers of weeks"
    assert panel["week"].nunique() == sizes.iloc[0], "week gaps"
    assert panel["n"].sum() > 0, "empty panel"


def build(out_dir: Path = DATA_DIR) -> pd.DataFrame:
    raw = load_raw(out_dir / "raw")
    panel = weekly_panel(raw)
    validate(panel)
    last = panel["week"].max()
    panel.to_csv(out_dir / "weekly_panel.csv.gz", index=False)
    hourly_profile(raw, last).to_csv(out_dir / "hourly.csv", index=False)
    zip_centroids(raw, panel["zip"].unique()).to_csv(out_dir / "zips.csv", index=False)
    manifest = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": URL,
        "raw_rows": int(len(raw)),
        "zips": int(panel["zip"].nunique()),
        "first_week": f"{panel['week'].min():%Y-%m-%d}",
        "last_week": f"{last:%Y-%m-%d}",
        "panel_rows": int(len(panel)),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(manifest)
    return panel


if __name__ == "__main__":
    build()
