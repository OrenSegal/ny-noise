// Build the Wake the city building tiles at deploy time: every NYC footprint with its roof height and residents,
// in ~1 km binary tiles under public/tiles/. Not committed; if NYC Open Data is down the build continues and the app
// falls back to live queries.
//
// Tile format (little endian): uint32 n, then per building: float32 people, uint16 height (dm), uint8 rings,
// per ring uint16 verts, then verts x (int16 dLon, int16 dLat) in micro-degrees from the tile's south-west corner.
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "tiles");
const FOOTPRINTS = "https://data.cityofnewyork.us/resource/5zhs-2jue.json";
const PLUTO = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
export const GRID = { lat0: 40.45, lon0: -74.3, dLat: 0.01, dLon: 0.013 };
const CENSUS_2020 = 8804190; // NYC population, 2020 Census: household size is scaled so the city adds up to it
const PAGE = 50000, PARALLEL = 4, MAX_AGE_DAYS = 6;

const fresh = async () => {
  try { return (Date.now() - (await stat(join(OUT, "index.json"))).mtimeMs) / 864e5 < MAX_AGE_DAYS; } catch { return false; }
};
const get = async (url, q, tries = 4) => {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`${url}?${new URLSearchParams(q)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * i));
    }
  }
};
const pages = async (url, q, total, onPage) => {
  const offsets = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i * PAGE);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < offsets.length) {
      const off = offsets[next++];
      onPage(await get(url, { ...q, $order: ":id", $limit: String(PAGE), $offset: String(off) }));
      process.stdout.write(".");
    }
  }));
};
const bblKey = (v) => (v == null ? "" : String(Math.round(parseFloat(v))));
const M_LAT = 110540, mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

async function build() {
  const t0 = Date.now();
  const [{ count: nLots }] = await get(PLUTO, { $select: "count(*)", $where: "unitsres>0" });
  const units = new Map();
  await pages(PLUTO, { $select: "bbl,unitsres", $where: "unitsres>0" }, +nLots, (rows) => {
    for (const r of rows) units.set(bblKey(r.bbl), (units.get(bblKey(r.bbl)) ?? 0) + +r.unitsres);
  });
  let homes = 0;
  for (const u of units.values()) homes += u;
  // shortcut: one citywide household size; ACS household size by tract would tighten local counts
  const PER_HOME = CENSUS_2020 / homes;
  console.log(`\n${units.size} residential lots, ${homes} homes, ${PER_HOME.toFixed(2)} people per home`);

  const [{ count: nFp }] = await get(FOOTPRINTS, { $select: "count(*)" });
  const tiles = new Map(), lotVol = new Map();
  await pages(FOOTPRINTS, { $select: "height_roof,mappluto_bbl,simplify_preserve_topology(the_geom,0.00001) as g" }, +nFp, (rows) => {
    for (const r of rows) {
      const g = r.g;
      if (!g?.coordinates) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      let cx = 0, cy = 0, n = 0, area = 0;
      for (const poly of polys) {
        const ring = poly[0], k = mLon(ring[0][1]);
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          area += (ring[j][0] * k + ring[i][0] * k) * (ring[j][1] - ring[i][1]) * M_LAT;
          cx += ring[i][0]; cy += ring[i][1]; n++;
        }
      }
      cx /= n; cy /= n;
      const ty = Math.floor((cy - GRID.lat0) / GRID.dLat), tx = Math.floor((cx - GRID.lon0) / GRID.dLon), key = `${ty}_${tx}`;
      const h = Math.max(3, (+r.height_roof || 30) * 0.3048), vol = Math.abs(area / 2) * h, lot = bblKey(r.mappluto_bbl);
      if (units.has(lot)) lotVol.set(lot, (lotVol.get(lot) ?? 0) + vol);
      const oLat = GRID.lat0 + ty * GRID.dLat, oLon = GRID.lon0 + tx * GRID.dLon;
      const rings = polys.flatMap((poly) => poly.map((ring) => Int16Array.from(ring.flatMap(([lon, lat]) => [Math.round((lon - oLon) * 1e6), Math.round((lat - oLat) * 1e6)]))));
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push({ h, vol, lot, rings });
    }
  });
  console.log(`\n${nFp} footprints in ${tiles.size} tiles`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  let bytes = 0, people = 0;
  for (const [key, list] of tiles) {
    let size = 4;
    for (const b of list) { size += 7; for (const r of b.rings) size += 2 + r.length * 2; }
    const buf = Buffer.alloc(size);
    let o = buf.writeUInt32LE(list.length, 0);
    for (const b of list) {
      const p = units.has(b.lot) ? (units.get(b.lot) * PER_HOME * b.vol) / lotVol.get(b.lot) : 0;
      people += p;
      o = buf.writeFloatLE(p, o);
      o = buf.writeUInt16LE(Math.min(65535, Math.round(b.h * 10)), o);
      o = buf.writeUInt8(Math.min(255, b.rings.length), o);
      for (const r of b.rings.slice(0, 255)) {
        o = buf.writeUInt16LE(r.length / 2, o);
        for (const v of r) o = buf.writeInt16LE(v, o);
      }
    }
    await writeFile(join(OUT, `${key}.bin`), buf.subarray(0, o));
    bytes += o;
  }
  await writeFile(join(OUT, "index.json"), JSON.stringify({ ...GRID, built: new Date().toISOString(), buildings: +nFp, perHome: +PER_HOME.toFixed(3), people: Math.round(people), tiles: [...tiles.keys()] }));
  console.log(`${(bytes / 1e6).toFixed(1)} MB, ~${Math.round(people).toLocaleString()} residents, ${((Date.now() - t0) / 1000).toFixed(0)} s, peak memory ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
}

if (process.env.SKIP_TILES) console.log("tiles: skipped (SKIP_TILES)");
else if (await fresh()) console.log("tiles: up to date");
else {
  try { await build(); } catch (e) {
    console.warn(`\ntiles: could not build (${e.message}); the app will query NYC Open Data live`);
  }
}
