import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
// MapLibre 6 loads its worker by URL; let Vite bundle it so the built site serves a real script.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useMemo } from "react";
import { BitmapLayer } from "@deck.gl/layers";
import type { Cells } from "./data";
import { rasterize } from "./field";
import type { Classed } from "./lens";

setWorkerUrl(workerUrl);

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";
export type View = { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number };
export const HOME: View = { longitude: -73.94, latitude: 40.70, zoom: 10.1, pitch: 0, bearing: 0 };

/** `level` points are a regular grid of an intensive value (exposure), averaged; others are counts, smoothed as a density. */
export type HeatPoints = { lat: number[]; lon: number[]; w: ArrayLike<number>; level?: boolean } | null;

/** Flat classed hex map. Colour is the class; a picked class dims the rest so its blocks stand out. */
export default function MapView({ cells, classed, activeClass, selected, onSelect, view, setView, tooltip, heat }: {
  cells: Cells; classed: Classed; activeClass: number | null; selected: number | null; onSelect: (i: number | null) => void;
  view: View; setView: (v: View) => void; tooltip: (i: number) => string; heat: HeatPoints;
}) {
  // On the stacked mobile layout the canvases can initialise at 300x150 before the stage has its height; re-measure.
  useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 300); return () => clearTimeout(t); }, []);
  const idx = useMemo(() => cells.h3.map((_, i) => i), [cells]);
  const hex = new H3HexagonLayer<number>({
    id: "cells", data: idx, getHexagon: (i) => cells.h3[i], extruded: false, coverage: 1, pickable: true,
    stroked: true, lineWidthUnits: "pixels", getLineWidth: 0.6,
    getFillColor: (i) => {
      if (heat) return [0, 0, 0, 0]; // heat mode: blocks stay clickable but invisible
      const c = classed.cls[i];
      const [r, g, b] = classed.colors[c];
      return [r, g, b, activeClass === null || activeClass === c ? 235 : 28];
    },
    getLineColor: heat ? [0, 0, 0, 0] : [7, 9, 15, 200],
    updateTriggers: { getFillColor: [classed, activeClass, heat], getLineColor: [heat] },
  });
  // Heat is rasterised once per layer to a smoothed ~50 m image; the GPU interpolates it at any zoom.
  const raster = useMemo(() => (heat ? rasterize(heat.lat, heat.lon, heat.w, heat.level ? "level" : "density") : null), [heat]);
  const field = raster ? [new BitmapLayer({ id: "field", image: raster.image, bounds: raster.bounds })] : [];
  const sel = selected === null ? [] : [new H3HexagonLayer<number>({
    id: "selected", data: [selected], getHexagon: (i) => cells.h3[i], filled: false, stroked: true,
    getLineColor: [255, 244, 214, 255], lineWidthUnits: "pixels", getLineWidth: 3,
  })];

  return (
    <DeckGL
      viewState={view}
      onViewStateChange={({ viewState }) => setView(viewState as View)}
      controller={{ dragRotate: false, touchRotate: false, keyboard: true }}
      layers={[...field, hex, ...sel]}
      onClick={(info) => onSelect(info.object === undefined || info.object === null ? null : (info.object as number))}
      getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      getTooltip={({ object }) => object === undefined || object === null ? null : {
        text: tooltip(object as number),
        style: { background: "#10152A", color: "#EEF0F7", border: "1px solid #26304D", borderRadius: "8px", fontFamily: "Schibsted Grotesk, sans-serif", fontSize: "12px", padding: "8px 10px", lineHeight: "1.45" },
      }}
    >
      <Map mapStyle={STYLE} reuseMaps attributionControl={{ compact: true }} onLoad={(e) => e.target.resize()} />
    </DeckGL>
  );
}
