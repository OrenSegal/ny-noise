import numpy as np
import pandas as pd
import pytest

from nynoise import data, model


def raw_rows():
    """Two ZIPs, three Monday-Sunday weeks; 12345 has a quiet middle week."""
    days = pd.date_range("2024-01-01", "2024-01-21 12:00", freq="12h")  # Mon..Sun x3
    rows = [("12345", d, "Noise - Residential", 40.7, -74.0) for d in days if d.week != 2 or d.hour == 0]
    rows += [("10001", d, "Noise - Street/Sidewalk", 40.8, -73.9) for d in days]
    rows += [("ABCDE", days[0], "Noise", 0, 0), (None, days[0], "Noise", 0, 0)]
    return pd.DataFrame(rows, columns=data.COLS)


def test_weekly_panel_is_dense_clean_and_complete_weeks_only():
    raw = raw_rows()
    # data ends mid-Sunday-noon on 2024-01-21 -> that Sunday is covered, so 3 full weeks
    p = data.weekly_panel(raw, min_total=1)
    data.validate(p)
    assert set(p["zip"]) == {"12345", "10001"}  # junk ZIPs dropped
    assert p.groupby("zip").size().tolist() == [3, 3]


def test_trailing_partial_week_is_dropped():
    raw = raw_rows()
    raw = raw[raw["created"] < "2024-01-18"]  # ends Wednesday of week 3
    p = data.weekly_panel(raw, min_total=1)
    assert p["week"].max() == pd.Timestamp("2024-01-08")


def test_zero_weeks_are_filled():
    raw = raw_rows()
    raw = raw[~((raw["zip"] == "12345") & (raw["created"].between("2024-01-08", "2024-01-14 23:59")))]
    p = data.weekly_panel(raw, min_total=1)
    assert p[(p["zip"] == "12345") & (p["week"] == "2024-01-08")]["n"].iloc[0] == 0


def synthetic_panel(weeks=170, zips=12, seed=0):
    rng = np.random.default_rng(seed)
    w = pd.date_range("2021-01-04", periods=weeks, freq="7D")
    rows = []
    for z in range(zips):
        base = 20 + 40 * z
        n = rng.poisson(base * (1 + 0.4 * np.sin(2 * np.pi * np.arange(weeks) / 52)))
        rows += [(f"1{z:04d}", wk, int(c)) for wk, c in zip(w, n)]
    return pd.DataFrame(rows, columns=["zip", "week", "n"])


def test_features_never_see_the_future():
    panel = synthetic_panel()
    f1 = model.make_features(panel).set_index(["zip", "week"])
    cut = panel["week"].iloc[100]
    tampered = panel.copy()
    tampered.loc[tampered["week"] > cut, "n"] += 10_000  # change everything after week t
    f2 = model.make_features(tampered).set_index(["zip", "week"])
    idx = f1.index[f1.index.get_level_values("week") <= cut]
    pd.testing.assert_frame_equal(f1.loc[idx, model.FEATURES], f2.loc[idx, model.FEATURES])


def test_target_is_next_week_count():
    panel = synthetic_panel()
    f = model.make_features(panel).set_index(["zip", "week"])
    row = f.iloc[10]
    z, w = f.index[10]
    nxt = panel[(panel["zip"] == z) & (panel["week"] == w + pd.Timedelta(weeks=1))]["n"].iloc[0]
    assert row["y"] == nxt


def test_train_beats_naive_baselines_on_seasonal_data_and_intervals_cover():
    out = model.train(synthetic_panel())
    m = out["metrics"]
    assert m["wape_skill_vs_best_baseline"] > 0
    assert 0.6 <= m["interval"]["empirical_coverage"] <= 1.0
    assert out["backtest"]["target_week"].nunique() == model.HOLDOUT_WEEKS
    assert (out["forecast"]["lo"] <= out["forecast"]["pred"]).all()
    assert (out["forecast"]["pred"] <= out["forecast"]["hi"]).all()


def test_too_little_history_fails_loudly():
    with pytest.raises(ValueError):
        model.train(synthetic_panel(weeks=60, zips=3))


def test_fetch_month_pages_until_short_page(monkeypatch):
    calls = []

    class R:
        status_code = 200
        def __init__(self, n): self.n = n
        def raise_for_status(self): pass
        def json(self): return [{"incident_zip": "10001", "created_date": "2024-01-01T00:00:00",
                                 "complaint_type": "Noise", "latitude": "40.7", "longitude": "-74"}] * self.n

    class S:
        def get(self, url, params, **kw):
            calls.append(params["$offset"])
            return R(data.PAGE if len(calls) == 1 else 5)

    df = data.fetch_month(S(), "2024-01-01", "2024-02-01")
    assert calls == [0, data.PAGE] and len(df) == data.PAGE + 5


def test_dashboard_baselines_match_model_baselines_and_running_error_ends_at_wape():
    from nynoise import analysis

    panel = synthetic_panel()
    out = model.train(panel)
    race = analysis.race_frame(panel, out["backtest"])
    # each baseline in the dashboard equals the one the model was scored against
    feats = model.make_features(panel)
    base = model.baselines(feats)
    for key in ("last_week", "mean_4_weeks", "same_week_last_year"):
        ref = feats.assign(p=base[key])[["zip", "target_week", "p"]]
        got = race[race["model"] == key].merge(ref, on=["zip", "target_week"])
        assert np.allclose(got["pred"], got["p"])
    # the last point of the cumulative curve is the headline WAPE
    run = analysis.running_error(race)
    final = run[run["model"] == "model"]["cum_wape"].iloc[-1]
    assert final == pytest.approx(out["metrics"]["holdout"][out["metrics"]["best_model"]]["wape"])


@pytest.mark.parametrize("best", ["random_forest", "hist_gradient_boosting"])
def test_scorecard_labels_the_selected_model(best):
    from nynoise import analysis, export

    weeks = pd.date_range("2024-01-01", periods=3, freq="7D")
    bt = pd.DataFrame({"zip": "10001", "target_week": weeks, "actual": [10, 12, 9], "pred": [9.0, 11.0, 10.0], "lo": 5.0, "hi": 15.0})
    panel = pd.DataFrame({"zip": "10001", "week": pd.date_range("2022-12-05", periods=60, freq="7D"), "n": 10})
    card = export.scorecard_json({"best_model": best}, analysis.race_frame(panel, bt), analysis.interval_hits(bt), [])
    assert card["model_labels"]["model"] == analysis.MODEL_NAMES[best]
    assert "random_forest" not in card["race"] and card["race"]["model"][-1] is not None


def test_band_edges():
    from nynoise import analysis

    s = pd.Series([-0.5, -0.2, 0.0, 0.2, 0.5])
    assert analysis.band(s).tolist() == analysis.BANDS
