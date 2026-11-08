"""Urban noise drivers on an H3 hex grid (resolution 9, ~174 m edge).

Run `python -m nynoise.factors` after `python -m nynoise.data`. Writes data/cells.csv.gz:
one row per hex cell with complaint counts over the last 104 weeks and ~20 measured
features of the built environment around the cell centre.

Sources (each cached under data/raw/factors/, re-used on re-runs):
  311 noise complaints (already in data/raw/), NYC DOB after-hours construction variances,
  NY State Liquor Authority active licences, NYC DOT truck routes, NYC PLUTO tax lots,
  OpenStreetMap via Overpass (roads, rail, stations, heliports, stadiums, venues,
  fire stations, hospitals, parks). Distances are in feet in EPSG:2263 (NY Long Island).
Needs the dev extras: geopandas, shapely, pyproj, h3, requests.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import h3
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree

from nynoise import data as nd

RAW = nd.DATA_DIR / "raw" / "factors"
RES = 9
WINDOW_WEEKS = 104
R_NEAR = 1000.0  # feet (~300 m): "within a short walk", used for roads, rail and permits
# Venue exposure at homes: inverse-square fall-off of sound with a 30 m reference distance.
D0_FT, DMIN_FT, DMAX_FT = 98.4, 32.8, 492.1  # 30 m reference, 10 m floor, ignore beyond 150 m
BBOX = (40.477, -74.259, 40.918, -73.700)  # south, west, north, east
NYC_COUNTIES = ("New York", "Kings", "Queens", "Bronx", "Richmond")
TO_FT = Transformer.from_crs("EPSG:4326", "EPSG:2263", always_xy=True)
AIRPORTS = {"lga": (40.7769, -73.8740), "jfk": (40.6413, -73.7781), "ewr": (40.6895, -74.1745)}

SLA_GROUPS = {
    "bars": ["Additional Bar", "Club", "Cabaret", "Night Club", "Bottle Club", "For-profit Club",
             "Food & Beverage Business", "Summer Food & beverage business", "Winter Food & Beverage Business",
             "Additional Bar-Seasonal", "Concert Hall"],
    "restaurants": ["Restaurant", "Summer Restaurant", "Restaurant Brewer", "Catering Establishment", "Hotel"],
    "venues": ["Legitimate theatre", "Legitimate Theatre", "Additional bar- legitimate theater",
               "Additional bar- ball park, race track, etc", "Athletic/Sporting Event/Expositions/Large Gathering Venue",
               "Outdoor Athletic Fields and Stadiums"],
    "off_premises": ["Grocery Store", "Liquor Store", "Drug Store", "Wine Store"],
}
TYPE_GROUPS = {"Noise - Residential": "residential", "Noise - Street/Sidewalk": "street",
               "Noise - Vehicle": "vehicle", "Noise - Commercial": "commercial", "Noise - Helicopter": "helicopter",
               "Noise - Park": "park", "Noise - House of Worship": "other", "Noise": "other"}


# ------------------------------------------------------------------ fetching (cached)
def _cached_json(name: str, fetch) -> object:
    RAW.mkdir(parents=True, exist_ok=True)
    f = RAW / f"{name}.json"
    if f.exists():
        return json.loads(f.read_text())
    out = fetch()
    f.write_text(json.dumps(out))
    return out


def _socrata(url: str, params: dict, page: int = 25_000) -> list[dict]:
    import requests

    rows, offset = [], 0
    while True:
        r = None
        for i in range(6):
            try:
                r = requests.get(url, params={**params, "$limit": page, "$offset": offset}, timeout=180,
                                 headers={"User-Agent": "ny-noise-research"})
                if r.status_code == 200:
                    break
            except (requests.Timeout, requests.ConnectionError):
                pass
            time.sleep(5 * 2 ** i)
        if r is None:
            raise RuntimeError(f"{url} unreachable; re-run to resume from cache")
        r.raise_for_status()
        batch = r.json()
        rows += batch
        if len(batch) < page:
            return rows
        offset += page


def _overpass(body: str) -> dict:
    import requests

    s, w, n, e = BBOX
    q = f"[out:json][timeout:180][bbox:{s},{w},{n},{e}];({body});out geom tags;"
    for i in range(6):
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=300,
                          headers={"User-Agent": "ny-noise-research/0.1"})
        if r.status_code == 200:
            return r.json()
        time.sleep(10 * 2 ** i)
    r.raise_for_status()


def fetch_all(since: str) -> dict:
    nyc = "data.cityofnewyork.us/resource"
    counties = ",".join(f"'{c}'" for c in NYC_COUNTIES)
    return {
        "ahv": _cached_json("ahv", lambda: _socrata(f"https://{nyc}/g76y-dcqj.json", {
            "$select": "latitude,longitude,count(*) as n",  # one row per building, n = permits in window
            "$where": f"variance_start_date_time >= '{since}T00:00:00' AND latitude IS NOT NULL",
            "$group": "latitude,longitude", "$order": "latitude,longitude"})),
        "sla": _cached_json("sla", lambda: _socrata("https://data.ny.gov/resource/9s3h-dpkz.json", {
            "$select": "description,georeference", "$where": f"premisescounty in({counties})", "$order": "licensepermitid"})),
        "truck": _cached_json("truck", lambda: _socrata(f"https://{nyc}/jjja-shxy.json", {
            "$select": "the_geom,routetype", "$order": "objectid_1"})),
        "pluto": _cached_json("pluto", lambda: _socrata(f"https://{nyc}/64uk-42ks.json", {
            "$select": "latitude,longitude,unitsres,comarea,retailarea,numfloors",
            "$where": "latitude IS NOT NULL", "$order": "bbl"})),
        "roads": _cached_json("osm_roads", lambda: _overpass('way["highway"~"^(motorway|trunk|primary|secondary)$"];')),
        "rail": _cached_json("osm_rail", lambda: _overpass('way["railway"~"^(rail|subway|light_rail)$"];')),
        "points": _cached_json("osm_points", lambda: _overpass(
            'nwr["aeroway"="heliport"];nwr["leisure"="stadium"];nwr["amenity"~"^(nightclub|music_venue|fire_station|hospital)$"];'
            'node["railway"="station"];node["station"="subway"];')),
        "parks": _cached_json("osm_parks", lambda: _overpass('way["leisure"="park"];relation["leisure"="park"];')),
    }


# ------------------------------------------------------------------ geometry helpers
def to_ft(lat, lon) -> np.ndarray:
    x, y = TO_FT.transform(np.asarray(lon, float), np.asarray(lat, float))
    return np.column_stack([x, y])


def osm_lines(elements: list[dict], keep=lambda tags: True) -> np.ndarray:
    """OSM ways (out geom) -> projected shapely LineStrings."""
    out = []
    for el in elements:
        if el.get("type") == "way" and len(el.get("geometry", [])) >= 2 and keep(el.get("tags", {})):
            g = el["geometry"]
            out.append(shapely.LineString(to_ft([p["lat"] for p in g], [p["lon"] for p in g])))
    return np.array(out, dtype=object)


INDOOR_WORDS = ("garden", "arena", "center", "centre")


def major_venues(elements: list[dict], indoor: bool, min_area_m2: float = 15_000) -> np.ndarray:
    """Large OSM stadium footprints, split into open-air stadiums and indoor arenas.

    OSM tags MSG and Barclays Center as leisure=stadium; they are roofed, so their noise is crowds
    and traffic at the doors, not the event. Small school fields tagged 'stadium' are dropped by size.
    """
    lat, lon = [], []
    for el in elements:
        t, b = el.get("tags", {}), el.get("bounds")
        if t.get("leisure") != "stadium" or not b:
            continue
        area = (b["maxlat"] - b["minlat"]) * 111_000 * (b["maxlon"] - b["minlon"]) * 111_000 * 0.76
        if area < min_area_m2:
            continue
        name = (t.get("name") or "").lower()
        # by name or roof only: Forest Hills Stadium carries building=yes but is an open-air concert venue
        is_indoor = any(w in name for w in INDOOR_WORDS) or t.get("covered") == "yes"
        if is_indoor == indoor:
            lat.append((b["minlat"] + b["maxlat"]) / 2); lon.append((b["minlon"] + b["maxlon"]) / 2)
    return to_ft(lat, lon) if lat else np.empty((0, 2))


def _layer(tags: dict) -> int:
    v = tags.get("layer", "0")
    return int(v) if v.lstrip("-").isdigit() else 0


def osm_points(elements: list[dict], keep) -> np.ndarray:
    """Nodes and the centre of ways/relations matching `keep`, projected."""
    lat, lon = [], []
    for el in elements:
        tags = el.get("tags", {})
        if not keep(tags):
            continue
        if el["type"] == "node":
            lat.append(el["lat"]); lon.append(el["lon"])
        elif el.get("bounds"):
            b = el["bounds"]; lat.append((b["minlat"] + b["maxlat"]) / 2); lon.append((b["minlon"] + b["maxlon"]) / 2)
    return to_ft(lat, lon) if lat else np.empty((0, 2))


def osm_polygons(elements: list[dict], min_area_ft2: float) -> np.ndarray:
    polys = []
    for el in elements:
        rings = [el["geometry"]] if el["type"] == "way" else [m["geometry"] for m in el.get("members", [])
                                                             if m.get("role") == "outer" and m.get("geometry")]
        for g in rings:
            if g and len(g) >= 4:
                p = shapely.Polygon(to_ft([q["lat"] for q in g], [q["lon"] for q in g]))
                if p.is_valid and p.area >= min_area_ft2:
                    polys.append(p)
    return np.array(polys, dtype=object)


def nearest_distance(xy: np.ndarray, geoms: np.ndarray, cap: float = 30_000) -> np.ndarray:
    """Distance (ft) from each point to the nearest geometry, capped so 'far' is one value."""
    if len(geoms) == 0:
        return np.full(len(xy), cap)
    tree = shapely.STRtree(geoms)
    pts = shapely.points(xy)
    _, dist = tree.query_nearest(pts, return_distance=True, all_matches=False)
    return np.minimum(dist, cap)


def nearest_point_distance(xy: np.ndarray, pts: np.ndarray, cap: float = 30_000) -> np.ndarray:
    if len(pts) == 0:
        return np.full(len(xy), cap)
    d, _ = cKDTree(pts).query(xy, k=1)
    return np.minimum(d, cap)


def count_within(xy: np.ndarray, pts: np.ndarray, r: float = R_NEAR, weights=None) -> np.ndarray:
    if len(pts) == 0:
        return np.zeros(len(xy))
    idx = cKDTree(pts).query_ball_point(xy, r)
    w = np.ones(len(pts)) if weights is None else np.asarray(weights, float)
    return np.array([w[i].sum() for i in idx])


def length_within(xy: np.ndarray, lines: np.ndarray, r: float = R_NEAR) -> np.ndarray:
    """Total length (ft) of `lines` inside a circle of radius r around each point."""
    out = np.zeros(len(xy))
    if len(lines) == 0:
        return out
    circles = shapely.buffer(shapely.points(xy), r, quad_segs=8)
    pi, li = shapely.STRtree(lines).query(circles, predicate="intersects")
    np.add.at(out, pi, shapely.length(shapely.intersection(circles[pi], lines[li])))
    return out


# ------------------------------------------------------------------ assembling cells
HEAT_RES = 10  # ~66 m edge: the resolution of the map's density layer

def complaint_cells(raw: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp):
    """Complaint-days per res-9 cell (with types, night counts, months) and per res-10 cell for the heat layer."""
    d = raw[(raw["created"] >= start) & (raw["created"] < end)].dropna(subset=["lat", "lon"])
    d = d[(d["lat"].between(BBOX[0], BBOX[2])) & (d["lon"].between(BBOX[1], BBOX[3]))]
    fine = [h3.latlng_to_cell(a, b, HEAT_RES) for a, b in zip(d["lat"].to_numpy(), d["lon"].to_numpy())]
    parent = {c: h3.cell_to_parent(c, RES) for c in set(fine)}
    d = d.assign(h3=[parent[c] for c in fine], h3_fine=fine, group=d["type"].map(TYPE_GROUPS).fillna("other"),
                 month=d["created"].dt.to_period("M").astype(str))
    reports = d.groupby("h3").size()
    # Repeat callers: single addresses file thousands of reports (one Bronx building ~200 a day). Count each
    # exact address at most once per day per type ("complaint-days") so a few callers cannot define a block.
    d = d.assign(day=d["created"].dt.normalize()).drop_duplicates(["lat", "lon", "day", "type"])
    wide = d.pivot_table(index="h3", columns="group", values="lat", aggfunc="size", fill_value=0)
    wide["complaints"] = wide.sum(axis=1)
    wide["reports"] = reports.reindex(wide.index).fillna(0).astype(int)
    is_night = (d["created"].dt.hour >= 22) | (d["created"].dt.hour < 6)
    night = d[is_night].groupby("h3").size()
    wide["night"] = night.reindex(wide.index).fillna(0).astype(int)
    wide["night_share"] = (wide["night"] / wide["complaints"]).round(3)
    monthly = d.groupby(["h3", "month"]).size().unstack(fill_value=0)
    wide["monthly"] = monthly.reindex(wide.index).fillna(0).astype(int).values.tolist()
    heat = pd.DataFrame({"all": d.groupby("h3_fine").size(), "night": d[is_night].groupby("h3_fine").size()}).fillna(0).astype(int)
    ll = np.array([h3.cell_to_latlng(c) for c in heat.index])
    heat = heat.assign(lat=ll[:, 0].round(5), lon=ll[:, 1].round(5)).reset_index(names="h3")
    return wide.reset_index(), list(monthly.columns), heat


def pluto_frame(rows: list[dict]) -> pd.DataFrame:
    p = pd.DataFrame(rows).apply(pd.to_numeric, errors="coerce").dropna(subset=["latitude", "longitude"])
    p["h3"] = [h3.latlng_to_cell(a, b, RES) for a, b in zip(p["latitude"], p["longitude"])]
    return p


def pluto_cells(p: pd.DataFrame) -> pd.DataFrame:
    g = p.groupby("h3").agg(units=("unitsres", "sum"), retail_area=("retailarea", "sum"),
                            commercial_area=("comarea", "sum"), floors=("numfloors", "mean"), lots=("unitsres", "size"))
    return g.reset_index()


def exposure(at_xy: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Sum over venues of (30 m / distance)^2 within 150 m, distance floored at 10 m.

    A venue 30 m away counts 1, at 60 m 0.25, at 150 m 0.04: the inverse-square fall-off of sound.
    """
    if len(pts) == 0 or len(at_xy) == 0:
        return np.zeros(len(at_xy))
    # nudge venues so one sharing a lot's exact coordinate still registers (sparse matrices drop zero distances)
    m = cKDTree(at_xy).sparse_distance_matrix(cKDTree(pts + [0.5, 0.0]), DMAX_FT, output_type="coo_matrix")
    w = (D0_FT / np.maximum(m.data, DMIN_FT)) ** 2
    return np.bincount(m.row, weights=w, minlength=len(at_xy))


