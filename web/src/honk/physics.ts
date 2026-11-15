// Sound from one stationary source at 3 a.m., through real buildings, into bedrooms, into people woken.
// Pure: no DOM, no network. area.ts fills an Area from prebuilt tiles or NYC Open Data; worker.ts runs it off the main thread.

export const PX = 4; // grid metres
export const HALF = 760; // grid half-width, metres
export const RANGE = 600; // field radius around the source, metres
export const SPEED = 343; // m/s, drives the reveal

export type Bldg = { people: number; floors: number; h: number };
/** Height grid (m, 0 = open) and building index grid (-1 = open), PX metres per cell, centred on lat0/lon0. */
export type Area = { lat0: number; lon0: number; W: number; h: Float32Array; bid: Int32Array; b: Bldg[] };
/** db: dB(A) at 7 m. dur: seconds. hs: source height m. lam: wavelength m (barriers). air: dB per m. */
export type Src = { db: number; dur: number; hs: number; lam: number; air: number };
export type Hit = { b: number; d: number; woke: number; reacted: number; at: number };
export type Windows = "open" | "tilted" | "closed";
/** Expected counts under the quiet-leaning, middle and loud-leaning calibration (see CAL). */
export type Range = { lo: number; mid: number; hi: number };
export type Result = { sx: number; sy: number; field: Float32Array; hits: Hit[]; woke: Range; reacted: Range; over: Record<number, number> };

// One fixed 4 m lattice for the whole city: any two areas put a block on the same pixels, so a shared honk replays exactly.
// A single east-west scale (at 40.7°N) is off by under 0.4% at the city's north and south edges.
const M_PER_LON = 111320 * Math.cos((40.7 * Math.PI) / 180);
export const anchor = (lat: number, lon: number) => ({
  lat0: 40.7 + (Math.round(((lat - 40.7) * M_PER_LAT) / PX) * PX) / M_PER_LAT,
  lon0: -74 + (Math.round(((lon + 74) * M_PER_LON) / PX) * PX) / M_PER_LON,
});
export const M_PER_LAT = 110540;
export const toGrid = (a: { lat0: number; lon0: number }, lat: number, lon: number) =>
  [((lon - a.lon0) * M_PER_LON + HALF) / PX, (HALF - (lat - a.lat0) * M_PER_LAT) / PX] as const;
export const fromGrid = (a: { lat0: number; lon0: number }, x: number, y: number) =>
  ({ lat: a.lat0 + (HALF - (y + 0.5) * PX) / M_PER_LAT, lon: a.lon0 + ((x + 0.5) * PX - HALF) / M_PER_LON });
export const bounds = (a: { lat0: number; lon0: number }): [number, number, number, number] => {
  const dl = HALF / M_PER_LON, dp = HALF / M_PER_LAT;
  return [a.lon0 - dl, a.lat0 - dp, a.lon0 + dl, a.lat0 + dp];
};

/** Even-odd scanline fill of one polygon (outer ring + holes), already in grid units. Taller building wins overlaps. */
export function fillPolygon(a: Area, rings: [number, number][][], height: number, id: number) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(a.W - 1, Math.ceil(y1)); y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xa, ya] = r[i], [xb, yb] = r[j];
      if ((ya > yc) !== (yb > yc)) xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(a.W - 1, Math.floor(xs[k + 1] - 0.5)); x++) {
        const p = y * a.W + x;
        if (height > a.h[p]) { a.h[p] = height; a.bid[p] = id; }
      }
  }
}

