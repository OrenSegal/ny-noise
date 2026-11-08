import h3
import numpy as np
import pandas as pd
import pytest
import shapely

pytest.importorskip("geopandas")
from sklearn.model_selection import GroupKFold  # noqa: E402

from nynoise import export, factors, spatial  # noqa: E402


def test_complaints_aggregate_to_the_right_hex_and_month():
    a, b = (40.7580, -73.9855), (40.6782, -73.9442)
    raw = pd.DataFrame({
        "zip": ["10036", "10036", "11216"], "lat": [a[0], a[0] + 1e-5, b[0]], "lon": [a[1], a[1], b[1]],
        "type": ["Noise - Residential", "Noise - Street/Sidewalk", "Noise - Residential"],
        "created": pd.to_datetime(["2025-01-03 23:00", "2025-02-10 12:00", "2025-02-11 01:00"])})
    cells, months = factors.complaint_cells(raw, pd.Timestamp("2025-01-01"), pd.Timestamp("2025-03-01"))
    ca = h3.latlng_to_cell(*a, factors.RES)
    row = cells.set_index("h3").loc[ca]
    assert row["complaints"] == 2 and row["residential"] == 1 and row["street"] == 1
    assert months == ["2025-01", "2025-02"] and row["monthly"] == [1, 1]
    assert row["night_share"] == 0.5


def test_repeat_caller_counts_once_per_day():
    raw = pd.DataFrame({"zip": ["10025"] * 4, "lat": [40.79] * 4, "lon": [-73.97] * 4,
                        "type": ["Noise - Helicopter"] * 3 + ["Noise - Residential"],
                        "created": pd.to_datetime(["2025-01-03 09:00", "2025-01-03 10:00", "2025-01-04 09:00", "2025-01-03 11:00"])})
    cells, _ = factors.complaint_cells(raw, pd.Timestamp("2025-01-01"), pd.Timestamp("2025-02-01"))
    row = cells.iloc[0]
    assert row["reports"] == 4 and row["complaints"] == 3 and row["helicopter"] == 2


def test_distance_and_length_on_known_geometry():
    line = np.array([shapely.LineString([(10, -50), (10, 50)])], dtype=object)
    pts = np.array([[0.0, 0.0], [30.0, 0.0]])
    assert np.allclose(factors.nearest_distance(pts, line), [10, 20])
    # a vertical line through a circle of radius 20 centred 10 ft away: chord = 2*sqrt(20^2-10^2)
    got = factors.length_within(np.array([[0.0, 0.0]]), line, r=20)[0]
    assert got == pytest.approx(2 * np.sqrt(300), rel=0.01)
    assert factors.count_within(pts, np.array([[1.0, 1.0], [100.0, 100.0]]), r=5).tolist() == [1, 0]


def synthetic_cells(n_side=22, seed=0):
    rng = np.random.default_rng(seed)
    center = h3.latlng_to_cell(40.73, -73.95, factors.RES)
    hexes = list(h3.grid_disk(center, n_side))[:3000]
    df = pd.DataFrame({"h3": hexes})
    df["units"] = rng.integers(0, 400, len(df))
    df["retail_area"] = rng.integers(0, 20000, len(df))
    df["commercial_area"] = df["retail_area"] * 2
    df["floors"] = rng.uniform(1, 20, len(df))
    for f in spatial.FEATURES:
        if f not in ("log_units", "log_retail", "log_commercial", "floors"):
            df[f] = rng.uniform(0, 5000, len(df)) if f.startswith(("d_", "len_")) else rng.poisson(5, len(df))
    rate = np.exp(0.6 * np.log1p(df["units"]) + 0.08 * df["n_bars"] - 2)
    df["complaints"] = rng.poisson(rate)
    for t in ("residential", "street", "commercial", "vehicle", "helicopter"):
        df[t] = rng.poisson(rate / 5)
    return df


def test_spatial_folds_never_share_a_block():
    cells = synthetic_cells()
    groups = spatial.spatial_groups(cells)
    for tr, va in GroupKFold(5).split(cells, groups=groups):
        assert not set(groups[tr]) & set(groups[va])


def test_model_finds_signal_beyond_exposure_and_exports_consistent_json(monkeypatch):
    monkeypatch.setitem(spatial.PARAMS, "max_iter", 80)  # keep CI fast; the real fit uses 400
    cells = synthetic_cells()
    res = spatial.fit(cells)
    m = res["metrics"]
    assert m["skill_d2_over_units_only"] > 0  # bars carry real signal in the synthetic world
    assert list(m["importance"])[:2] == ["log_units", "n_bars"] or "n_bars" in list(m["importance"])[:3]
    cells["monthly"] = [[0, 1]] * len(cells)
    cells["night_share"] = 0.1
    out = export.cells_json(cells, res["scored"], {"months": ["2025-01", "2025-02"], "window_start": "a", "window_end": "b", "weeks": 104})
    n = len(out["h3"])
    assert n == len(cells) and all(len(col) == n for col in out["x"])
    assert len(out["drivers"]) == n and all(0 <= k < len(out["features"]) for d in out["drivers"] for k, _ in d)
