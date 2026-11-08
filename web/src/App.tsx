import { cellToLatLng } from "h3-js";
import { useEffect, useMemo, useRef, useState } from "react";
import CellDrawer from "./CellDrawer";
import { type Bundle, COLD, THERMAL, loadAll, rampCss, reducedMotion } from "./data";
import MapView, { type Lens } from "./MapView";
import { Drivers, Forecast, Honesty, When } from "./Sections";

const LENSES: { id: Lens; label: string; note: string }[] = [
  { id: "complaints", label: "Complaints", note: "what people reported" },
  { id: "expected", label: "Expected", note: "from the city's fabric" },
  { id: "anomaly", label: "Surprise", note: "louder or quieter than expected" },
];

export default function App() {
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("complaints");
  const [factor, setFactor] = useState(0);
  const [month, setMonth] = useState(-1); // -1 = the whole two-year window
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [zip, setZip] = useState("");
  const timer = useRef<number>(0);

  useEffect(() => { loadAll().then((d) => { setB(d); setZip(d.forecast.zips.slice().sort((a, c) => c.pred - a.pred)[0].zip); }).catch((e) => setErr(String(e))); }, []);
  useEffect(() => {
    if (!playing || !b) return;
    timer.current = window.setInterval(() => setMonth((m) => (m + 1) % b.cells.months.length), 900);
    return () => window.clearInterval(timer.current);
  }, [playing, b]);

  // Label a clicked cell by the ZIP whose complaint centre is nearest (cos(41 deg) ~ 0.76 squashes longitude).
  const nearestZip = useMemo(() => {
    if (!b || sel === null) return null;
    const [lat, lon] = cellToLatLng(b.cells.h3[sel]);
    let best: string | null = null, bd = Infinity;
    for (const z of b.forecast.zips) {
      const dd = (z.lat - lat) ** 2 + ((z.lon - lon) * 0.76) ** 2;
      if (dd < bd) { bd = dd; best = z.zip; }
    }
    return best;
  }, [b, sel]);

  if (err) return <div className="loading">Could not load the data ({err}).</div>;
  if (!b) return <div className="loading">Tuning in to the city…</div>;

  const c = b.cells;
  const factorOptions = Object.entries(b.spatial.features).filter(([f]) => f !== "log_units");
  const timeLens = lens === "complaints";
  const monthLabel = month < 0 ? "Two years" : new Date(`${c.months[month]}-15`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const ramp = lens === "anomaly" ? `linear-gradient(90deg, rgb(${COLD.join(",")}), rgb(40,34,80), rgb(${THERMAL[3].join(",")}), rgb(${THERMAL[5].join(",")}))` : rampCss();
  const legendEnds = lens === "anomaly" ? ["quieter than expected", "louder"] : lens === "factor" ? ["less", "more of this factor"] : ["fewer", "more complaints a year"];

  return (
    <>
      <main>
        <section className="stage" aria-label="Noise field map">
          <div className="stage-map">
            <MapView cells={c} lens={lens} month={timeLens ? month : -1} factor={factor} selected={sel} onSelect={setSel} />
          </div>
          <header className="masthead">
            <h1>New York, <em>heard</em> from the street</h1>
            <p>Two years of 311 noise complaints rising off a 250 m grid. Rings pulse fastest where a block is louder than its surroundings predict. Click any block to see what goes with its noise.</p>
            <p className="fine">Complaints count reports, not decibels. {c.window[0]} to {c.window[1]}.</p>
          </header>
          {sel === null && <div className="hint">Drag to tilt and turn. Click a block.</div>}

          <nav className="rail" aria-label="Map lens">
            <span className="rail-label">Lens</span>
            <div className="seg">
              {LENSES.map((l) => (
                <button key={l.id} aria-pressed={lens === l.id} onClick={() => setLens(l.id)}>{l.label}<small>{l.note}</small></button>
              ))}
              <button aria-pressed={lens === "factor"} onClick={() => setLens("factor")}>A single factor<small>see one driver citywide</small></button>
            </div>
            {lens === "factor" && (
              <select aria-label="Factor to show" value={factor} onChange={(e) => setFactor(+e.target.value)}>
                {factorOptions.map(([f, m]) => <option key={f} value={c.features.indexOf(f)}>{m.label}</option>)}
              </select>
            )}
          </nav>

          <div className="legend" aria-hidden="true">
            {lens === "complaints" ? "Complaints a year per block" : lens === "expected" ? "Expected from the block's fabric" : lens === "anomaly" ? "Observed against expected" : b.spatial.features[c.features[factor]]?.label}
            <div className="ramp" style={{ background: ramp }} />
            <div className="ends"><span>{legendEnds[0]}</span><span>{legendEnds[1]}</span></div>
          </div>

          <div className="scrubber">
            <button className="play" onClick={() => { if (month < 0) setMonth(0); setPlaying(!playing); }} disabled={!timeLens || reducedMotion()}
              aria-label={playing ? "Pause the month replay" : "Play two years month by month"}>
              {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>}
            </button>
            <div className="scrub-track">
              <input type="range" min={-1} max={c.months.length - 1} value={month} disabled={!timeLens} aria-label="Month"
                onChange={(e) => { setPlaying(false); setMonth(+e.target.value); }} />
              <div className="scrub-meta"><span>{timeLens ? "All months" : "Time replay works on the Complaints lens"}</span><span>{c.months[c.months.length - 1]}</span></div>
            </div>
            <div className="scrub-now" aria-live="polite">{timeLens ? monthLabel : "Two years"}</div>
          </div>

          {sel !== null && <CellDrawer i={sel} cells={c} spatial={b.spatial} zip={nearestZip} onClose={() => setSel(null)} />}
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
      </footer>
    </>
  );
}
