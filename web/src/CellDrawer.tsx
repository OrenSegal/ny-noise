import { type Cells, type Spatial, TYPE_COLORS, feet, fmt, pct, thermal } from "./data";
import PlotFigure, { Plot, plotStyle } from "./Plot";

const KEY_FACTS = ["highway_exposure", "d_highway", "d_elevated_rail", "bar_exposure", "d_bar", "d_restaurant", "n_ahv", "d_park"];

function factValue(name: string, v: number) {
  return name.startsWith("d_") ? feet(v) : name.endsWith("_exposure") ? fmt(v, 2) : fmt(v);
}

export default function CellDrawer({ i, cells, spatial, zip, onClose }: {
  i: number; cells: Cells; spatial: Spatial; zip: string | null; onClose: () => void;
}) {
  const meta = spatial.features;
  const name = (k: number) => meta[cells.features[k]]?.label ?? cells.features[k];
  const perYear = cells.complaints[i] / cells.years;
  const expected = cells.oof[i] / cells.years;
  const ratio = (cells.complaints[i] + 1) / (cells.oof[i] + 1);
  const total = cells.complaints[i] || 1;
  const types = cells.types.map((t, k) => ({ t, n: cells.type_counts[k][i] })).filter((d) => d.n > 0);
  const months = cells.months.map((m, k) => ({ month: new Date(`${m}-15`), n: cells.monthly[i][k] }));
  const maxMult = Math.max(2, ...cells.drivers[i].map((d) => d[1]));
  // Where this block sits among all NYC blocks, overall and at night (22:00 to 06:00).
  const rankOf = (arr: (j: number) => number) => {
    const v = arr(i);
    let below = 0;
    for (let j = 0; j < cells.complaints.length; j++) if (arr(j) < v) below++;
    return below / cells.complaints.length;
  };
  const pAll = rankOf((j) => cells.complaints[j]);
  const pNight = rankOf((j) => cells.complaints[j] * cells.night[j]);
  const verdict = ratio > 1.25 ? `${ratio.toFixed(1)}x louder than its surroundings predict` : ratio < 0.8
    ? `${(1 / ratio).toFixed(1)}x quieter than its surroundings predict` : "about as loud as its surroundings predict";

  return (
    <aside className="drawer" aria-label="Selected block">
      <div className="drawer-head">
        <h2>{zip ? `Near ZIP ${zip}` : "This block"}</h2>
        <button className="close" onClick={() => navigator.clipboard?.writeText(window.location.href)} aria-label="Copy a link to this block" title="Copy link">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M6 8a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.6.6M8 6a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.6-.6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
        </button>
        <button className="close" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="big">
        <div><b>{fmt(perYear)}</b><span>complaint-days a year</span></div>
        <div><b>{fmt(expected)}</b><span>expected from its fabric</span></div>
        <div><b>{pct(cells.night[i])}</b><span>at night (22 to 06)</span></div>
      </div>
      <p className="rank-line">More complaint-days than <b>{pct(pAll)}</b> of NYC blocks, and than <b>{pct(pNight)}</b> at night.</p>
      <p className="verdict">This ~250 m cell is <b>{verdict}</b>. The expectation comes from a model that never saw this neighbourhood.
        {cells.reports[i] > cells.complaints[i] * 1.5 && <> Raw reports were {fmt(cells.reports[i] / cells.years)} a year; repeat calls from one address on one day count once here.</>}</p>

      <h3>What is associated with its noise</h3>
      {cells.drivers[i].length === 0 && <p className="verdict">No factor pushes this cell above the city's baseline.</p>}
      {cells.drivers[i].map(([k, m]) => (
        <div className="mult" key={k}>
          <span>{name(k)}</span><b>x{m.toFixed(2)}</b>
          <span className="bar"><i style={{ width: `${Math.min(100, (Math.log(m) / Math.log(maxMult)) * 100)}%`, background: `rgb(${thermal(0.55 + Math.min(Math.log(m), 1) * 0.45).slice(0, 3).join(",")})` }} /></span>
        </div>
      ))}
      {cells.quieters[i].length > 0 && <>
        <h3>Goes with fewer complaints here</h3>
        {cells.quieters[i].map(([k, m]) => (
          <div className="mult" key={k}><span>{name(k)}</span><b className="ok">x{m.toFixed(2)}</b>
            <span className="bar"><i style={{ width: `${Math.min(100, -Math.log(m) * 140)}%`, background: "var(--cold)" }} /></span></div>
        ))}
      </>}

      <h3>What people reported</h3>
      <div className="types">{types.map((d) => <span key={d.t} style={{ width: `${(d.n / total) * 100}%`, background: TYPE_COLORS[d.t] }} />)}</div>
      <div className="types-key">{types.map((d) => <span key={d.t}><i style={{ background: TYPE_COLORS[d.t] }} />{d.t} {pct(d.n / total)}</span>)}</div>

      <h3>Month by month</h3>
      <PlotFigure label="Monthly complaints in this cell" deps={[i]} make={(w) => Plot.plot({
        width: w, height: 110, style: plotStyle, marginLeft: 30, marginBottom: 22, x: { type: "utc", ticks: 4 }, y: { grid: true, ticks: 3, label: null },
        marks: [Plot.areaY(months, { x: "month", y: "n", fill: "#F2552C", fillOpacity: 0.25, curve: "monotone-x" }),
                Plot.lineY(months, { x: "month", y: "n", stroke: "#FFB23E", strokeWidth: 1.6, curve: "monotone-x" })],
      })} />

      <h3>Measured around it</h3>
      <div className="facts">
        {KEY_FACTS.map((f) => {
          const k = cells.features.indexOf(f);
          return k < 0 ? null : [<span key={`${f}l`}>{meta[f]?.label}</span>, <span key={`${f}v`}>{factValue(f, cells.x[k][i])}</span>];
        })}
        <span>Residential units in cell</span><span>{fmt(cells.units[i])}</span>
      </div>
    </aside>
  );
}
