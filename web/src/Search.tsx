import { useState } from "react";

type Hit = { label: string; lat: number; lon: number };

/** Address search via NYC Planning's GeoSearch (free, no key). The only runtime network call, made on submit. */
export default function Search({ onPick }: { onPick: (lat: number, lon: number, label: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "busy" | "none" | "error">("idle");

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setState("busy");
    try {
      const r = await fetch(`https://geosearch.planninglabs.nyc/v2/search?size=5&text=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      const found: Hit[] = (j.features ?? []).map((f: any) => ({ label: f.properties.label.replace(", New York, NY, USA", ""), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
      setHits(found);
      setState(found.length ? "idle" : "none");
      if (found.length === 1) { onPick(found[0].lat, found[0].lon, found[0].label); setHits([]); }
    } catch {
      setState("error");
    }
  };

  return (
    <form className="search" onSubmit={run} role="search">
      <label htmlFor="addr" className="sr-only">Find an address</label>
      <input id="addr" value={q} onChange={(e) => { setQ(e.target.value); setState("idle"); }} placeholder="Find an address, e.g. 350 5th Ave" autoComplete="street-address" />
      <button type="submit" disabled={state === "busy"}>{state === "busy" ? "…" : "Find"}</button>
      {state === "none" && <p className="search-msg">No NYC address matched. Try adding the borough.</p>}
      {state === "error" && <p className="search-msg">Address search is unavailable right now; click the map instead.</p>}
      {hits.length > 1 && (
        <ul className="search-hits">
          {hits.map((h) => <li key={h.label}><button type="button" onClick={() => { onPick(h.lat, h.lon, h.label); setHits([]); }}>{h.label}</button></li>)}
        </ul>
      )}
    </form>
  );
}
