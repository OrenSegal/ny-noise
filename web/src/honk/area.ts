// Buildings (footprints + roof heights) and residents around a point. Prebuilt tiles first (scripts/build-tiles.mjs);
// if the deploy has none, live from NYC Open Data.
import { type Area, type Bldg, HALF, anchor, M_PER_LAT, PX, RANGE, fillPolygon, toGrid } from "./physics";

const FOOTPRINTS = "https://data.cityofnewyork.us/resource/5zhs-2jue.json";
const PLUTO = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
const PER_HOME = 2.36; // live fallback only: the tile build scales homes to the 2020 Census total (8,804,190), which gives ~2.36
const LIMIT = 20000;
const floorsOf = (h: number) => Math.max(1, Math.round(h / 3.1));

type Index = { lat0: number; lon0: number; dLat: number; dLon: number; tiles: string[] };
type TB = { people: number; h: number; rings: [number, number][][] }; // rings in lon/lat
let index: Promise<(Index & { keys: Set<string> }) | null> | null = null;
const tiles = new Map<string, Promise<TB[]>>();

const getIndex = () => (index ??= fetch(`/tiles/index.json?v=${__DATA_V__}`)
  .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
  .then((j: Index | null) => (j ? { ...j, keys: new Set(j.tiles) } : null))
  .catch(() => null));

/** Parse one tile (format in scripts/build-tiles.mjs). */
export function parseTile(buf: ArrayBuffer, oLat: number, oLon: number): TB[] {
  const v = new DataView(buf), out: TB[] = [];
  let o = 4;
  for (let n = v.getUint32(0, true); n > 0; n--) {
    const people = v.getFloat32(o, true), h = v.getUint16(o + 4, true) / 10, nr = v.getUint8(o + 6);
    o += 7;
    const rings: [number, number][][] = [];
    for (let k = 0; k < nr; k++) {
      const nv = v.getUint16(o, true); o += 2;
      const ring: [number, number][] = [];
      for (let j = 0; j < nv; j++, o += 4) ring.push([oLon + v.getInt16(o, true) / 1e6, oLat + v.getInt16(o + 2, true) / 1e6]);
      rings.push(ring);
    }
    out.push({ people, h, rings });
  }
  return out;
}

const blank = (lat0: number, lon0: number): Area => {
  const W = (2 * HALF) / PX;
  return { lat0, lon0, W, h: new Float32Array(W * W), bid: new Int32Array(W * W).fill(-1), b: [] };
};
const add = (a: Area, rings: [number, number][][], h: number, people: number) => {
  const id = a.b.length;
  fillPolygon(a, rings.map((r) => r.map(([lon, lat]) => toGrid(a, lat, lon) as unknown as [number, number])), h, id);
  a.b.push({ people, floors: floorsOf(h), h } as Bldg);
};

async function fromTiles(ix: Index & { keys: Set<string> }, lat0: number, lon0: number): Promise<Area> {
  const pad = HALF + 120, dLat = pad / M_PER_LAT, dLon = pad / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const keys: string[] = [];
  for (let ty = Math.floor((lat0 - dLat - ix.lat0) / ix.dLat); ty <= Math.floor((lat0 + dLat - ix.lat0) / ix.dLat); ty++)
    for (let tx = Math.floor((lon0 - dLon - ix.lon0) / ix.dLon); tx <= Math.floor((lon0 + dLon - ix.lon0) / ix.dLon); tx++) {
      const k = `${ty}_${tx}`;
      if (!ix.keys.has(k)) continue;
      keys.push(k);
      if (!tiles.has(k)) tiles.set(k, fetch(`/tiles/${k}.bin?v=${__DATA_V__}`).then((r) => {
        if (!r.ok) throw new Error(`tile ${k}: ${r.status}`);
        return r.arrayBuffer();
      }).then((buf) => parseTile(buf, ix.lat0 + ty * ix.dLat, ix.lon0 + tx * ix.dLon))
        .catch((e) => { tiles.delete(k); throw e; })); // a failed tile is retried on the next honk
    }
  const a = blank(lat0, lon0);
  for (const list of await Promise.all(keys.map((k) => tiles.get(k)!))) for (const b of list) add(a, b.rings, b.h, b.people);
  return a;
}

const soda = async (url: string, q: Record<string, string>) => {
  const r = await fetch(`${url}?${new URLSearchParams({ ...q, $limit: String(LIMIT) })}`);
  if (!r.ok) throw new Error(`NYC Open Data answered ${r.status}`);
  return (await r.json()) as Record<string, any>[];
};
const bblKey = (v: unknown) => (v == null ? "" : String(Math.round(parseFloat(String(v)))));

async function live(lat0: number, lon0: number): Promise<Area> {
  const dLat = HALF / M_PER_LAT, dLon = HALF / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const [fp, lots] = await Promise.all([
    soda(FOOTPRINTS, { $select: "height_roof,mappluto_bbl,the_geom", $where: `within_circle(the_geom,${lat0},${lon0},${Math.round(HALF * 1.05)})` }),
    soda(PLUTO, { $select: "bbl,unitsres", $where: `unitsres>0 AND latitude between ${lat0 - dLat * 1.3} and ${lat0 + dLat * 1.3} AND longitude between ${lon0 - dLon * 1.3} and ${lon0 + dLon * 1.3}` }),
  ]);
  const units = new Map<string, number>();
  for (const l of lots) units.set(bblKey(l.bbl), (units.get(bblKey(l.bbl)) ?? 0) + +l.unitsres);
  // Each lot's homes are split across its buildings by volume (footprint x height).
  const list: { rings: [number, number][][]; h: number; vol: number; lot: string }[] = [];
  for (const f of fp) {
    const g = f.the_geom;
    if (!g?.coordinates) continue;
    const h = Math.max(3, (+f.height_roof || 30) * 0.3048), k = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const polys: [number, number][][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let area = 0;
    for (const poly of polys) for (let i = 0, j = poly[0].length - 1; i < poly[0].length; j = i++)
      area += (poly[0][j][0] + poly[0][i][0]) * k * (poly[0][j][1] - poly[0][i][1]) * M_PER_LAT;
    list.push({ rings: polys.flat(), h, vol: Math.abs(area / 2) * h, lot: bblKey(f.mappluto_bbl) });
  }
  const lotVol = new Map<string, number>();
  for (const b of list) if (units.has(b.lot)) lotVol.set(b.lot, (lotVol.get(b.lot) ?? 0) + b.vol);
  const a = blank(lat0, lon0);
  for (const b of list) add(a, b.rings, b.h, units.has(b.lot) ? (units.get(b.lot)! * PER_HOME * b.vol) / lotVol.get(b.lot)! : 0);
  if (fp.length >= LIMIT || lots.length >= LIMIT) console.warn("NYC Open Data hit the row limit; some buildings are missing");
  return a;
}

export async function loadArea(lat: number, lon: number): Promise<Area> {
  const { lat0, lon0 } = anchor(lat, lon), ix = await getIndex();
  if (ix) { try { return await fromTiles(ix, lat0, lon0); } catch (e) { console.warn("tiles failed, querying live", e); } }
  return live(lat0, lon0);
}

/** Reuse a loaded area while the source stays far enough inside it for the whole RANGE disc. */
export const covers = (a: Area, lat: number, lon: number) => {
  const [x, y] = toGrid(a, lat, lon), m = (HALF - RANGE) / PX, W = a.W;
  return x >= m && y >= m && x <= W - m && y <= W - m;
};