/** Basner et al. (2006) probability of waking from one event, from the indoor maximum level. 0 below 33 dB, ~6% at 60, ~10% at 73. */
export const pWake = (L: number) => (L < 33 ? 0 : Math.min(1, Math.max(0, 1.894e-3 * L * L + 4.008e-2 * L - 3.3243) / 100));
/** Under a second counts quieter than its peak; each doubling past a second adds 1.5 dB, up to 8 s. */
export const durationDb = (s: number) => (s < 1 ? 10 * Math.log10(Math.max(s, 0.05)) : 1.5 * Math.log2(Math.min(s, 8)));
/**
 * Calibration, each as [quiet-leaning, middle, loud-leaning]; the counter shows the spread.
 * win: outdoor-indoor difference, measured medians and quartiles from 102 Swiss homes (Locher et al. 2018, Table 2).
 * rear: back rooms vs the loud façade. 10 dB is the usual "quiet side" threshold in the literature; 20 is our upper guess.
 * canyon: extra loss per metre of detour down a side street, on top of spreading. An assumption, set so the total along a
 *   side street (with spreading) lands near the 20-30 dB per 100 m a computed, scale-model-checked canyon study reports.
 */
export const CAL = {
  win: { open: [11.5, 10.0, 8.1], tilted: [17.2, 15.8, 14.0], closed: [30.8, 27.8, 25.4] },
  rear: [20, 15, 10],
  canyon: [0.20, 0.15, 0.10],
} as const;
const CORNER = 4.8; // Maekawa at grazing incidence, 10 log10(3): the drop on first losing line of sight round a corner
const PEOPLE_AWAKE_FLOOR = 32; // WHO: the body reacts in sleep above 32 dB indoors

const free = (s: Src, d: number) => s.db - 20 * Math.log10(Math.max(d, 1) / 7) - s.air * d;
/** Maekawa single-edge barrier from the path difference, capped at 25 dB for thick city blocks. */
const barrier = (delta: number, lam: number) => (delta <= 0 ? 0 : Math.min(25, 10 * Math.log10(3 + (40 * delta) / lam)));
/** Extra loss for the street-channel path: a corner drop, then a steady decay per metre of detour, capped like a barrier. */
// shortcut: detour length stands in for distance along the side canyon; a ray-traced reflection model would replace it
const bend = (excess: number, perM: number) => (excess <= 0 ? 0 : Math.min(25, CORNER * (1 - Math.exp(-excess / 4)) + perM * excess));

/** Largest path difference over any building between source (sx,sy,hs) and receiver (tx,ty,hr), grid units; `own` is ignored. */
function delta(a: Area, sx: number, sy: number, hs: number, tx: number, ty: number, hr: number, own: number) {
  const D = Math.hypot(tx - sx, ty - sy) * PX, n = Math.ceil(D / PX);
  let best = 0;
  for (let k = 1; k < n; k++) {
    const f = k / n, p = Math.floor(sy + (ty - sy) * f) * a.W + Math.floor(sx + (tx - sx) * f);
    const h = a.h[p];
    if (h <= 0 || a.bid[p] === own) continue;
    const line = hs + (hr - hs) * f;
    if (h <= line) continue;
    const x = D * f;
    best = Math.max(best, Math.hypot(x, h - hs) + Math.hypot(D - x, h - hr) - Math.hypot(D, hr - hs));
  }
  return best;
}

/** Shortest walk through open pixels from the source (the street channel), in metres; Infinity where unreachable. */
function streetPaths(a: Area, s0: number, r: number) {
  const W = a.W, dist = new Float64Array(W * W).fill(Infinity), cx = s0 % W, cy = (s0 / W) | 0;
  const heap: number[] = [], key: number[] = [];
  const push = (p: number, d: number) => {
    let i = heap.length; heap.push(p); key.push(d);
    while (i > 0) { const j = (i - 1) >> 1; if (key[j] <= key[i]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; [key[i], key[j]] = [key[j], key[i]]; i = j; }
  };
  const pop = () => {
    const p = heap[0], d = key[0], lp = heap.pop()!, lk = key.pop()!;
    if (heap.length) {
      heap[0] = lp; key[0] = lk;
      for (let i = 0; ;) {
        const l = 2 * i + 1, rr = l + 1; let m = i;
        if (l < heap.length && key[l] < key[m]) m = l;
        if (rr < heap.length && key[rr] < key[m]) m = rr;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; [key[i], key[m]] = [key[m], key[i]]; i = m;
      }
    }
    return [p, d] as const;
  };
  dist[s0] = 0; push(s0, 0);
  const R2 = (r / PX) ** 2, D2 = PX * Math.SQRT2;
  while (heap.length) {
    const [p, d] = pop();
    if (d > dist[p]) continue;
    const x = p % W, y = (p / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W || (nx - cx) ** 2 + (ny - cy) ** 2 > R2) continue;
      const q = ny * W + nx;
      if (a.h[q] > 0) continue;
      const nd = d + (dx && dy ? D2 : PX);
      if (nd < dist[q]) { dist[q] = nd; push(q, nd); }
    }
  }
  return dist;
}

