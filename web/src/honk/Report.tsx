import { type Icon, IconAmbulance, IconBarrierBlock, IconBeer, IconCar, IconDeviceSpeaker, IconFiretruck, IconHelicopter, IconLink, IconTrain, IconTruck } from "@tabler/icons-react";
import { useMemo } from "react";
import { type Cells, TYPE_COLORS, feet, fmt, pct } from "../data";

// The usual 3 a.m. suspects, each read off one measured factor of the block and paired with the sound that stands in for it.
type Suspect = { f: string; sound: string; label: string; icon: Icon; near?: boolean; fact: (v: number, x: (f: string) => number) => string };
const SUSPECTS: Suspect[] = [
  { f: "bar_exposure", sound: "bar", label: "Bars letting out", icon: IconBeer, fact: (_, x) => `nearest bar ${feet(x("d_bar"))} from the typical home here` },
  { f: "elevated_exposure", sound: "el", label: "The El", icon: IconTrain, fact: (_, x) => `elevated tracks ${feet(x("d_elevated_rail"))} from the typical home here` },
  { f: "d_fire_station", sound: "fdny", label: "Fire trucks", icon: IconFiretruck, near: true, fact: (v) => `firehouse ${feet(v)} away` },
  { f: "d_hospital", sound: "ems", label: "Ambulances", icon: IconAmbulance, near: true, fact: (v) => `hospital ${feet(v)} away` },
  { f: "n_ahv", sound: "jack", label: "Night construction", icon: IconBarrierBlock, fact: (v) => `${fmt(v)} after-hours work permits within 300 m` },
  { f: "truck_exposure", sound: "garbage", label: "Trucks", icon: IconTruck, fact: () => "on or near a through truck route" },
  { f: "traffic_db", sound: "horn", label: "Traffic", icon: IconCar, fact: (v) => `about ${fmt(v)} dB of road traffic at homes, estimated` },
  { f: "@helicopter", sound: "heli", label: "Helicopters", icon: IconHelicopter, fact: (v) => `${fmt(v)} helicopter complaints a year` },
  { f: "@residential", sound: "party", label: "The neighbours", icon: IconDeviceSpeaker, fact: (v) => `${fmt(v)} loud-neighbour complaints a year` },
];
const TOP = 0.75; // a suspect shows when the block is in NYC's loudest quarter for it

const verdict = (p: number) =>
  p < 0.25 ? "Sleeps like Staten Island on a Tuesday."
  : p < 0.5 ? "Quieter at night than most of the city. Don't tell your broker."
  : p < 0.75 ? "Regular New York loud. You'll half get used to it."
  : p < 0.9 ? "Loud. Earplugs here are less an accessory than a lease term."
  : "Top-tier loud. The city that never sleeps is mostly this block.";

