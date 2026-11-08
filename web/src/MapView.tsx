import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { cellToLatLng } from "h3-js";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
// MapLibre 6 loads its worker by URL; let Vite bundle it so the built site serves a real script.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Cells, diverging, reducedMotion, thermal } from "./data";

setWorkerUrl(workerUrl);

export type Lens = "complaints" | "expected" | "anomaly" | "factor";
const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";
const VIEW = { longitude: -73.935, latitude: 40.705, zoom: 10.25, pitch: 50, bearing: -17 };
const HOTSPOTS = 64;
const elevation = (t: number) => Math.pow(t, 2.2) * 2600 + 6;

/** Per-cell value for the active lens, plus a 0..1 intensity used for colour, height and ripples. */
export function lensValues(cells: Cells, lens: Lens, month: number, factor: number) {
  const n = cells.h3.length;
  const value = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (lens === "complaints") value[i] = month >= 0 ? cells.monthly[i][month] * 12 : cells.complaints[i] / cells.years;
    else if (lens === "expected") value[i] = cells.oof[i] / cells.years;
    else if (lens === "anomaly") value[i] = Math.log2((cells.complaints[i] + 1) / (cells.oof[i] + 1));
    else {
      const v = cells.x[factor][i];
      value[i] = cells.features[factor].startsWith("d_") ? -Math.log1p(v) : Math.log1p(Math.max(v, 0));
    }
  }
  const sorted = Array.from(value).sort((a, b) => a - b);
  const lo = sorted[Math.floor(n * 0.02)], hi = sorted[Math.floor(n * 0.995)];
  const intensity = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Counts: log scale anchored between the 2nd and 99.5th percentile, so only true hotspots run white-hot.
    intensity[i] = lens === "complaints" || lens === "expected"
      ? (Math.log1p(Math.max(value[i], 0)) - Math.log1p(Math.max(lo, 0))) / (Math.log1p(Math.max(hi, 1)) - Math.log1p(Math.max(lo, 0)) || 1)
      : (value[i] - lo) / (hi - lo || 1);
    intensity[i] = Math.max(0, Math.min(1, intensity[i]));
  }
  return { value, intensity };
}

export default function MapView({ cells, lens, month, factor, selected, onSelect }: {
  cells: Cells; lens: Lens; month: number; factor: number; selected: number | null; onSelect: (i: number | null) => void;
}) {
  const { value, intensity } = useMemo(() => lensValues(cells, lens, month, factor), [cells, lens, month, factor]);
  const centers = useMemo(() => cells.h3.map((h) => cellToLatLng(h)), [cells]);
  const idx = useMemo(() => cells.h3.map((_, i) => i), [cells]);
  const hot = useMemo(() => {
    const order = idx.slice().sort((a, b) => value[b] - value[a]).slice(0, HOTSPOTS);
    return order.map((i, k) => {
      const ratio = Math.log2((cells.complaints[i] + 1) / (cells.oof[i] + 1));
      return { i, phase: (k * 0.618) % 1, speed: 0.22 + Math.max(0, Math.min(ratio, 2)) * 0.18, strength: intensity[i] };
    });
  }, [idx, value, intensity, cells]);

  // One clock drives every ring; it stops entirely under reduced motion or a hidden tab.
  const [t, setT] = useState(0.35);
  const raf = useRef(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const start = performance.now();
    const tick = (now: number) => {
      if (!document.hidden) setT((now - start) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 860;
  const trigger = `${lens}-${month}-${factor}`;
  const hex = useMemo(() => new H3HexagonLayer<number>({
    id: "field", data: idx, getHexagon: (i) => cells.h3[i], extruded: true, coverage: 0.9, pickable: true,
    elevationScale: 1, getElevation: (i) => elevation(intensity[i]),
    getFillColor: (i) => lens === "anomaly" ? diverging(value[i], 235) : thermal(Math.pow(intensity[i], 1.35), 60 + intensity[i] * 195),
    material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [255, 210, 160] },
    updateTriggers: { getElevation: trigger, getFillColor: trigger },
    transitions: reducedMotion() ? undefined : { getElevation: { duration: 450 }, getFillColor: { duration: 450 } },
  }), [idx, cells, intensity, value, lens, trigger]);

  const rings = [0, 0.5].map((offset) => new ScatterplotLayer<(typeof hot)[number]>({
    id: `ring-${offset}`, data: hot, stroked: true, filled: false, radiusUnits: "meters", lineWidthUnits: "pixels",
    getPosition: (d) => [centers[d.i][1], centers[d.i][0], elevation(intensity[d.i]) + 30], // float on top of the column
    getRadius: (d) => (((t * d.speed + d.phase + offset) % 1) * (500 + d.strength * 900)) + 40,
    getLineWidth: (d) => 1.6 + d.strength * 2.6,
    getLineColor: (d) => {
      const p = (t * d.speed + d.phase + offset) % 1;
      const c = lens === "anomaly" ? diverging(2, 255) : thermal(0.55 + d.strength * 0.45);
      return [c[0], c[1], c[2], Math.round(230 * Math.pow(1 - p, 1.7) * (0.45 + d.strength * 0.55))];
    },
    updateTriggers: { getRadius: t, getLineColor: [t, lens] }, pickable: false,
  }));

  const sel = selected === null ? [] : [new H3HexagonLayer<number>({
    id: "selected", data: [selected], getHexagon: (i) => cells.h3[i], extruded: false, filled: false, stroked: true,
    getLineColor: [255, 244, 214, 255], lineWidthUnits: "pixels", getLineWidth: 3,
  })];

  return (
    <DeckGL
      initialViewState={isMobile ? { ...VIEW, zoom: 9.4, pitch: 40 } : VIEW}
      controller={{ dragRotate: true, touchRotate: true }}
      layers={[hex, ...rings, ...sel]}
      onClick={(info) => onSelect(info.object === undefined || info.object === null ? null : (info.object as number))}
      getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      getTooltip={({ object }) => object === undefined || object === null ? null : {
        text: `${Math.round(cells.complaints[object as number] / cells.years)} complaints a year\nexpected ${Math.round(cells.oof[object as number] / cells.years)} from its surroundings\nclick for drivers`,
        style: { background: "#10152A", color: "#EEF0F7", border: "1px solid #26304D", borderRadius: "8px", fontFamily: "Schibsted Grotesk, sans-serif", fontSize: "12px", padding: "8px 10px" },
      }}
    >
      <Map mapStyle={STYLE} reuseMaps attributionControl={{ compact: true }} />
    </DeckGL>
  );
}