LINE_MAX_FT = 1640.0  # line sources ignored beyond 500 m


def line_exposure(at_xy: np.ndarray, lines: np.ndarray) -> np.ndarray:
    """(30 m / distance) to the nearest line, floored at 10 m, zero beyond 500 m: a line source's 1/d fall-off."""
    d = nearest_distance(at_xy, lines, cap=LINE_MAX_FT * 2)
    return np.where(d <= LINE_MAX_FT, D0_FT / np.maximum(d, DMIN_FT), 0.0)


def fine_exposure(lots: pd.DataFrame, values: dict[str, np.ndarray]) -> pd.DataFrame:
    """Unit-weighted mean exposure of homes per res-10 cell (~66 m): the map's high-resolution layer."""
    fine = [h3.latlng_to_cell(a, b, HEAT_RES) for a, b in zip(lots["latitude"].to_numpy(), lots["longitude"].to_numpy())]
    w = lots["unitsres"].to_numpy()
    df = pd.DataFrame({"h3": fine, "w": w, **{k: v * w for k, v in values.items()}}).groupby("h3").sum()
    out = df[list(values)].div(df["w"], axis=0).round(3)
    out["units"] = df["w"].astype(int)
    ll = np.array([h3.cell_to_latlng(c) for c in out.index])
    return out.assign(lat=ll[:, 0].round(5), lon=ll[:, 1].round(5)).reset_index()


