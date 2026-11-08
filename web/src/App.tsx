import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { useEffect, useMemo, useRef, useState } from "react";
import CellDrawer from "./CellDrawer";
import { type Bundle, fmt, loadAll, rampCss, reducedMotion } from "./data";
import { type Lens, type TimeOfDay, classify } from "./lens";
import MapView, { HOME, type HeatPoints, type View } from "./MapView";
import Search from "./Search";
import { Drivers, Forecast, Honesty, When } from "./Sections";
import { downloadCsv } from "./csv";

const LENSES: { id: Lens; label: string }[] = [
  { id: "complaints", label: "Complaints" },
  { id: "exposure", label: "Exposure" },
  { id: "expected", label: "Expected" },
  { id: "anomaly", label: "Observed / expected" },
  { id: "factor", label: "One factor" },
];
const TOP_N = 10;
const SOURCES = { highway: "Expressways", elevated: "Elevated rail", bar: "Bars and clubs" } as const;
type Source = keyof typeof SOURCES;
const TODS: { id: TimeOfDay; label: string }[] = [{ id: "all", label: "All day" }, { id: "day", label: "Day 06-22" }, { id: "night", label: "Night 22-06" }];

export default function App() {
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const [lens, setLens] = useState<Lens>((["complaints", "exposure", "expected", "anomaly", "factor"].includes(hash.get("lens") ?? "") ? hash.get("lens") : "complaints") as Lens);
  const [found, setFound] = useState<string | null>(null);
  const [tod, setTod] = useState<TimeOfDay>((["all", "day", "night"].includes(hash.get("time") ?? "") ? hash.get("time") : "all") as TimeOfDay);
  const [display, setDisplay] = useState<"heat" | "blocks">(hash.get("view") === "blocks" ? "blocks" : "heat");
  const [source, setSource] = useState<Source>((hash.get("source") ?? "highway") in SOURCES ? (hash.get("source") as Source) : "highway");
  const [factor, setFactor] = useState(0);
  const [month, setMonth] = useState(-1); // -1 = the whole two-year window
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [activeClass, setActiveClass] = useState<number | null>(null);
  const [view, setView] = useState<View>(HOME);
  const [zip, setZip] = useState("");
  const timer = useRef<number>(0);

  useEffect(() => {
    loadAll().then((d) => {
      setB(d);
      setZip(d.forecast.zips.slice().sort((a, c) => c.pred - a.pred)[0].zip);
      const f = d.cells.features.indexOf(hash.get("factor") ?? "bar_exposure");
      setFactor(Math.max(0, f >= 0 ? f : d.cells.features.indexOf("bar_exposure")));
      const cell = d.cells.h3.indexOf(hash.get("cell") ?? "");
      if (cell >= 0) {
        setSel(cell);
        const [lat, lon] = cellToLatLng(d.cells.h3[cell]);
        setView({ ...HOME, latitude: lat, longitude: lon, zoom: 13 });
      } else if (window.innerWidth < 860) setView({ ...HOME, zoom: 9.2 });
    }).catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => {
    if (!playing || !b) return;
    timer.current = window.setInterval(() => setMonth((m) => (m + 1) % b.cells.months.length), 900);
    return () => window.clearInterval(timer.current);
  }, [playing, b]);
  useEffect(() => setActiveClass(null), [lens, factor]);
  useEffect(() => {
    if (!b) return;
    const p = new URLSearchParams({ lens });
    if (lens === "factor") p.set("factor", b.cells.features[factor]);
    if (lens === "complaints") { p.set("time", tod); p.set("view", display); }
    if (lens === "exposure") p.set("source", source);
    if (sel !== null) p.set("cell", b.cells.h3[sel]);
    window.history.replaceState(null, "", `#${p}`);
  }, [b, lens, factor, sel, tod, display, source]);

  const timeLens = lens === "complaints" && display === "blocks";
  // Exposure is drawn as fine heat; its block-level twin feature drives the legend, tooltip and ranking.
  const blockLens: Lens = lens === "exposure" ? "factor" : lens;
  const blockFactor = lens === "exposure" && b ? Math.max(0, b.cells.features.indexOf(`${source}_exposure`)) : factor;
  const classed = useMemo(() => (b ? classify(b.cells, b.spatial, blockLens, timeLens ? month : -1, blockFactor, tod) : null),
    [b, blockLens, month, blockFactor, timeLens, tod]);
  const heat: HeatPoints = useMemo(() => {
    if (!b) return null;
    if (lens === "exposure") return { lat: b.heat.exposure.lat, lon: b.heat.exposure.lon, w: b.heat.exposure[source], level: true };
    if (lens !== "complaints" || display !== "heat") return null;
    const h = b.heat.complaints;
    return { lat: h.lat, lon: h.lon, w: tod === "night" ? h.night : tod === "day" ? h.all.map((v, i) => v - h.night[i]) : h.all };
  }, [b, lens, display, tod, source]);

  // Nearest ZIP (by complaint centre) labels a block; cos(41 deg) ~ 0.76 squashes longitude.
  const zipOf = useMemo(() => {
    if (!b) return () => null as string | null;
    return (i: number) => {
      const [lat, lon] = cellToLatLng(b.cells.h3[i]);
      let best: string | null = null, bd = Infinity;
      for (const z of b.forecast.zips) {
        const dd = (z.lat - lat) ** 2 + ((z.lon - lon) * 0.76) ** 2;
        if (dd < bd) { bd = dd; best = z.zip; }
      }
      return best;
    };
  }, [b]);

  if (err) return <div className="loading">Could not load the data ({err}).</div>;
  if (!b || !classed) return <div className="loading">Loading two years of complaints…</div>;

  const c = b.cells;
  const s = b.spatial;
  const label = (k: number) => s.features[c.features[k]]?.label ?? c.features[k];
  const factorOptions = Object.entries(s.features).filter(([f]) => f !== "log_units");
  const totalDays = c.complaints.reduce((a, v) => a + v, 0);
  const nextWeek = b.forecast.zips.reduce((a, z) => a + z.pred, 0);
  const isDist = blockLens === "factor" && c.features[blockFactor].startsWith("d_");
  const top = Array.from(classed.value.keys())
    .filter((i) => activeClass === null || classed.cls[i] === activeClass)
    .filter((i) => lens !== "anomaly" || c.oof[i] / c.years >= 25) // ratios on tiny blocks are noise
    .filter((i) => blockLens !== "factor" || c.units[i] > 0) // factors are measured at homes; homeless cells use their centre
    .sort((x, y) => (isDist ? classed.value[x] - classed.value[y] : classed.value[y] - classed.value[x]))
    .slice(0, TOP_N);
  const maxCount = Math.max(...classed.counts);
  const monthLabel = month < 0 ? "Two years" : new Date(`${c.months[month]}-15`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  const tooltip = (i: number) => {
    const ratio = (c.complaints[i] + 1) / (c.oof[i] + 1);
    const d = c.drivers[i][0];
    return `${zipOf(i) ? `Near ZIP ${zipOf(i)}\n` : ""}${classed.title}: ${classed.format(classed.value[i])}\n`
      + `${fmt(c.complaints[i] / c.years)} complaints a year, ${fmt(c.oof[i] / c.years)} expected (${ratio.toFixed(2)}x)`
      + (d ? `\nTop association: ${label(d[0])} x${d[1].toFixed(2)}` : "");
  };
  const index = new Map(c.h3.map((h, i) => [h, i]));
  const findAddress = (lat: number, lon: number, lab: string) => {
    const home = latLngToCell(lat, lon, 9);
    let i = index.get(home);
    if (i === undefined) for (const h of gridDisk(home, 2)) if (index.has(h)) { i = index.get(h); break; }
    if (i === undefined) { setFound(`${lab}: no block data within ~500 m`); return; }
    setFound(lab);
    pick(i);
  };
  const pick = (i: number) => {
    setSel(i);
    const [lat, lon] = cellToLatLng(c.h3[i]);
    setView({ ...view, latitude: lat, longitude: lon, zoom: Math.max(view.zoom, 12.5) });
  };

  return (
    <>
      <main>
        <section className="stage" aria-label="Noise complaints map">
          <div className="stage-map">
            <MapView cells={c} classed={classed} activeClass={activeClass} selected={sel} onSelect={setSel} view={view} setView={setView} tooltip={tooltip} heat={heat} />
          </div>

          <header className="masthead">
            <h1>New York noise, block by block</h1>
            <dl className="keystats">
              <div><dt>complaints, damped</dt><dd>{fmt(totalDays)}</dd></div>
              <div><dt>blocks (~250 m)</dt><dd>{fmt(c.h3.length)}</dd></div>
              <div><dt>deviance explained</dt><dd>{s.spatial_cv.full.d2_poisson.toFixed(2)} <small>vs {s.spatial_cv.units_only.d2_poisson.toFixed(2)} housing only</small></dd></div>
              <div><dt>forecast next week</dt><dd>{fmt(nextWeek)}</dd></div>
            </dl>
            <Search onPick={findAddress} />
            {found && <p className="found">{found}</p>}
            <p className="fine">311 reports, not decibels. Each address counts once a day per type and at most 24 times in two years, so a few repeat callers cannot paint a block. {c.window[0]} to {c.window[1]}.</p>
          </header>

          <aside className="rail" aria-label="Map lens and legend">
            <div className="seg" role="group" aria-label="Lens">
              {LENSES.map((l) => <button key={l.id} aria-pressed={lens === l.id} onClick={() => setLens(l.id)}>{l.label}</button>)}
            </div>
            {lens === "complaints" && <>
              <div className="seg seg3" role="group" aria-label="Time of day">
                {TODS.map((t) => <button key={t.id} aria-pressed={tod === t.id} onClick={() => { setTod(t.id); setMonth(-1); setPlaying(false); }}>{t.label}</button>)}
              </div>
              <div className="seg" role="group" aria-label="Display">
                <button aria-pressed={display === "heat"} onClick={() => setDisplay("heat")}>Heatmap ~65 m</button>
                <button aria-pressed={display === "blocks"} onClick={() => setDisplay("blocks")}>Blocks with numbers</button>
              </div>
            </>}
            {lens === "exposure" && (
              <div className="seg seg3" role="group" aria-label="Exposure source">
                {(Object.keys(SOURCES) as Source[]).map((k) => <button key={k} aria-pressed={source === k} onClick={() => setSource(k)}>{SOURCES[k]}</button>)}
              </div>
            )}
            {lens === "factor" && (
              <select aria-label="Factor to map" value={factor} onChange={(e) => setFactor(+e.target.value)}>
                {factorOptions.map(([f, m]) => <option key={f} value={c.features.indexOf(f)}>{m.label}</option>)}
              </select>
            )}
            {heat ? (
              <div className="legend">
                <div className="legend-title">{lens === "exposure" ? `${SOURCES[source]}: noise field` : `${classed.title}: density`}</div>
                <div className="ramp" style={{ background: rampCss() }} />
                <div className="ends"><span>less</span><span>more</span></div>
                <div className="legend-foot">{lens === "exposure"
                  ? source === "bar" ? "Each bar counts (30 m / distance)², summed at every point: a bar 30 m away counts 1, at 60 m a quarter, nothing past 150 m."
                    : "Every point scores 30 m / distance to the nearest line, so traffic falls off about 3 dB per doubling, out to 500 m. Tunnels excluded. From geometry, not complaints: people rarely call 311 about a constant highway."
                  : "Smoothed complaints on ~65 m cells, repeat callers capped. Switch to Blocks for exact numbers per ~250 m block."}</div>
              </div>
            ) : (
            <div className="legend">
              <div className="legend-title">{classed.title}</div>
              <ol className="classes">
                {classed.labels.map((lab, k) => (
                  <li key={k}>
                    <button aria-pressed={activeClass === k} onClick={() => setActiveClass(activeClass === k ? null : k)}
                      title={activeClass === k ? "Show all classes" : "Show only this class"}>
                      <i className="sw" style={{ background: `rgb(${classed.colors[k].join(",")})` }} />
                      <span className="lab">{lab}</span>
                      <span className="bar"><b style={{ width: `${(classed.counts[k] / maxCount) * 100}%` }} /></span>
                      <span className="n">{fmt(classed.counts[k])}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="legend-foot">Blocks per class. Click a class to isolate it.</div>
            </div>
            )}
          </aside>

          {sel === null && (
            <aside className="toplist" aria-label="Top blocks for this lens">
              <div className="legend-title">{isDist ? "Nearest blocks" : "Highest blocks"}{activeClass !== null ? " in this class" : ""}</div>
              <table className="tbl compact">
                <tbody>{top.map((i, r) => (
                  <tr key={i} onClick={() => pick(i)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && pick(i)}>
                    <td className="rank">{r + 1}</td><td>{zipOf(i) ?? "—"}</td><td className="num">{classed.format(classed.value[i])}</td>
                  </tr>))}</tbody>
              </table>
              <div className="legend-foot">{lens === "anomaly" ? "Blocks expecting 25+ complaints a year. " : ""}Select a row to zoom to it.</div>
            </aside>
          )}

          <div className="scrubber">
            <button className="play" onClick={() => { if (month < 0) setMonth(0); setPlaying(!playing); }} disabled={!timeLens || reducedMotion()}
              aria-label={playing ? "Pause the month replay" : "Play two years month by month"}>
              {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>}
            </button>
            <div className="scrub-track">
              <input type="range" min={-1} max={c.months.length - 1} value={month} disabled={!timeLens} aria-label="Month"
                onChange={(e) => { setPlaying(false); setMonth(+e.target.value); }} />
              <div className="scrub-meta"><span>{timeLens ? "Same class breaks every month" : "Month replay: Complaints lens, Blocks view"}</span><span>{c.months[c.months.length - 1]}</span></div>
            </div>
            <div className="scrub-now" aria-live="polite">{timeLens ? monthLabel : "Two years"}</div>
          </div>

          {sel !== null && <CellDrawer i={sel} cells={c} spatial={s} zip={zipOf(sel)} onClose={() => setSel(null)} />}
        </section>

        <div className="sheet">
          <Drivers b={b} />
          <Forecast b={b} zip={zip} setZip={setZip} />
          <Honesty b={b} />
          <When b={b} />
        </div>
      </main>
      <footer className="foot">
        <p>Data: NYC Open Data 311 service requests ({b.manifest.raw_rows.toLocaleString()} noise complaints since {b.manifest.first_week}), NYC DOB after-hours construction variances,
          NY State Liquor Authority active licences, NYC DOT truck routes, NYC PLUTO, OpenStreetMap contributors. Basemap © CARTO, © OpenStreetMap.
          Built weekly from <a href="https://github.com/OrenSegal/ny-noise">github.com/OrenSegal/ny-noise</a>, where the method, tests and decisions live.</p>
        <p>Use the data: <button className="linkish" onClick={() => downloadCsv(b)}>download every block as CSV</button> (damped complaints, complaint-days, raw reports, expected, ratio, night share and all 26 features),
          or the <a href="https://github.com/OrenSegal/ny-noise/tree/main/data">source tables on GitHub</a>. Address search uses <a href="https://geosearch.planninglabs.nyc/">NYC Planning GeoSearch</a>.</p>
      </footer>
    </>
  );
}
