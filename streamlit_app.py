"""NYC noise-complaint forecast dashboard. Reads only the committed tables in data/."""
import json
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

D = Path(__file__).parent / "data"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
st.set_page_config(page_title="NYC Noise Forecast", page_icon=":material/volume_up:", layout="wide")


@st.cache_data
def load():
    z = dict(dtype={"zip": str})
    return dict(
        panel=pd.read_csv(D / "weekly_panel.csv.gz", parse_dates=["week"], **z),
        backtest=pd.read_csv(D / "backtest.csv.gz", parse_dates=["target_week"], **z),
        forecast=pd.read_csv(D / "forecast.csv", parse_dates=["target_week"], **z),
        zips=pd.read_csv(D / "zips.csv", **z),
        hourly=pd.read_csv(D / "hourly.csv"),
        metrics=json.loads((D / "metrics.json").read_text()),
        manifest=json.loads((D / "manifest.json").read_text()),
    )


try:
    t = load()
except FileNotFoundError:
    st.error("Data tables are missing. Run `python -m nynoise.data` then `python -m nynoise.model`.")
    st.stop()

m, man, fc = t["metrics"], t["manifest"], t["forecast"].merge(t["zips"], on="zip")
fc["vs_typical"] = fc["pred"] / fc["typical"].clip(lower=1) - 1
target = fc["target_week"].iloc[0]
hold, base = m["holdout"][m["best_model"]], m["holdout"][m["best_baseline"]]

st.title("NYC noise complaints: next-week forecast")
st.caption(
    f"311 noise complaints by ZIP code. Forecast for the week of {target:%b %d, %Y}; "
    f"data through {man['last_week']} (built {man['built_at'][:10]}). "
    "Complaints measure how often people report noise, not decibels."
)
c = st.columns(4)
c[0].metric("Forecast, all ZIPs", f"{fc['pred'].sum():,.0f}", f"{fc['pred'].sum() / fc['last_week'].sum() - 1:+.0%} vs last week")
c[1].metric("ZIPs modelled", man["zips"])
c[2].metric("Holdout error (WAPE)", f"{hold['wape']:.1%}", f"{(hold['wape'] - base['wape']) * 100:+.1f} pts vs best naive", delta_color="inverse")
c[3].metric("80% interval coverage", f"{m['interval']['empirical_coverage']:.0%}", "target 80%", delta_color="off")

tab_map, tab_zip, tab_when, tab_model = st.tabs(["Forecast map", "ZIP explorer", "When it happens", "Model card"])

with tab_map:
    fig = px.scatter(
        fc, x="lon", y="lat", size="pred", color="vs_typical", height=620, size_max=26,
        hover_name="zip", hover_data={"pred": ":.0f", "lo": ":.0f", "hi": ":.0f", "last_week": True,
                                      "vs_typical": ":+.0%", "lat": False, "lon": False, "typical": ":.0f"},
        color_continuous_scale="RdYlBu_r", range_color=(-0.5, 0.5),
        labels={"vs_typical": "vs ZIP's 52-wk avg", "pred": "forecast", "lo": "10th pct", "hi": "90th pct"},
    )
    # Plain lon/lat scatter: no tile service or WebGL, so it renders anywhere. 1/cos(40.7 deg) corrects aspect.
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False, scaleanchor="x", scaleratio=1.32)
    fig.update_traces(marker=dict(opacity=0.8, line=dict(width=0.5, color="white")))
    fig.update_layout(margin=dict(l=0, r=0, t=0, b=0), plot_bgcolor="rgba(0,0,0,0)",
                      coloraxis_colorbar=dict(tickformat="+.0%"))
    st.plotly_chart(fig, width="stretch")
    st.caption("Bubble size is forecast volume; color is the forecast relative to that ZIP's own 52-week average, "
               "so busy ZIPs are not always red. Positions are each ZIP's mean complaint location.")
    cols = ["zip", "pred", "lo", "hi", "last_week", "typical", "vs_typical"]
    st.dataframe(fc.sort_values("vs_typical", ascending=False)[cols].round(2), hide_index=True, width="stretch",
                 column_config={"vs_typical": st.column_config.NumberColumn("vs typical", format="percent")})