def homes_mean(lots: pd.DataFrame, values: np.ndarray, cells: pd.DataFrame, fallback: np.ndarray) -> np.ndarray:
    """Average a per-lot value over each cell's homes, weighted by residential units; cells without homes use `fallback`."""
    w = lots["unitsres"].to_numpy()
    g = pd.DataFrame({"h3": lots["h3"].to_numpy(), "wv": w * values, "w": w}).groupby("h3")[["wv", "w"]].sum()
    mean = (g["wv"] / g["w"]).reindex(cells["h3"]).to_numpy()
    return np.where(np.isnan(mean), fallback, mean)


def sla_points(rows: list[dict]) -> dict[str, np.ndarray]:
    out = {}
    for group, descs in SLA_GROUPS.items():
        pts = [r["georeference"]["coordinates"] for r in rows
               if r.get("description") in descs and isinstance(r.get("georeference"), dict)]
        out[group] = to_ft([c[1] for c in pts], [c[0] for c in pts]) if pts else np.empty((0, 2))
    return out


def truck_lines(rows: list[dict], kind: str) -> np.ndarray:
    lines = []
    for r in rows:
        g = r.get("the_geom") or {}
        if r.get("routetype", "").lower().startswith(kind) and g.get("type") == "MultiLineString":
            for part in g["coordinates"]:
                if len(part) >= 2:
                    a = np.array(part)
                    lines.append(shapely.LineString(to_ft(a[:, 1], a[:, 0])))
    return np.array(lines, dtype=object)