/** Size of the open region around p, counted up to `cap` pixels; marks what it visits in `seen`. */
function openRegion(a: Area, p: number, cap: number, seen: Uint8Array) {
  const W = a.W, stack = [p];
  let n = 0;
  seen[p] = 1;
  while (stack.length && n < cap) {
    const q = stack.pop()!, x = q % W, y = (q / W) | 0;
    n++;
    for (const r of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < W - 1 ? q + W : -1])
      if (r >= 0 && !seen[r] && a.h[r] <= 0) { seen[r] = 1; stack.push(r); }
  }
  return n;
}
const STREET = 4000; // open pixels (~6.4 ha) a region needs to count as the street network rather than a backyard

/** Nearest open pixel on the street network to (x,y), within ~160 m: a click on a roof or into a courtyard honks from the street. */
function snapOpen(a: Area, x: number, y: number) {
  const W = a.W, x0 = Math.floor(x), y0 = Math.floor(y), seen = new Uint8Array(W * W);
  for (let r = 0; r <= 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const px = x0 + dx, py = y0 + dy, p = py * W + px;
    if (px < 0 || py < 0 || px >= W || py >= W || a.h[p] > 0 || seen[p]) continue;
    if (openRegion(a, p, STREET, seen) >= STREET) return [px, py] as const;
  }
  return [x0, y0] as const;
}

/**
 * Level at every street pixel (1.5 m) within RANGE, then at each façade floor of every building, then people woken.
 * Two paths, the louder wins: the direct line over the roofs, and the walk down the streets (stands in for reflections and corners).
 * Taking the max rather than adding energy keeps open streets from gaining a flat 3 dB.
 */
