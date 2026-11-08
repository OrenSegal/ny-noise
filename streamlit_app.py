"""NYC noise-complaint forecast: an atlas of next week, with its own scorecard.

Reads only the committed tables in data/. Interaction: select table rows (or type ZIPs) to pin up
to three; the band strip filters the map and table; the ZIP tab replays past forecasts; the
scorecard races the model against naive baselines.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from nynoise import analysis as an

D = Path(__file__).parent / "data"
INK, PAPER, RULE, MUTED = "#14213D", "#EEF1ED", "#C5CCC2", "#4A5468"
CLASS = ["#1D5F7A", "#86B4BC", "#D9D5C3", "#E9A15E", "#B3392B"]  # well below ... well above
CLASS_TEXT = ["#FFFFFF", INK, INK, INK, "#FFFFFF"]
MODEL_STYLE = {"random_forest": (INK, 3.2, "solid"), "last_week": ("#B3392B", 2, "solid"),
               "mean_4_weeks": ("#1D5F7A", 2, "solid"), "same_week_last_year": ("#7A8190", 2, "dot")}
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MAX_PINS = 3
CFG = {"displayModeBar": False}

st.set_page_config(page_title="NYC Noise Forecast", page_icon=":material/graphic_eq:", layout="wide")

st.markdown(f"""
<style>
@font-face {{ font-family: "Libre Franklin"; src: url("app/static/LibreFranklin-normal.woff2") format("woff2");
  font-weight: 100 900; font-style: normal; font-display: swap; }}
@font-face {{ font-family: "Source Serif 4"; src: url("app/static/SourceSerif4-normal.woff2") format("woff2");
  font-weight: 200 900; font-style: normal; font-display: swap; }}
@font-face {{ font-family: "Source Serif 4"; src: url("app/static/SourceSerif4-italic.woff2") format("woff2");
  font-weight: 200 900; font-style: italic; font-display: swap; }}
