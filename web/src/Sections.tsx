import { useMemo, useState } from "react";
import { type Bundle, TYPE_COLORS, fmt, pct } from "./data";
import PlotFigure, { Plot, plotStyle } from "./Plot";

const GROUP_COLORS: Record<string, string> = {
  People: "#7E86A1", "Built form": "#5B6380", Business: "#8E5CF7", Nightlife: "#C2187A", Roads: "#F2552C",
  "Rail and air": "#FFB23E", Construction: "#E8D44D", Sirens: "#FF7A7A", "Green space": "#3FD0E0",
};
const MODEL_COLORS: Record<string, string> = { model: "#FFF4D6", last_week: "#F2552C", mean_4_weeks: "#C2187A", same_week_last_year: "#5B6380", exp_smoothing: "#3FD0E0", blend_last_week_mean_4: "#8FD14F" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const d = (s: string) => new Date(`${s}T12:00:00`);
const dateFmt = (v: Date) => v.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Last point per line, nudged apart vertically so close end values stay readable. */
function endLabels<T extends { week: Date; wape: number | null; model: string }>(rows: T[], gap = 0.022) {
  const last = new Map<string, T>();
  rows.forEach((r) => last.set(r.model, r));
  const out = Array.from(last.values()).sort((a, b) => (a.wape ?? 0) - (b.wape ?? 0)).map((r) => ({ ...r, y: r.wape ?? 0 }));
  out.forEach((r, k) => { if (k > 0 && r.y - out[k - 1].y < gap) r.y = out[k - 1].y + gap; });
  return out;
}

export function Drivers({ b }: { b: Bundle }) {
  const s = b.spatial;
  const imp = Object.entries(s.importance).map(([f, v]) => ({ f, v, label: s.features[f].label, group: s.features[f].group }));
  const top = imp.slice(0, 9).map((x) => x.f);
  const [pick, setPick] = useState(top[1] ?? top[0]);
  const curve = s.curves[pick].x.map((x, k) => ({ x, effect: s.curves[pick].effect[k] }));
  const sc = s.spatial_cv;
  return (
    <section className="sec" id="drivers">
      <h2>What the city's fabric says about noise</h2>
      <p className="lede">A second model looks at {fmt(s.cells)} hex cells of about 250 m and asks which features of the surroundings go with more complaints:
        roads and truck routes, rail and airports, bars and venues, construction at night, sirens and parks. It explains where complaints concentrate; it does not
        forecast, and every effect is an <b>association</b>, not a cause.</p>
      <div className="stats">
        <div><b>{sc.full.d2_poisson.toFixed(2)}</b><span>deviance explained, new neighbourhoods</span></div>
        <div><b>{sc.units_only.d2_poisson.toFixed(2)}</b><span>from residential units alone</span></div>
        <div><b>{s.random_cv_full.d2_poisson.toFixed(2)}</b><span>if neighbours leaked (random folds)</span></div>
        <div><b>{sc.full.spearman.toFixed(2)}</b><span>rank correlation in held-out areas</span></div>
      </div>
      <div className="grid2">
        <figure className="figure">
          <h3>Which factors move the estimate most</h3>
          <PlotFigure label="Mean absolute effect by factor" deps={[]} make={(w) => Plot.plot({
            width: w, height: 36 + imp.length * 22, style: plotStyle, marginLeft: Math.min(300, w * 0.52), x: { label: "average effect on log complaint rate", grid: true },
            y: { label: null, domain: imp.map((x) => x.label) },
            marks: [Plot.barX(imp, { y: "label", x: "v", fill: (x) => GROUP_COLORS[x.group] ?? "#888", rx: 2 }), Plot.ruleX([0], { stroke: "#26304D" })],
          })} />
          <figcaption>Mean absolute SHAP value per factor across all cells. Colour is the factor family. Residential units come first because
            complaints need people to make them; everything else is measured on top of that. Distances to the few airports and stadiums
            partly stand in for location itself (which part of the city a block sits in), so read them as geography as much as jet or crowd noise.</figcaption>
        </figure>
        <figure className="figure">
          <h3>How one factor changes the estimate</h3>
          <div className="pills">{top.map((f) => <button key={f} aria-pressed={f === pick} onClick={() => setPick(f)}>{s.features[f].label}</button>)}</div>
          <PlotFigure label={`Effect of ${s.features[pick].label}`} deps={[pick]} make={(w) => Plot.plot({
            width: w, height: 300, style: plotStyle, marginLeft: 44, y: { label: "multiplier on complaints", grid: true, tickFormat: (v: number) => `x${v.toFixed(1)}` },
            x: { label: `${s.features[pick].label} (${s.features[pick].unit})`, type: pick.startsWith("d_") ? "log" : "linear" },
            marks: [Plot.ruleY([1], { stroke: "#7E86A1", strokeDasharray: "3,3" }),
                    Plot.lineY(curve, { x: "x", y: "effect", stroke: "#FFB23E", strokeWidth: 2.4, curve: "monotone-x" }),
                    Plot.dot(curve, { x: "x", y: "effect", fill: "#F2552C", r: 3.5, tip: true })],
          })} />
          <figcaption>Average multiplier at each twelfth of the factor's range, holding the rest of the cell as it is. Above the dashed line means more complaints than the city baseline.</figcaption>
        </figure>
      </div>
      {s.by_time && <DayNight s={s} />}
      <h3 style={{ marginTop: 40 }}>Sanity checks: does each complaint type follow its obvious source?</h3>
      <table className="tbl"><thead><tr><th>Complaint type</th><th>Factor</th><th className="num">Rank correlation</th><th>As expected</th></tr></thead>
        <tbody>{s.checks.map((c) => <tr key={c.type + c.feature}><td>{c.type}</td><td>{s.features[c.feature].label}</td>
          <td className="num">{c.spearman.toFixed(2)}</td><td className={c.agrees ? "ok" : "bad"}>{c.agrees ? "yes" : "no"}</td></tr>)}</tbody></table>
      <p className="lede" style={{ marginTop: 16 }}>Scores are from spatial cross-validation: each fold holds out whole ~36 km² areas, so a cell is never judged by a model that saw its neighbours.
        Random folds would report {s.random_cv_full.d2_poisson.toFixed(2)} instead of {sc.full.d2_poisson.toFixed(2)}; the gap is what leakage looks like.</p>
    </section>
  );
}

export function Forecast({ b, zip, setZip }: { b: Bundle; zip: string; setZip: (z: string) => void }) {
  const f = b.forecast;
  const z = f.zips.find((x) => x.zip === zip) ?? f.zips[0];
  const ranked = useMemo(() => f.zips.slice().sort((a, b2) => (b2.pred - b2.typical) - (a.pred - a.typical)), [f]);
  const hist = f.weeks.map((w, k) => ({ week: d(w), n: z.n[k] }));
  const bt = f.bt_weeks.map((w, k) => ({ week: d(w), pred: z.bt.pred[k], lo: z.bt.lo[k], hi: z.bt.hi[k] })).filter((r) => r.pred !== null);
  const tw = d(f.target_week);
  const total = f.zips.reduce((a, x) => a + x.pred, 0), last = f.zips.reduce((a, x) => a + x.last, 0);
  return (
    <section className="sec" id="forecast">
      <h2>Next week, ZIP by ZIP</h2>
      <p className="lede">A separate model forecasts the week of <b>{tw.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b>:
        {" "}<b>{fmt(total)}</b> complaints across {f.zips.length} ZIP codes, {total < last ? "down" : "up"} {pct(Math.abs(total / last - 1))} on last week, each with an 80% range.</p>
      <div className="grid2">
        <figure className="figure">
          <h3>ZIP {z.zip}: the last two years, the backtest and next week</h3>
          <PlotFigure label={`Weekly complaints and forecast for ${z.zip}`} deps={[z.zip]} make={(w) => Plot.plot({
            width: w, height: 340, style: plotStyle, marginLeft: 40, x: { type: "utc", label: null }, y: { grid: true, label: "complaints per week" },
            marks: [Plot.areaY(bt, { x: "week", y1: "lo", y2: "hi", fill: "#C2187A", fillOpacity: 0.28, curve: "step" }),
                    Plot.lineY(hist, { x: "week", y: "n", stroke: "#EEF0F7", strokeWidth: 1.5 }),
                    Plot.lineY(bt, { x: "week", y: "pred", stroke: "#FFB23E", strokeDasharray: "4,3", strokeWidth: 1.4 }),
                    Plot.ruleX([tw], { y1: z.lo, y2: z.hi, stroke: "#F2552C", strokeWidth: 8, strokeOpacity: 0.6 }),
                    Plot.dot([{ week: tw, y: z.pred }], { x: "week", y: "y", r: 6, fill: "#FFF4D6", stroke: "#F2552C", strokeWidth: 2, tip: true, title: () => `forecast ${Math.round(z.pred)} (${Math.round(z.lo)} to ${Math.round(z.hi)})` })],
          })} />
          <figcaption>White: reported. Dashed amber: what the model forecast each week of the holdout, with its 80% range in magenta. The dot at the right is next week.</figcaption>
        </figure>
        <figure className="figure">
          <h3>Furthest above their own normal next week</h3>
          <div className="scroll-list"><table className="tbl"><thead><tr><th>ZIP</th><th className="num">Forecast</th><th className="num">80% range</th><th className="num">vs normal</th></tr></thead>
            <tbody>{ranked.map((x) => <tr key={x.zip} className={x.zip === z.zip ? "sel" : ""} onClick={() => setZip(x.zip)} tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setZip(x.zip)}>
              <td>{x.zip}</td><td className="num">{fmt(x.pred)}</td><td className="num">{fmt(x.lo)} to {fmt(x.hi)}</td>
              <td className={`num ${x.pred > x.typical ? "bad" : "ok"}`}>{x.pred >= x.typical ? "+" : ""}{pct(x.pred / Math.max(x.typical, 1) - 1)}</td></tr>)}</tbody></table></div>
          <figcaption>Select a row to chart it. Normal is the ZIP's own 52-week average.</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function Honesty({ b }: { b: Bundle }) {
  const s = b.score;
  const models = Object.keys(s.model_labels);
  const [on, setOn] = useState<string[]>(models);
  const race = models.filter((m) => on.includes(m)).flatMap((m) => s.race.weeks.map((w, k) => ({ week: d(w), wape: s.race[m][k], model: s.model_labels[m], key: m })))
    .filter((r) => r.wape !== null);
  const cov = s.race.weeks.map((w, k) => ({ week: d(w), c: s.weekly_coverage[k] })).filter((r) => r.c !== null);
  const surges = s.surges.map((w) => ({ x1: d(w), x2: new Date(d(w).getTime() + 7 * 864e5) }));
  const best = s.holdout[s.best_model], base = s.holdout[s.best_baseline];
  const wins = s.rolling_origin.filter((r) => r.model.wape < r[r.best_baseline].wape).length;
  const edge = s.skill[s.best_baseline], sure = edge.ci[0] > 0;
  return (
    <section className="sec" id="honesty">
      <h2>How good is the forecast, honestly</h2>
      <p className="lede">Scored on 52 weeks it never saw ({s.holdout_weeks[0]} to {s.holdout_weeks[1]}). It misses by <b>{pct(best.wape, 1)}</b> of volume against <b>{pct(base.wape, 1)}</b>
        {" "}for the best simple baseline ({s.model_labels[s.best_baseline].toLowerCase()}): {pct(edge.skill, 1)} less error, with a 95% range of {pct(edge.ci[0], 1)} to {pct(edge.ci[1], 1)} when whole weeks are resampled
        {sure ? "" : ", which includes zero, so that edge is not established"}. It is ahead of each quarter's best baseline in {wins} of {s.rolling_origin.length} quarters. Most of the signal is a ZIP's recent level.</p>
      <div className="grid2">
        <figure className="figure">
          <h3>The race: error accumulated week by week</h3>
          <div className="pills">{models.map((m) => <button key={m} aria-pressed={on.includes(m)} onClick={() => setOn(on.includes(m) ? on.filter((x) => x !== m) : [...on, m])}>{s.model_labels[m]}</button>)}</div>
          <PlotFigure label="Cumulative error by forecast" deps={[on.join()]} make={(w) => Plot.plot({
            width: w, height: 320, style: plotStyle, marginLeft: 44, marginRight: 50, x: { type: "utc", label: null }, y: { grid: true, label: "cumulative WAPE", tickFormat: "%" },
            color: { domain: models.map((m) => s.model_labels[m]), range: models.map((m) => MODEL_COLORS[m]) },
            marks: [Plot.rectX(surges, { x1: "x1", x2: "x2", fill: "#F2552C", fillOpacity: 0.16 }),
                    Plot.lineY(race, { x: "week", y: "wape", stroke: "model", strokeWidth: (r) => (r.key === "model" ? 3 : 1.6), tip: { format: { x: dateFmt, y: (v: number) => pct(v, 1) } } }),
                    Plot.text(endLabels(race), { x: "week", y: "y", text: (r) => pct(r.wape, 1), dx: 6, textAnchor: "start", fill: "model" })],
          })} />
          <figcaption>Lower is better; the end of each line is the year's error. Shaded weeks are citywide surges, 25% or more above the previous four weeks.</figcaption>
        </figure>
        <figure className="figure">
          <h3>Did the 80% range hold?</h3>
          <PlotFigure label="Share of ZIPs inside the 80% range each week" deps={[]} make={(w) => Plot.plot({
            width: w, height: 320 + 44, style: plotStyle, marginLeft: 44, x: { type: "utc", label: null }, y: { domain: [0, 1], grid: true, tickFormat: "%", label: "share inside range" },
            marks: [Plot.rectX(surges, { x1: "x1", x2: "x2", fill: "#F2552C", fillOpacity: 0.16 }), Plot.ruleY([0.8], { stroke: "#7E86A1", strokeDasharray: "4,3" }),
                    Plot.lineY(cov, { x: "week", y: "c", stroke: "#3FD0E0", strokeWidth: 2, tip: { format: { x: dateFmt, y: (v: number) => pct(v) } } })],
          })} />
          <figcaption>Overall {pct(s.interval.empirical_coverage, 1)} against a target of 80%; median ZIP {pct(s.interval_by_zip.median)}. By ZIP volume: {s.interval_by_volume.map((v) => `${v.tercile} ${pct(v.coverage, 1)}`).join(", ")}. Coverage falls in surge weeks, which the range is not built for.</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function When({ b }: { b: Bundle }) {
  const h = b.hourly;
  const types = Array.from(new Set(h.type)).sort();
  const [pick, setPick] = useState<string[]>(types);
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    h.type.forEach((t, k) => { if (pick.includes(t)) { const key = `${h.dow[k]}-${h.hour[k]}`; m.set(key, (m.get(key) ?? 0) + h.n[k]); } });
    return Array.from(m, ([k, n]) => ({ dow: DAYS[+k.split("-")[0]], hour: +k.split("-")[1], n }));
  }, [h, pick]);
  const short = (t: string) => t.replace("Noise - ", "");
  return (
    <section className="sec" id="when">
      <h2>When the city complains</h2>
      <p className="lede">Every noise complaint of the last 52 weeks by weekday and hour. Pick complaint types to see how their rhythms differ.</p>
      <div className="pills">{types.map((t) => <button key={t} aria-pressed={pick.includes(t)} onClick={() => setPick(pick.includes(t) ? pick.filter((x) => x !== t) : [...pick, t])}>{short(t)}</button>)}</div>
      <PlotFigure label="Complaints by weekday and hour" deps={[pick.join()]} make={(w) => Plot.plot({
        width: w, height: 300, style: plotStyle, marginLeft: 44, padding: 0.06, x: { label: "hour of day", tickFormat: (v: number) => `${v}:00`, ticks: 8 },
        y: { domain: DAYS, label: null }, color: { type: "sqrt", range: ["#120F2A", "#C2187A", "#F2552C", "#FFF4D6"], interpolate: "rgb", legend: true, label: "complaints" },
        marks: [Plot.cell(grid, { x: "hour", y: "dow", fill: "n", inset: 0.5, rx: 2, tip: true })],
      })} />
    </section>
  );
}

export const TypeLegend = () => (
  <div className="types-key">{Object.entries(TYPE_COLORS).map(([t, c]) => <span key={t}><i style={{ background: c }} />{t}</span>)}</div>
);

function DayNight({ s }: { s: Bundle["spatial"] }) {
  const bt = s.by_time!;
  const feats = Array.from(new Set([...Object.keys(bt.night.importance).slice(0, 8), ...Object.keys(bt.day.importance).slice(0, 8)]))
    .filter((f) => f !== "log_units");
  const rows = feats.flatMap((f) => (["day", "night"] as const).map((t) => ({ label: s.features[f].label, when: t === "day" ? "Day 06-22" : "Night 22-06", v: bt[t].importance[f] ?? 0 })));
  const order = feats.slice().sort((a, b) => (bt.night.importance[b] ?? 0) - (bt.night.importance[a] ?? 0)).map((f) => s.features[f].label);
  return (
    <figure className="figure" style={{ marginTop: 40 }}>
      <h3>Day against night: which factors matter after dark</h3>
      <PlotFigure label="Factor importance by time of day" deps={[]} make={(w) => Plot.plot({
        width: w, height: 40 + order.length * 26, style: plotStyle, marginLeft: Math.min(320, w * 0.5), x: { label: "average effect on log complaint rate", grid: true },
        y: { label: null, domain: order }, color: { domain: ["Day 06-22", "Night 22-06"], range: ["#FFB23E", "#8E5CF7"], legend: true },
        marks: [Plot.ruleY(order, { stroke: "#26304D" }), Plot.dot(rows, { y: "label", x: "v", fill: "when", r: 5, tip: true })],
      })} />
      <figcaption>Two more models, fitted on day and on night complaints separately (spatial CV deviance explained: day {bt.day.spatial_cv.d2_poisson.toFixed(2)},
        night {bt.night.spatial_cv.d2_poisson.toFixed(2)}). A factor whose purple dot sits right of its amber one matters more at night. Residential units are left out to keep the scale readable.</figcaption>
    </figure>
  );
}