export function simulate(a: Area, s: Src, gx: number, gy: number, windows: Windows): Result {
  const W = a.W, [sx, sy] = s.hs > 20 ? [Math.floor(gx), Math.floor(gy)] as const : snapOpen(a, gx, gy);
  const s0 = sy * W + sx, path = streetPaths(a, s0, RANGE + 40);
  const field = new Float32Array(W * W).fill(NaN);
  const R = RANGE / PX, hr = 1.5;
  for (let y = Math.max(0, sy - R); y < Math.min(W, sy + R); y++) for (let x = Math.max(0, sx - R); x < Math.min(W, sx + R); x++) {
    const p = y * W + x, D = Math.hypot(x - sx, y - sy) * PX;
    if (D > RANGE || a.h[p] > 0) continue;
    const d3 = Math.hypot(D, s.hs - hr);
    let L = free(s, d3) - barrier(delta(a, sx + 0.5, sy + 0.5, s.hs, x + 0.5, y + 0.5, hr, -2), s.lam);
    if (path[p] < Infinity) { const pl = Math.hypot(path[p], s.hs - hr); L = Math.max(L, free(s, pl) - bend(pl - d3, CAL.canyon[1])); }
    field[p] = L;
  }

  // The loud façade of each building: its pixel with the loudest open neighbour.
  const face = new Map<number, { p: number; L: number; q: number }>();
  for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x, bi = a.bid[p];
    if (bi < 0 || !(a.b[bi].people > 0)) continue;
    for (const q of [p - 1, p + 1, p - W, p + W]) {
      const L = field[q];
      if (L === L && (!face.has(bi) || L > face.get(bi)!.L)) face.set(bi, { p, L, q });
    }
  }
  // Per floor: the over-the-roof level and the street-path length once; each calibration then only re-weighs them.
  const dur = durationDb(s.dur), hits: Hit[] = [];
  const woke = [0, 0, 0], reacted = [0, 0, 0];
  for (const [bi, f] of face) {
    const b = a.b[bi], x = f.p % W, y = (f.p / W) | 0, D = Math.hypot(x - sx, y - sy) * PX, per = b.people / b.floors;
    const w = [0, 0, 0], r = [0, 0, 0];
    for (let k = 0; k < b.floors; k++) {
      const h = 3 * k + 1.5, d3 = Math.hypot(D, s.hs - h);
      const direct = free(s, d3) - barrier(delta(a, sx + 0.5, sy + 0.5, s.hs, x + 0.5, y + 0.5, h, bi), s.lam);
      const pl = path[f.q] < Infinity ? Math.hypot(path[f.q], s.hs - h) : Infinity;
      for (let c = 0; c < 3; c++) {
        const L = pl < Infinity ? Math.max(direct, free(s, pl) - bend(pl - d3, CAL.canyon[c])) : direct;
        const front = L - CAL.win[windows][c] + dur, rear = front - CAL.rear[c];
        w[c] += per * 0.5 * (pWake(front) + pWake(rear));
        r[c] += per * 0.5 * ((front > PEOPLE_AWAKE_FLOOR ? 1 : 0) + (rear > PEOPLE_AWAKE_FLOOR ? 1 : 0));
      }
    }
    if (r[2] > 0) { hits.push({ b: bi, d: D, woke: w[1], reacted: r[1], at: f.p }); for (let c = 0; c < 3; c++) { woke[c] += w[c]; reacted[c] += r[c]; } }
  }
  hits.sort((p, q) => p.d - q.d);
  const over: Record<number, number> = {};
  for (const db of [58, 62, 72]) { let n = 0; for (let i = 0; i < field.length; i++) if (field[i] >= db) n++; over[db] = n * PX * PX; }
  const rng = (v: number[]): Range => ({ lo: v[0], mid: v[1], hi: v[2] });
  return { sx, sy, field, hits, woke: rng(woke), reacted: rng(reacted), over };
}

/** Dev self-check: free field loses 6 dB per doubling, a block in the way lowers both the level and the count, and the wake curve hits its anchors. */
export function selfCheck() {
  const s: Src = { db: 94, dur: 1, hs: 1, lam: 0.7, air: 0 };
  console.assert(Math.abs(free(s, 14) - free(s, 28) - 6.02) < 0.01, "6 dB per doubling");
  console.assert(Math.abs(pWake(60) - 0.059) < 0.005 && Math.abs(pWake(73) - 0.097) < 0.005 && pWake(32) === 0, "Basner anchors");
  const W = (2 * HALF) / PX, mk = (): Area => ({ lat0: 40.7, lon0: -74, W, h: new Float32Array(W * W), bid: new Int32Array(W * W).fill(-1), b: [{ people: 100, floors: 4, h: 12 }, { people: 0, floors: 1, h: 30 }] });
  const open = mk(), walled = mk(), c = W / 2;
  const home: [number, number][][] = [[[c + 30, c - 5], [c + 40, c - 5], [c + 40, c + 5], [c + 30, c + 5]]];
  fillPolygon(open, home, 12, 0); fillPolygon(walled, home, 12, 0);
  fillPolygon(walled, [[[c + 10, c - 60], [c + 20, c - 60], [c + 20, c + 60], [c + 10, c + 60]]], 30, 1);
  const a = simulate(open, s, c, c, "open"), b = simulate(walled, s, c, c, "open");
  console.assert(b.woke.mid < a.woke.mid && b.woke.mid >= 0, "a building in the way wakes fewer", a.woke, b.woke);
  console.assert(a.woke.lo <= a.woke.mid && a.woke.mid <= a.woke.hi, "the range brackets the middle", a.woke);
  const heli = simulate(open, { ...s, db: 108, hs: 150 }, c, c, "open").field[c * W + c];
  console.assert(Math.abs(heli - (108 - 20 * Math.log10(148.5 / 7))) < 1, "an elevated source is heard from its height", heli);
}