with tab_zip:
    zsel = st.selectbox("ZIP code", fc.sort_values("pred", ascending=False)["zip"])
    hist = t["panel"][t["panel"]["zip"] == zsel].tail(104)
    bt = t["backtest"][t["backtest"]["zip"] == zsel]
    f = fc[fc["zip"] == zsel].iloc[0]
    fig = go.Figure()
    fig.add_scatter(x=hist["week"], y=hist["n"], name="Actual", line=dict(color="#555"))
    fig.add_scatter(x=bt["target_week"], y=bt["hi"], line=dict(width=0), showlegend=False, hoverinfo="skip")
    fig.add_scatter(x=bt["target_week"], y=bt["lo"], fill="tonexty", fillcolor="rgba(31,119,180,.2)",
                    line=dict(width=0), name="80% interval (backtest)")
    fig.add_scatter(x=bt["target_week"], y=bt["pred"], name="Backtest prediction", line=dict(color="#1f77b4"))
    fig.add_scatter(x=[f["target_week"]], y=[f["pred"]], name="Next-week forecast", mode="markers",
                    marker=dict(size=11, color="#d62728"),
                    error_y=dict(type="data", symmetric=False, array=[f["hi"] - f["pred"]], arrayminus=[f["pred"] - f["lo"]]))
    fig.update_layout(height=460, yaxis_title="complaints / week", margin=dict(t=20), legend=dict(orientation="h"))
    st.plotly_chart(fig, width="stretch")
    mae = (bt["actual"] - bt["pred"]).abs().mean()
    st.write(f"Forecast **{f['pred']:.0f}** (80% range {f['lo']:.0f} to {f['hi']:.0f}) vs {f['last_week']:.0f} last week. "
             f"Holdout MAE for this ZIP: {mae:.1f} complaints/week.")

with tab_when:
    types = sorted(t["hourly"]["type"].unique())
    pick = st.multiselect("Complaint types", types, default=types)
    h = t["hourly"][t["hourly"]["type"].isin(pick)].groupby(["dow", "hour"], as_index=False)["n"].sum()
    grid = h.pivot(index="dow", columns="hour", values="n").reindex(range(7)).fillna(0)
    grid.index = DAYS
    fig = px.imshow(grid, aspect="auto", color_continuous_scale="Magma_r", height=380,
                    labels=dict(x="hour of day", y="", color="complaints"))
    st.plotly_chart(fig, width="stretch")
    st.caption("Last 52 weeks, citywide. Residential noise peaks late evening and weekends; street/sidewalk and commercial follow nightlife.")

with tab_model:
    st.subheader("Holdout results")
    st.caption(f"Trained on weeks before {m['holdout_weeks'][0]}; scored on {m['holdout_weeks'][0]} to {m['holdout_weeks'][1]} "
               f"({m['holdout_rows']:,} ZIP-weeks). Lower is better except R2.")
    rows = pd.DataFrame(m["holdout"]).T.rename_axis("model").reset_index()
    rows["model"] = rows["model"].where(rows["model"] != m["best_model"], rows["model"] + " (selected)")
    st.dataframe(rows.round(3).sort_values("wape"), hide_index=True, width="stretch")
    st.write(f"MASE below 1 beats the seasonal-naive forecast's in-sample error on the training years. "
             f"Interval coverage by ZIP: median {m['interval_by_zip']['median']:.0%}, "
             f"{m['interval_by_zip']['share_below_60pct']:.0%} of ZIPs under 60%.")
    ro = pd.DataFrame([{"quarter": f"{r['start']} to {r['end']}", "model WAPE": r["model"]["wape"],
                        "best naive WAPE": r[m["best_baseline"]]["wape"], "model MASE": r["model"]["mase"]}
                       for r in m["rolling_origin"]])
    st.markdown("**Rolling-origin backtest** (model refit before each quarter)")
    st.dataframe(ro.round(3), hide_index=True, width="stretch")
    wins = sum(r["model"]["wape"] < r["last_week"]["wape"] for r in m["rolling_origin"])
    st.write(f"**Read this as a modest edge.** Over the holdout year the selected model has {m['wape_skill_vs_best_baseline']:.0%} lower "
             f"weighted error than the best naive baseline (`{m['best_baseline']}`), and beats last-week persistence in {wins} of "
             f"{len(m['rolling_origin'])} quarters. Most of the signal is simply each ZIP's recent level; sudden citywide swings "
             "(a quarter in the holdout contains one) are not predictable from history.")
    imp = pd.Series(m["permutation_importance"]).sort_values()
    st.plotly_chart(px.bar(imp, orientation="h", height=320, labels=dict(value="MAE increase when shuffled", index=""),
                           title="Permutation importance (holdout)").update_layout(showlegend=False),
                    width="stretch")
    st.markdown(
        "**Method.** Each row is one ZIP and week `t`; features use only weeks up to `t`, the target is the count in week `t+1`. "
        "Counts are scaled by the ZIP's 52-week mean so one model serves busy and quiet ZIPs. Random forest and histogram gradient "
        "boosting are tuned with expanding-window CV on whole weeks, then scored once on the final 52 weeks. Intervals are quantile "
        "models widened by conformal calibration on a held-out stretch of training weeks.\n\n"
        "**Limits.** 311 data reflects reporting behavior (neighborhood, app awareness, events), not measured sound. ZIP-level "
        "forecasts cannot see one-off events (parades, heat waves, outages) or abrupt citywide shifts. The map places each ZIP at the mean location of its complaints."
    )