def build_cells(raw: pd.DataFrame, src: dict, end: pd.Timestamp):
    start = end - pd.Timedelta(weeks=WINDOW_WEEKS)
    comp, months, heat = complaint_cells(raw, start, end)
    pluto = pluto_frame(src["pluto"])
    plu = pluto_cells(pluto)
    cells = comp.merge(plu, on="h3", how="outer")
    cells = cells[(cells["units"].fillna(0) > 0) | (cells["complaints"].fillna(0) > 0)].copy()
    count_cols = [c for c in comp.columns if c not in ("h3", "monthly", "night_share")]  # includes "night"
    cells[count_cols] = cells[count_cols].fillna(0).astype(int)
    for c in ("units", "retail_area", "commercial_area", "lots"):
        cells[c] = cells[c].fillna(0)
    cells["floors"] = cells["floors"].fillna(0)
    cells["night_share"] = cells["night_share"].fillna(0)
    cells["monthly"] = cells["monthly"].apply(lambda v: v if isinstance(v, list) else [0] * len(months))
    ll = np.array([h3.cell_to_latlng(c) for c in cells["h3"]])
    cells["lat"], cells["lon"] = ll[:, 0], ll[:, 1]
    xy = to_ft(cells["lat"], cells["lon"])

    roads = src["roads"]["elements"]
    open_air = lambda t: t.get("tunnel") not in ("yes", "building_passage", "covered")  # tunnels are not heard on the street
    highway = osm_lines(roads, lambda t: t.get("highway") in ("motorway", "trunk") and open_air(t))
    arterial = osm_lines(roads, lambda t: t.get("highway") in ("primary", "secondary") and open_air(t))
    rail = src["rail"]["elements"]
    surface_rail = osm_lines(rail, lambda t: t.get("tunnel") not in ("yes", "building_passage") and _layer(t) >= 0)
    elevated = osm_lines(rail, lambda t: t.get("bridge") == "yes" or _layer(t) > 0)
    pts = src["points"]["elements"]
    sla = sla_points(src["sla"])
    ahv = pd.DataFrame(src["ahv"]).dropna(subset=["latitude", "longitude"])
    ahv_xy = to_ft(pd.to_numeric(ahv["latitude"]), pd.to_numeric(ahv["longitude"]))

    f = cells
    # Line sources (roads, rail, truck routes) are measured at every home with 1/distance fall-off
    # (about 3 dB per doubling), then averaged over the cell's homes by residential units.
    lots = pluto[pluto["unitsres"] > 0]
    lot_xy = to_ft(lots["latitude"], lots["longitude"])
    lines = {"highway": highway, "arterial": arterial, "truck": truck_lines(src["truck"], "through"),
             "rail": surface_rail, "elevated": elevated}
    lot_exp = {}
    for name, geoms in lines.items():
        lot_exp[name] = line_exposure(lot_xy, geoms)
        f[f"{name}_exposure"] = homes_mean(lots, lot_exp[name], f, line_exposure(xy, geoms))
    f["d_highway"] = homes_mean(lots, nearest_distance(lot_xy, highway), f, nearest_distance(xy, highway))
    f["d_elevated_rail"] = homes_mean(lots, nearest_distance(lot_xy, elevated), f, nearest_distance(xy, elevated))
    f["n_stations"] = count_within(xy, osm_points(pts, lambda t: t.get("railway") == "station" or t.get("station") == "subway"), 2000)
    # Venues are measured where people live: at every residential lot, averaged over the cell's homes by units.
    venues = {"bar": sla["bars"], "restaurant": sla["restaurants"], "offprem": sla["off_premises"],
              "venue": np.vstack([sla["venues"], osm_points(pts, lambda t: t.get("amenity") in ("nightclub", "music_venue"))])}
    for name, vp in venues.items():
        lot_exp[name] = exposure(lot_xy, vp)
        f[f"{name}_exposure"] = homes_mean(lots, lot_exp[name], f, exposure(xy, vp))
    for name in ("bar", "restaurant"):
        f[f"d_{name}"] = homes_mean(lots, nearest_point_distance(lot_xy, venues[name], cap=5000),
                                    f, nearest_point_distance(xy, venues[name], cap=5000))
    f["n_ahv"] = count_within(xy, ahv_xy, weights=pd.to_numeric(ahv["n"]).to_numpy())
    f["d_stadium"] = nearest_point_distance(xy, major_venues(pts, indoor=False))
    f["d_arena"] = nearest_point_distance(xy, major_venues(pts, indoor=True))
    f["d_heliport"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("aeroway") == "heliport"))
    f["d_airport"] = np.min([np.hypot(*(xy - to_ft([a], [b])[0]).T) for a, b in AIRPORTS.values()], axis=0)
    f["d_fire_station"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("amenity") == "fire_station"))
    f["d_hospital"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("amenity") == "hospital"))
    f["d_park"] = nearest_distance(xy, osm_polygons(src["parks"]["elements"], min_area_ft2=107_639))  # >= 1 hectare
    exposure_pts = fine_exposure(lots, {k: lot_exp[k] for k in ("highway", "elevated", "bar")})
    return f.reset_index(drop=True), months, heat, exposure_pts


