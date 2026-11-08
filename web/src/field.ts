// Turn ~65 m grid values into a smooth raster image: a true heat field, not dots or hexes.
import { thermal } from "./data";

const PX_LAT = 0.00045, PX_LON = 0.0006; // ~50 m pixels at NYC's latitude
const LEVEL = { ratio: { lo: 0.05, hi: 3 }, db: { lo: 28, hi: 50 } }; // 30 m / d at 600 m and at the 10 m floor; relative dB

export type Field = { image: HTMLCanvasElement; bounds: [number, number, number, number] };

/**
 * "level": a weighted mean of nearby grid values (exposure is a level, so dense areas are not hotter for having more points).
 * "density": a kernel-smoothed count (complaints), on a scale fixed from the whole city so panning never re-colours it.
 * dB is already logarithmic and is mapped linearly. Other levels are coloured on a log scale, as loudness is heard; densities on a square-root scale so hotspots stand out.
 */
export function rasterize(lat: number[], lon: number[], w: ArrayLike<number>, kind: "ratio" | "db" | "density"): Field {
  const mode = kind === "density" ? "density" : "level";
  const R = mode === "level" ? 2 : 3, SIGMA = mode === "level" ? 1.2 : 1.6; // pixels (~60 / ~80 m)
  let s = Infinity, n = -Infinity, west = Infinity, e = -Infinity;
  for (let i = 0; i < lat.length; i++) {
    s = Math.min(s, lat[i]); n = Math.max(n, lat[i]); west = Math.min(west, lon[i]); e = Math.max(e, lon[i]);
  }
  s -= PX_LAT * (R + 1); n += PX_LAT * (R + 1); west -= PX_LON * (R + 1); e += PX_LON * (R + 1);
  const W = Math.ceil((e - west) / PX_LON), H = Math.ceil((n - s) / PX_LAT);
  const sum = new Float32Array(W * H), wt = new Float32Array(W * H);
  const k: number[] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) k.push(Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)));
  const ksum = k.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lat.length; i++) {
    if (mode === "density" && !(w[i] > 0)) continue;
    const cx = Math.round((lon[i] - west) / PX_LON), cy = Math.round((n - lat[i]) / PX_LAT);
    let j = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++, j++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      sum[y * W + x] += k[j] * w[i]; wt[y * W + x] += k[j];
    }
  }
  const val = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) val[p] = mode === "level" ? (wt[p] >= 0.05 ? sum[p] / wt[p] : 0) : sum[p] / ksum;
  let { lo, hi } = kind === "density" ? LEVEL.ratio : LEVEL[kind];
  if (mode === "density") {
    const nz = Array.from(val.filter((v) => v > 0.01)).sort((a, b) => a - b);
    hi = nz[Math.floor(nz.length * 0.995)] ?? 1;
  }
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (let p = 0; p < W * H; p++) {
    const t = !(val[p] > 0) ? -1 : kind === "db" ? (val[p] - lo) / (hi - lo) : mode === "level" ? Math.log(val[p] / lo) / Math.log(hi / lo) : Math.sqrt(val[p] / hi) - 0.08;
    if (t <= -0.3) continue;
    const u = Math.max(0, Math.min(1, t));
    const c = thermal(0.1 + u * 0.9);
    const fade = mode === "level" ? Math.min(1, wt[p] / 0.6) : 1; // soft edge where the level grid ends
    const a = t < 0 ? (t + 0.3) / 0.3 * 50 : 50 + 200 * Math.min(1, u * 2.5); // low values fade out instead of cutting off
    img.data.set([c[0], c[1], c[2], Math.round(fade * a)], p * 4);
  }
  ctx.putImageData(img, 0, 0);
  return { image: canvas, bounds: [west, s, e, n] };
}