export default function Report({ c, i, place, woke, sound, onHear, onClose }: {
  c: Cells; i: number; place: string; woke: number; sound: string; onHear: (sound: string) => void; onClose: () => void;
}) {
  const r = useMemo(() => {
    const n = c.h3.length, years = c.years;
    // Share of NYC blocks strictly below this one; for distances, strictly farther.
    const rank = (get: (j: number) => number, near = false) => {
      const v = get(i);
      let below = 0;
      for (let j = 0; j < n; j++) if (near ? get(j) > v : get(j) < v) below++;
      return below / n;
    };
    const col = (f: string) => {
      if (f.startsWith("@")) { const t = c.type_counts[c.types.indexOf(f.slice(1))]; return (j: number) => t[j] / years; }
      const x = c.x[c.features.indexOf(f)];
      return (j: number) => x[j];
    };
    const x = (f: string) => col(f)(i);
    const night = (j: number) => (c.complaints[j] * c.night[j]) / years;
    const suspects = SUSPECTS.filter((s) => s.f.startsWith("@") || c.features.includes(s.f))
      .map((s) => { const v = x(s.f); return { ...s, v, p: rank(col(s.f), s.near) }; })
      .filter((s) => s.p >= TOP && (s.near || s.v > 0)).sort((a, b) => b.p - a.p).slice(0, 5);
    const total = c.complaints[i] || 1;
    return {
      night: night(i), pNight: rank(night), all: c.complaints[i] / years, ratio: (c.complaints[i] + 1) / (c.oof[i] + 1), suspects,
      types: c.types.map((t, k) => ({ t, share: c.type_counts[k][i] / total })).filter((d) => d.share > 0.01),
    };
  }, [c, i]);
  const copy = () => navigator.clipboard?.writeText(window.location.href);
  const [from, to] = c.window;

  return (
    <div className="honk-intro" role="dialog" aria-modal="true" aria-labelledby="report-h" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card help report">
        <div className="help-head">
          <div><p className="eyebrow">Wake my block · 3 a.m.</p><h2 id="report-h">{place}</h2></div>
          <div className="report-btns">
            <button className="close" onClick={copy} aria-label="Copy a link to this report" title="Copy link"><IconLink size={16} stroke={1.8} aria-hidden="true" /></button>
            <button className="close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <p className="report-verdict">{verdict(r.pNight)}</p>
        <div className="report-big">
          <div><b>{pct(r.pNight)}</b><span>of NYC blocks file fewer night noise complaints</span></div>
          <div><b>{fmt(r.night)}</b><span>night complaints a year (10 p.m. to 6 a.m.)</span></div>
          <div><b>{woke < 1 && woke > 0 ? "<1" : fmt(woke)}</b><span>people your {sound.toLowerCase()} woke</span></div>
        </div>
        <p>{r.ratio > 1.25 ? <>That is <b>{r.ratio.toFixed(1)}x</b> what a block built like this one usually files, so something here is louder than the buildings explain, or the neighbours call more.</>
          : r.ratio < 0.8 ? <>That is <b>{(1 / r.ratio).toFixed(1)}x fewer</b> than a block built like this one usually files: quieter than it looks, or more patient neighbours.</>
          : <>About what a block built like this one usually files.</>} Complaints count who calls, not who hears.</p>

        <h3>The usual suspects</h3>
        {r.suspects.length === 0 ? <p>Nothing here ranks in the city's loudest quarter: no El, no bar strip, no firehouse next door. Congratulations, or condolences on the commute.</p> : <>
          <p className="fine-top">Ranked by how this block compares with every other block in the city. Tap one to hear it on your street. It plays at your address, not where the source really is, so the count it gives is the worst case.</p>
          <ul className="suspects">{r.suspects.map((s) => (
            <li key={s.f}>
              <button onClick={() => onHear(s.sound)} aria-label={`${s.label}: honk it on your street`}>
                <s.icon size={22} stroke={1.6} aria-hidden="true" />
                <span><b>{s.label}</b><small>{s.fact(s.v, (f) => (f.startsWith("@") ? 0 : c.x[c.features.indexOf(f)][i]))}</small></span>
                <em>top {pct(Math.max(0.01, 1 - s.p))} in NYC</em>
              </button>
            </li>
          ))}</ul>
        </>}

        {r.types.length > 0 && <>
          <h3>What people here call 311 about</h3>
          <div className="types">{r.types.map((d) => <span key={d.t} style={{ width: `${d.share * 100}%`, background: TYPE_COLORS[d.t] }} />)}</div>
          <div className="types-key">{r.types.map((d) => <span key={d.t}><i style={{ background: TYPE_COLORS[d.t] }} />{d.t} {pct(d.share)}</span>)}</div>
          <p className="fine-top">All hours, {fmt(r.all)} complaints a year in total.</p>
        </>}

        <p className="fine">The block is the ~250 m hexagon around the address. 311 noise complaints from {from} to {to}, with each address capped so one caller can't make a block; the expectation comes from a model that never saw this neighbourhood. Suspects come from city data: bars and restaurants, elevated tracks, firehouses, hospitals, after-hours work permits, truck routes and a road-traffic estimate. It doesn't know garbage pickup times or helicopter flight paths.</p>
      </div>
    </div>
  );
}