def build(out_dir: Path = nd.DATA_DIR) -> pd.DataFrame:
    manifest = json.loads((out_dir / "manifest.json").read_text())
    end = pd.Timestamp(manifest["last_week"]) + pd.Timedelta(days=7)
    since = (end - pd.Timedelta(weeks=WINDOW_WEEKS)).strftime("%Y-%m-%d")
    raw = _read_raw(out_dir / "raw")
    src = fetch_all(since)
    cells, months, heat, exposure_pts = build_cells(raw, src, end)
    heat.to_csv(out_dir / "heat_points.csv.gz", index=False)
    exposure_pts.to_csv(out_dir / "exposure_points.csv.gz", index=False)
    validate_cells(cells)
    cells.to_csv(out_dir / "cells.csv.gz", index=False)
    (out_dir / "cells_meta.json").write_text(json.dumps({
        "window_start": since, "window_end": f"{end - pd.Timedelta(days=1):%Y-%m-%d}", "weeks": WINDOW_WEEKS,
        "months": months, "h3_resolution": RES, "cells": int(len(cells)),
        "sources": {k: (len(v) if isinstance(v, list) else len(v.get("elements", []))) for k, v in src.items()}}, indent=2))
    print(f"cells: {len(cells):,}, complaints in window: {int(cells['complaints'].sum()):,}")
    return cells


def _read_raw(raw_dir: Path) -> pd.DataFrame:
    """Cached monthly 311 files only (no network): the ingest step owns downloading."""
    frames = [pd.read_csv(f, dtype={"zip": str}) for f in sorted(raw_dir.glob("*.csv.gz"))]
    raw = pd.concat(frames, ignore_index=True)
    raw["created"] = pd.to_datetime(raw["created"])
    return raw


def validate_cells(cells: pd.DataFrame) -> None:
    assert cells["h3"].is_unique, "duplicate hex cells"
    assert (cells["complaints"] >= 0).all() and (cells["units"] >= 0).all()
    dist = [c for c in cells.columns if c.startswith("d_")]
    assert (cells[dist] >= 0).all().all() and not cells[dist].isna().any().any(), "bad distance features"
    assert cells["complaints"].sum() > 0 and len(cells) > 1000, "suspiciously small grid"


if __name__ == "__main__":
    build()