html, body, .stApp, [class*="st-"] {{ font-family: "Libre Franklin", "Franklin Gothic Medium", "Helvetica Neue", Arial, sans-serif; }}
.stApp {{ background: {PAPER}; color: {INK}; font-variant-numeric: tabular-nums; }}
.block-container {{ padding-top: 4.6rem; max-width: 1400px; }}
h1, h2, h3, .plate-title {{ font-family: "Source Serif 4", Georgia, serif !important; font-weight: 600; letter-spacing: -0.01em; color: {INK}; }}
h1 {{ font-size: 2.1rem !important; line-height: 1.1 !important; margin: 0 0 .5rem !important; padding: 0 !important; text-wrap: balance; }}
.plate-title {{ font-size: 1.15rem; margin: 0 0 .35rem; }}
.lede {{ font-size: 1.06rem; line-height: 1.55; max-width: 74ch; margin: 0 0 .35rem; }}
.lede b {{ font-weight: 650; }}
.note {{ color: {MUTED}; font-size: .86rem; max-width: 74ch; }}
.caption {{ font-family: "Source Serif 4", Georgia, serif; font-style: italic; color: {MUTED}; font-size: .9rem; line-height: 1.45; max-width: 70ch; margin: .25rem 0 1rem; }}
.readout {{ border-top: 1px solid {INK}; padding-top: .6rem; font-size: 1rem; line-height: 1.55; max-width: 80ch; }}
.hit {{ color: {CLASS[0]}; font-weight: 650; }} .miss {{ color: {CLASS[4]}; font-weight: 650; }}
[data-testid="stTabs"] [role="tablist"] {{ border-bottom: 1px solid {INK}; gap: .25rem; }}
[data-testid="stTabs"] [role="tab"] {{ font-weight: 600; padding: .55rem 1.1rem; margin-right: .15rem; }}
[data-testid="stTabs"] [role="tab"] p {{ font-size: 1rem; }}
[data-testid="stTabs"] [role="tab"][aria-selected="true"] {{ color: {INK}; }}
[data-testid="stTabs"] [data-baseweb="tab-highlight"] {{ background: {CLASS[4]}; height: 3px; }}
[data-testid="stPlotlyChart"], [data-testid="stDataFrame"] {{ border: 1px solid {RULE}; background: #F7F9F6; }}
button:focus-visible, [role="tab"]:focus-visible {{ outline: 2px solid {CLASS[4]} !important; outline-offset: 2px; }}
::selection {{ background: {CLASS[3]}; color: {INK}; }}
@media (max-width: 640px) {{ h1 {{ font-size: 1.6rem !important; }} .block-container {{ padding: 4rem .8rem 1rem; }} }}
@media (prefers-reduced-motion: reduce) {{ * {{ animation: none !important; transition: none !important; }} }}
</style>
""", unsafe_allow_html=True)


@st.cache_data
def load():
    z = dict(dtype={"zip": str})
    panel = pd.read_csv(D / "weekly_panel.csv.gz", parse_dates=["week"], **z)
    bt = pd.read_csv(D / "backtest.csv.gz", parse_dates=["target_week"], **z)
    fc = pd.read_csv(D / "forecast.csv", parse_dates=["target_week"], **z).merge(pd.read_csv(D / "zips.csv", **z), on="zip")
    fc["vs_typical"] = fc["pred"] / fc["typical"].clip(lower=1) - 1
    fc["band"] = an.band(fc["vs_typical"])
    race = an.race_frame(panel, bt)
    fc["last26"] = fc["zip"].map(panel.sort_values("week").groupby("zip")["n"].apply(lambda s: s.tail(26).tolist()))
    hits = an.interval_hits(bt)
    return dict(panel=panel, bt=bt, fc=fc, race=race, hits=hits, zsum=an.zip_summary(race, hits),
                surges=an.surge_weeks(panel), hourly=pd.read_csv(D / "hourly.csv"),
                metrics=json.loads((D / "metrics.json").read_text()), man=json.loads((D / "manifest.json").read_text()))


try:
    T = load()
except FileNotFoundError:
    st.error("Data tables are missing. Run `python -m nynoise.data` then `python -m nynoise.model`.")
    st.stop()

fc, panel, bt, race, hits, M = T["fc"], T["panel"], T["bt"], T["race"], T["hits"], T["metrics"]
target = fc["target_week"].iloc[0]
zips_by_volume = fc.sort_values("pred", ascending=False)["zip"].tolist()
st.session_state.setdefault("pinned", zips_by_volume[:1])
st.session_state.setdefault("strip_n", 0)


def style(fig, height, **kw):
    kw.setdefault("margin", dict(l=8, r=8, t=8, b=8))
    fig.update_layout(height=height, paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      font=dict(family="Libre Franklin, Arial, sans-serif", size=12, color=INK),
                      hoverlabel=dict(bgcolor="#F7F9F6", bordercolor=INK, font=dict(family="Libre Franklin, Arial", color=INK)), **kw)
    fig.update_xaxes(gridcolor=RULE, zerolinecolor=RULE, linecolor=INK, ticks="outside", tickcolor=INK)
    fig.update_yaxes(gridcolor=RULE, zerolinecolor=RULE, linecolor=INK)
    return fig


def pin(zip_code):
    cur = [z for z in st.session_state.pinned if z != zip_code]
    st.session_state.pinned = cur if zip_code in st.session_state.pinned else (cur + [zip_code])[-MAX_PINS:]


def pin_from_selection(key, zips):
    """Pin ZIPs the user just selected in a chart or table; rerun once so every view follows."""
    sig = tuple(zips)
    if sig and sig != st.session_state.get(f"_seen_{key}"):
        st.session_state[f"_seen_{key}"] = sig
        for z in sig:
            if z not in st.session_state.pinned:
                pin(z)
        st.rerun()
    if not sig:
        st.session_state[f"_seen_{key}"] = ()


def week_label(ts):
    t = pd.Timestamp(ts)
    return f"{t:%b} {t.day}, {t:%Y}"


# ---------------------------------------------------------------- header
best, hold = M["best_model"], M["holdout"]
base = hold[M["best_baseline"]]["wape"]
tot, last_tot = fc["pred"].sum(), fc["last_week"].sum()
chg = tot / last_tot - 1
n_up = int(fc["band"].isin(["Above", "Well above"]).sum())
n_down = int(fc["band"].isin(["Below", "Well below"]).sum())
st.markdown("<h1>Noise complaints in New York, week by week</h1>", unsafe_allow_html=True)
st.markdown(
    f'<p class="lede">For the week of {week_label(target)} the model expects <b>{tot:,.0f}</b> noise complaints '
    f'across {len(fc)} ZIP codes, <b>{abs(chg):.0%} {"below" if chg < 0 else "above"}</b> last week\'s {last_tot:,.0f}. '
    f'<b>{n_up}</b> ZIPs are forecast above their own 52-week norm and <b>{n_down}</b> below. '
    f'Over the last 52 weeks it missed by <b>{hold[best]["wape"]:.1%}</b> of volume, against {base:.1%} for simply repeating last week.</p>'
    f'<p class="note">311 complaints record how often people report noise, not how loud it is. '
    f'Data through {T["man"]["last_week"]}, rebuilt weekly.</p>', unsafe_allow_html=True)

pin_slot = st.container()  # filled at the end: the widget must be created after charts may change its value
pinned = st.session_state.pinned

tab_out, tab_zip, tab_cmp, tab_score, tab_when = st.tabs(["Outlook", "ZIP replay", "Compare", "Scorecard", "When"])

# ---------------------------------------------------------------- outlook
with tab_out:
    left, right = st.columns([5, 4], gap="large")
    with left:
        strip_slot, map_slot = st.container(), st.container()
        with strip_slot:
            counts = fc["band"].value_counts().reindex(an.BANDS).fillna(0).astype(int)
            strip = go.Figure([go.Bar(
                x=[int(counts[b])], y=[""], orientation="h", name=b, customdata=[b], text=[f"{b} {counts[b]}" if counts[b] >= 20 else str(counts[b])],
                textposition="inside", insidetextanchor="middle", textfont=dict(color=CLASS_TEXT[i], size=11),
                marker=dict(color=CLASS[i], line=dict(color=INK, width=1)), unselected=dict(marker=dict(opacity=.3)),
                hovertemplate=f"<b>{b}</b><br>{counts[b]} ZIPs<extra></extra>") for i, b in enumerate(an.BANDS)])
            style(strip, 70, barmode="stack", showlegend=False, margin=dict(l=2, r=2, t=2, b=2))
            strip.update_xaxes(visible=False)
            strip.update_yaxes(visible=False)
            ev = st.plotly_chart(strip, on_select="rerun", selection_mode="points", key=f"strip{st.session_state.strip_n}", config=CFG)
            sel = [an.BANDS[p["curve_number"]] for p in ev.selection.points] if ev and ev.selection.points else []
            st.markdown('<p class="caption">Each segment counts ZIPs in a class of forecast against the ZIP\'s own 52-week mean. '
                        'Click a segment to filter the map and table.</p>', unsafe_allow_html=True)
            if sel and st.button("Show all classes"):
                st.session_state.strip_n += 1
                st.rerun()
        view = fc[fc["band"].isin(sel)] if sel else fc
        with map_slot:
            st.markdown(f'<div class="plate-title">Forecast complaints by ZIP, week of {week_label(target)}</div>', unsafe_allow_html=True)
            m = go.Figure()
            for i, b in enumerate(an.BANDS):
                d = view[view["band"] == b]
                cd = d.assign(pct=d["vs_typical"] * 100)[["zip", "pred", "lo", "hi", "pct"]].to_numpy(dtype=object)
                m.add_trace(go.Scatter(
                    x=d["lon"], y=d["lat"], mode="markers", name=b, customdata=cd, showlegend=False,
                    marker=dict(size=np.sqrt(d["pred"].clip(lower=1)) * 1.9 + 4, color=CLASS[i], line=dict(color=INK, width=.8), opacity=.92),
                    selected=dict(marker=dict(opacity=.92)), unselected=dict(marker=dict(opacity=.92)),
                    hovertemplate="<b>%{customdata[0]}</b><br>forecast %{customdata[1]:.0f} (%{customdata[2]:.0f} to %{customdata[3]:.0f})"
                                  f"<br>%{{customdata[4]:+.0f}}% vs normal, {b}<extra></extra>"))
            pins = fc[fc["zip"].isin(pinned)]
            m.add_trace(go.Scatter(x=pins["lon"], y=pins["lat"], mode="markers+text", text=pins["zip"], textposition="top center",
                                   textfont=dict(color=INK, size=12), showlegend=False, hoverinfo="skip",
                                   marker=dict(symbol="circle-open", size=np.sqrt(pins["pred"].clip(lower=1)) * 1.9 + 14,
                                               line=dict(color=INK, width=2.5))))
            style(m, 560, dragmode=False)
            m.update_xaxes(visible=False)
            m.update_yaxes(visible=False, scaleanchor="x", scaleratio=1.32)
            st.plotly_chart(m, key="map", config=CFG)
            st.markdown('<p class="caption">Bubble area is forecast volume; tint is the class below the map. Rings mark your pinned ZIPs; hover for the forecast. '
                        'Positions are each ZIP\'s mean complaint location.</p>', unsafe_allow_html=True)
    with right:
        st.markdown(f'<div class="plate-title">{len(view)} ZIPs, ranked by extra complaints over normal</div>', unsafe_allow_html=True)
        tbl = view.assign(rng=lambda d: d["lo"].round().astype(int).astype(str) + " to " + d["hi"].round().astype(int).astype(str),
                          extra=lambda d: d["pred"] - d["typical"]).sort_values("extra", ascending=False)
        ev_tbl = st.dataframe(
            tbl[["zip", "pred", "extra", "vs_typical", "rng", "last26"]], hide_index=True, height=650, key="table",
            on_select="rerun", selection_mode="single-row", width="stretch",
            column_config={"zip": st.column_config.TextColumn("ZIP", width="small"),
                           "pred": st.column_config.NumberColumn("Forecast", format="%d", width="small"),
                           "extra": st.column_config.NumberColumn("Over normal", format="%+d", width="small"),
                           "rng": st.column_config.TextColumn("80% range", width="small"),
                           "vs_typical": st.column_config.NumberColumn("vs normal", format="percent", width="small"),
                           "last26": st.column_config.LineChartColumn("Last 26 weeks", width="medium")})
        rows = ev_tbl.selection.rows if ev_tbl else []
        pin_from_selection("table", [tbl["zip"].iloc[r] for r in rows if r < len(tbl)])
        st.markdown('<p class="caption">Sort any column. Select a row to pin that ZIP. Over normal is the forecast minus the ZIP\'s 52-week mean.</p>', unsafe_allow_html=True)

# ---------------------------------------------------------------- ZIP replay
with tab_zip:
    if not pinned:
        st.info("Pin a ZIP on the Outlook tab, or type one in the box above.")
    else:
        zc = st.selectbox("ZIP", pinned, help="Choose among your pinned ZIPs.")
        series = panel[panel["zip"] == zc].set_index("week")["n"]
        zbt = bt[bt["zip"] == zc].set_index("target_week")
        frow = fc[fc["zip"] == zc].iloc[0]
        weeks = list(zbt.index) + [frow["target_week"]]
        st.session_state.setdefault("replay_i", len(weeks) - 1)
        st.session_state.replay_i = min(st.session_state.replay_i, len(weeks) - 1)
        playing = st.toggle("Replay forecasts week by week", key="play")

        @st.fragment(run_every=0.9 if playing else None)
        def replay():
            if st.session_state.get("play"):
                st.session_state.replay_i = (st.session_state.replay_i + 1) % len(weeks)
            i = st.select_slider("Week being forecast", options=list(range(len(weeks))), key="replay_i",
                                 format_func=lambda k: week_label(weeks[k]) + (" (live forecast)" if k == len(weeks) - 1 else ""))
            w, live = weeks[i], i == len(weeks) - 1
            if live:
                pred, lo, hi, actual = frow["pred"], frow["lo"], frow["hi"], np.nan
            else:
                r = zbt.loc[w]
                pred, lo, hi, actual = r["pred"], r["lo"], r["hi"], r["actual"]
            known = series[series.index < w]
            past = zbt[zbt.index < w]
            fig = go.Figure()
            fig.add_trace(go.Scatter(x=known.index[-70:], y=known.values[-70:], name="Reported before", mode="lines",
                                     line=dict(color=INK, width=2)))
            if len(past):
                fig.add_trace(go.Scatter(x=past.index, y=past["pred"], name="Earlier forecasts", mode="lines",
                                         line=dict(color=CLASS[0], width=1.5, dash="dot")))
            fig.add_trace(go.Scatter(x=[w, w], y=[lo, hi], mode="lines", name="80% range", line=dict(color=CLASS[3], width=10)))
            fig.add_trace(go.Scatter(x=[w], y=[pred], mode="markers", name="Forecast",
                                     marker=dict(symbol="line-ew", size=22, line=dict(color=INK, width=3))))
            inside = (lo <= actual <= hi) if not np.isnan(actual) else None
            if inside is not None:
                fig.add_trace(go.Scatter(x=[w], y=[actual], mode="markers", name="Actual",
                                         marker=dict(size=13, color=CLASS[0] if inside else CLASS[4], line=dict(color=INK, width=1.5))))
            style(fig, 430, legend=dict(orientation="h", y=1.1, x=0), yaxis_title="complaints per week")
            fig.update_xaxes(range=[w - pd.Timedelta(weeks=62), w + pd.Timedelta(weeks=5)])
            fig.update_yaxes(range=[0, max(series.max(), hi) * 1.08])
            st.plotly_chart(fig, key="replay_chart", config=CFG)
            if live:
                msg = (f"Forecast for the week of {week_label(w)}: <b>{pred:.0f}</b> complaints, 80% range {lo:.0f} to {hi:.0f}, "
                       f"{frow['vs_typical']:+.0%} against this ZIP's normal of {frow['typical']:.0f}. No actual yet.")
            else:
                lw = race[(race["zip"] == zc) & (race["target_week"] == w) & (race["model"] == "last_week")]["pred"]
                lwe = f"{abs(actual - lw.iloc[0]):.0f}" if len(lw) else "n/a"
                msg = (f"Week of {week_label(w)}: forecast <b>{pred:.0f}</b> (range {lo:.0f} to {hi:.0f}), actual <b>{actual:.0f}</b>, "
                       f'<span class="{"hit" if inside else "miss"}">{"inside" if inside else "outside"} the range</span>. '
                       f"Error {abs(actual - pred):.0f} against {lwe} for repeating last week.")
            z = T["zsum"].loc[zc]
            st.markdown(f'<div class="readout">{msg}<br><span class="note">Across the holdout this ZIP\'s range held {z["coverage"]:.0%} '
                        f'of weeks (target 80%); mean error {z["mae"]:.1f} complaints per week.</span></div>', unsafe_allow_html=True)
        replay()

# ---------------------------------------------------------------- compare
with tab_cmp:
    if not pinned:
        st.info("Pin up to three ZIPs to compare them against their own normal.")
    else:
        pal = [INK, CLASS[4], CLASS[0]]
        fig = go.Figure()
        fig.add_hline(y=100, line=dict(color=INK, width=1), annotation_text="own 52-week average = 100",
                      annotation_position="bottom left", annotation_font=dict(size=11, color=MUTED))
        rows = []
        for k, z in enumerate(pinned):
            f = fc[fc["zip"] == z].iloc[0]
            s = panel[panel["zip"] == z].set_index("week")["n"].tail(104)
            sc = max(f["typical"], 1)
            idx = s / sc * 100
            fig.add_trace(go.Scatter(x=idx.index, y=idx.values, name=z, mode="lines", line=dict(color=pal[k], width=2.2)))
            fig.add_trace(go.Scatter(x=[f["target_week"]], y=[f["pred"] / sc * 100], mode="markers", showlegend=False,
                                     marker=dict(size=11, color=pal[k], line=dict(color=INK, width=1.5)),
                                     error_y=dict(type="data", symmetric=False, color=pal[k], thickness=2,
                                                  array=[(f["hi"] - f["pred"]) / sc * 100], arrayminus=[(f["pred"] - f["lo"]) / sc * 100])))
            zs = T["zsum"].loc[z]
            rows.append({"ZIP": z, "Forecast": f["pred"], "80% range": f"{f['lo']:.0f} to {f['hi']:.0f}", "vs normal": f["vs_typical"],
                         "Normal (52-wk mean)": f["typical"], "Last week": f["last_week"], "Holdout WAPE": zs["wape"],
                         "Last-week WAPE": zs["wape_last_week"], "Range held": zs["coverage"]})
        style(fig, 430, legend=dict(orientation="h", y=1.1, x=0), yaxis_title="weekly complaints, index to own average")
        st.markdown('<div class="plate-title">Pinned ZIPs against their own normal, last two years</div>', unsafe_allow_html=True)
        st.plotly_chart(fig, key="cmp", config=CFG)
        st.markdown('<p class="caption">Dots at the right edge are next week\'s forecast with its 80% range. Indexing to each ZIP\'s own '
                    'average puts a busy ZIP and a quiet one on one scale.</p>', unsafe_allow_html=True)
        pct = st.column_config.NumberColumn(format="percent")
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch", column_config={
            "Forecast": st.column_config.NumberColumn(format="%d"), "Normal (52-wk mean)": st.column_config.NumberColumn(format="%d"),
            "Last week": st.column_config.NumberColumn(format="%d"), "vs normal": pct, "Holdout WAPE": pct,
            "Last-week WAPE": pct, "Range held": pct})

# ---------------------------------------------------------------- scorecard
with tab_score:
    c1, c2 = st.columns([3, 2])
    with c1:
        chosen = st.pills("Forecasts in the race", list(an.MODELS), default=list(an.MODELS), selection_mode="multi",
                          format_func=an.MODELS.get)
    with c2:
        scope = st.segmented_control("Scope", ["All ZIPs", "Pinned ZIPs"], default="All ZIPs")
    chosen = chosen or []
    pinned_scope = scope == "Pinned ZIPs" and bool(pinned)
    use = race[race["zip"].isin(pinned)] if pinned_scope else race
    run = an.running_error(use)
    surge = [w for w in T["surges"] if w >= use["target_week"].min() - pd.Timedelta(weeks=1)]

    fig = go.Figure()
    for w in surge:
        fig.add_vrect(x0=w, x1=w + pd.Timedelta(days=7), fillcolor=CLASS[3], opacity=.28, line_width=0, layer="below")
    ends = sorted(((run[run["model"] == m_]["cum_wape"].iloc[-1], m_) for m_ in chosen))
    label_y, gap = {}, 0.016  # nudge end labels apart so neighbouring values stay legible
    for v, m_ in ends:
        label_y[m_] = max(v, label_y[prev] + gap) if (prev := next(reversed(label_y), None)) else v
    for mdl in chosen:
        d = run[run["model"] == mdl]
        col, wd, dash = MODEL_STYLE[mdl]
        fig.add_trace(go.Scatter(x=d["target_week"], y=d["cum_wape"], name=an.MODELS[mdl], mode="lines", line=dict(color=col, width=wd, dash=dash),
                                 hovertemplate="%{x|%b %d, %Y}<br>%{y:.1%}<extra>" + an.MODELS[mdl] + "</extra>"))
        fig.add_annotation(x=d["target_week"].iloc[-1], y=label_y[mdl], text=f"{d['cum_wape'].iloc[-1]:.1%}", showarrow=False,
                           xanchor="left", xshift=6, font=dict(color=col, size=12))
    style(fig, 420, legend=dict(orientation="h", y=1.12, x=0), yaxis=dict(tickformat=".0%", title="cumulative error (WAPE)"),
          margin=dict(l=8, r=56, t=8, b=8))
    st.markdown('<div class="plate-title">The race: error accumulated since the holdout began</div>', unsafe_allow_html=True)
    st.plotly_chart(fig, key="race", config=CFG)
    st.markdown('<p class="caption">Lower is better. The right-hand end of each line is that forecast\'s error for the whole year. '
                'Shaded weeks are citywide surges, more than 25% above the previous four weeks, which no history-based forecast can see coming.</p>',
                unsafe_allow_html=True)

    a, b = st.columns(2, gap="large")
    with a:
        st.markdown('<div class="plate-title">Error by quarter</div>', unsafe_allow_html=True)
        if pinned_scope:
            q = an.quarter_error(use)
            qd = {k: q[(q["model"] == k)].sort_values("min") for k in an.MODELS}
            note = "Pinned ZIPs, holdout model without refitting."
        else:
            ro = M["rolling_origin"]
            qd = {k: pd.DataFrame({"quarter": [f"{pd.Timestamp(r['start']):%b %Y} to {pd.Timestamp(r['end']):%b %Y}" for r in ro],
                                   "wape": [(r["model"] if k == "random_forest" else r[k])["wape"] for r in ro]}) for k in an.MODELS}
            note = "All ZIPs; the model is refit before each quarter."
        fq = go.Figure()
        for mdl in chosen:
            fq.add_trace(go.Bar(x=qd[mdl]["quarter"], y=qd[mdl]["wape"], name=an.MODELS[mdl],
                                marker=dict(color=MODEL_STYLE[mdl][0], line=dict(color=INK, width=.6)),
                                hovertemplate="%{x}<br>%{y:.1%}<extra>" + an.MODELS[mdl] + "</extra>"))
        style(fq, 330, barmode="group", legend=dict(orientation="h", y=1.18, x=0), yaxis=dict(tickformat=".0%", title="WAPE"))
        st.plotly_chart(fq, key="quarters", config=CFG)
        st.markdown(f'<p class="caption">{note} The first quarter is where the model loses to repeating last week.</p>', unsafe_allow_html=True)
    with b:
        st.markdown('<div class="plate-title">Did the 80% range hold?</div>', unsafe_allow_html=True)
        hh = hits[hits["zip"].isin(pinned)] if pinned_scope else hits
        wk = hh.groupby("target_week")["hit"].mean()
        fh = go.Figure()
        for w in surge:
            fh.add_vrect(x0=w, x1=w + pd.Timedelta(days=7), fillcolor=CLASS[3], opacity=.28, line_width=0, layer="below")
        fh.add_hline(y=.8, line=dict(color=INK, width=1, dash="dash"), annotation_text="80% target", annotation_position="bottom right",
                     annotation_font=dict(size=11, color=MUTED))
        fh.add_trace(go.Scatter(x=wk.index, y=wk.values, mode="lines", line=dict(color=INK, width=2), name="Share inside range",
                                hovertemplate="%{x|%b %d, %Y}<br>%{y:.0%} inside<extra></extra>"))
        style(fh, 330, yaxis=dict(tickformat=".0%", range=[0, 1.02], title="share of actuals inside range"), showlegend=False)
        st.plotly_chart(fh, key="coverage", config=CFG)
        st.markdown(f'<p class="caption">Each point is one week across {"pinned" if pinned_scope else "all"} ZIPs. Overall: {hh["hit"].mean():.1%}. '
                    f'The range is calibrated for ordinary weeks, so it holds less in surge weeks.</p>', unsafe_allow_html=True)

    st.markdown('<div class="plate-title">Holdout table</div>', unsafe_allow_html=True)
    ht = pd.DataFrame(M["holdout"]).T.rename(index={**an.MODELS, "hist_gradient_boosting": "Histogram gradient boosting"}).reset_index(names="Forecast")
    st.dataframe(ht.sort_values("wape"), hide_index=True, width="stretch", column_config={
        "mae": st.column_config.NumberColumn("MAE", format="%.1f"), "rmse": st.column_config.NumberColumn("RMSE", format="%.1f"),
        "r2": st.column_config.NumberColumn("R²", format="%.2f"), "wape": st.column_config.NumberColumn("WAPE", format="percent"),
        "smape": st.column_config.NumberColumn("sMAPE", format="percent"), "mase": st.column_config.NumberColumn("MASE", format="%.2f")})
    wins = sum(r["model"]["wape"] < r["last_week"]["wape"] for r in M["rolling_origin"])
    st.markdown(f'<p class="caption">Read this as a modest edge: {M["wape_skill_vs_best_baseline"]:.0%} lower weighted error than the best naive '
                f'forecast over the year, ahead of last-week persistence in {wins} of {len(M["rolling_origin"])} quarters, and behind it on RMSE and R². '
                f'Most of the signal is a ZIP\'s recent level.</p>', unsafe_allow_html=True)
    with st.expander("Method, limits and data"):
        st.markdown(
            "Each row is a ZIP and a week t. Features use only weeks up to t; the target is the count in week t+1, scaled by the ZIP's 52-week mean so one "
            "model serves busy and quiet ZIPs. Random forest and histogram gradient boosting are tuned with expanding-window cross-validation on whole weeks, "
            "then scored once on the final 52 weeks. Ranges are quantile models widened by conformal calibration on a held-out stretch of training weeks.\n\n"
            "Limits: 311 data reflects reporting behaviour, not measured sound. ZIP-level forecasts cannot see one-off events or abrupt citywide shifts. "
            "Source: NYC Open Data 311 service requests, complaint types beginning with Noise; "
            f"{T['man']['raw_rows']:,} raw rows, {T['man']['first_week']} to {T['man']['last_week']}. Full write-up in `docs/decisions.md`.")

# ---------------------------------------------------------------- when
with tab_when:
    types = sorted(T["hourly"]["type"].unique())
    pick = st.pills("Complaint types", types, default=types, selection_mode="multi")
    h = T["hourly"][T["hourly"]["type"].isin(pick or types)].groupby(["dow", "hour"], as_index=False)["n"].sum()
    grid = h.pivot(index="dow", columns="hour", values="n").reindex(index=range(7), columns=range(24)).fillna(0)
    st.markdown('<div class="plate-title">Citywide complaints by weekday and hour, last 52 weeks</div>', unsafe_allow_html=True)
    fig = go.Figure(go.Heatmap(z=grid.values, x=[f"{x:02d}:00" for x in range(24)], y=DAYS, xgap=2, ygap=2,
                               colorscale=[[0, "#E8ECE6"], [.5, CLASS[3]], [1, CLASS[4]]],
                               colorbar=dict(title="complaints", thickness=12, outlinewidth=1, outlinecolor=INK),
                               hovertemplate="%{y} %{x}<br>%{z:,} complaints<extra></extra>"))
    style(fig, 360)
    fig.update_yaxes(autorange="reversed")
    fig.update_xaxes(dtick=3)
    st.plotly_chart(fig, key="when", config=CFG)
    pk = np.unravel_index(grid.values.argmax(), grid.shape)
    late = grid.values[:, 22:].sum() + grid.values[:, :3].sum()
    st.markdown(f'<p class="caption">Busiest hour: {DAYS[pk[0]]} {pk[1]:02d}:00, {int(grid.values.max()):,} complaints. '
                f'{late / grid.values.sum():.0%} of complaints fall between 22:00 and 03:00. Type mix changes the shape: try Residential against Street/Sidewalk.</p>',
                unsafe_allow_html=True)

with pin_slot:
    st.multiselect("Pinned ZIPs (up to 3): select table rows, or type a ZIP", zips_by_volume, key="pinned",
                   max_selections=MAX_PINS, help="Every tab follows your pins.")
