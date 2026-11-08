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
R_NEAR = 1000.0  # feet (~300 m): "within a short walk"
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
def complaint_cells(raw: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    d = raw[(raw["created"] >= start) & (raw["created"] < end)].dropna(subset=["lat", "lon"])
    d = d[(d["lat"].between(BBOX[0], BBOX[2])) & (d["lon"].between(BBOX[1], BBOX[3]))]
    cell = [h3.latlng_to_cell(a, b, RES) for a, b in zip(d["lat"].to_numpy(), d["lon"].to_numpy())]
    d = d.assign(h3=cell, group=d["type"].map(TYPE_GROUPS).fillna("other"),
                 month=d["created"].dt.to_period("M").astype(str))
    reports = d.groupby("h3").size()
    # Repeat callers: single addresses file thousands of reports (one Bronx building ~200 a day). Count each
    # exact address at most once per day per type ("complaint-days") so a few callers cannot define a block.
    d = d.assign(day=d["created"].dt.normalize()).drop_duplicates(["lat", "lon", "day", "type"])
    wide = d.pivot_table(index="h3", columns="group", values="lat", aggfunc="size", fill_value=0)
    wide["complaints"] = wide.sum(axis=1)
    wide["reports"] = reports.reindex(wide.index).fillna(0).astype(int)
    night = d[(d["created"].dt.hour >= 22) | (d["created"].dt.hour < 6)].groupby("h3").size()
    wide["night_share"] = (night.reindex(wide.index).fillna(0) / wide["complaints"]).round(3)
    monthly = d.groupby(["h3", "month"]).size().unstack(fill_value=0)
    wide["monthly"] = monthly.reindex(wide.index).fillna(0).astype(int).values.tolist()
    return wide.reset_index(), list(monthly.columns)


def pluto_cells(rows: list[dict]) -> pd.DataFrame:
    p = pd.DataFrame(rows).apply(pd.to_numeric, errors="coerce").dropna(subset=["latitude", "longitude"])
    p["h3"] = [h3.latlng_to_cell(a, b, RES) for a, b in zip(p["latitude"], p["longitude"])]
    g = p.groupby("h3").agg(units=("unitsres", "sum"), retail_area=("retailarea", "sum"),
                            commercial_area=("comarea", "sum"), floors=("numfloors", "mean"), lots=("unitsres", "size"))
    return g.reset_index()


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


def build_cells(raw: pd.DataFrame, src: dict, end: pd.Timestamp) -> tuple[pd.DataFrame, list[str]]:
    start = end - pd.Timedelta(weeks=WINDOW_WEEKS)
    comp, months = complaint_cells(raw, start, end)
    plu = pluto_cells(src["pluto"])
    cells = comp.merge(plu, on="h3", how="outer")
    cells = cells[(cells["units"].fillna(0) > 0) | (cells["complaints"].fillna(0) > 0)].copy()
    count_cols = [c for c in comp.columns if c not in ("h3", "monthly", "night_share")]
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
    highway = osm_lines(roads, lambda t: t.get("highway") in ("motorway", "trunk"))
    arterial = osm_lines(roads, lambda t: t.get("highway") in ("primary", "secondary"))
    rail = src["rail"]["elements"]
    surface_rail = osm_lines(rail, lambda t: t.get("tunnel") not in ("yes", "building_passage") and _layer(t) >= 0)
    elevated = osm_lines(rail, lambda t: t.get("bridge") == "yes" or _layer(t) > 0)
    pts = src["points"]["elements"]
    sla = sla_points(src["sla"])
    ahv = pd.DataFrame(src["ahv"]).dropna(subset=["latitude", "longitude"])
    ahv_xy = to_ft(pd.to_numeric(ahv["latitude"]), pd.to_numeric(ahv["longitude"]))

    f = cells
    f["d_highway"] = nearest_distance(xy, highway)
    f["len_highway"] = length_within(xy, highway)
    f["d_arterial"] = nearest_distance(xy, arterial)
    f["len_arterial"] = length_within(xy, arterial)
    f["len_truck_through"] = length_within(xy, truck_lines(src["truck"], "through"))
    f["len_truck_local"] = length_within(xy, truck_lines(src["truck"], "local"))
    f["d_surface_rail"] = nearest_distance(xy, surface_rail)
    f["d_elevated_rail"] = nearest_distance(xy, elevated)
    f["n_stations"] = count_within(xy, osm_points(pts, lambda t: t.get("railway") == "station" or t.get("station") == "subway"), 2000)
    f["n_bars"] = count_within(xy, sla["bars"])
    f["n_restaurants"] = count_within(xy, sla["restaurants"])
    f["n_off_premises"] = count_within(xy, sla["off_premises"])
    f["n_venues"] = count_within(xy, np.vstack([sla["venues"], osm_points(pts, lambda t: t.get("amenity") in ("nightclub", "music_venue"))]))
    f["n_ahv"] = count_within(xy, ahv_xy, weights=pd.to_numeric(ahv["n"]).to_numpy())
    f["d_stadium"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("leisure") == "stadium"))
    f["d_heliport"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("aeroway") == "heliport"))
    f["d_airport"] = np.min([np.hypot(*(xy - to_ft([a], [b])[0]).T) for a, b in AIRPORTS.values()], axis=0)
    f["d_fire_station"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("amenity") == "fire_station"))
    f["d_hospital"] = nearest_point_distance(xy, osm_points(pts, lambda t: t.get("amenity") == "hospital"))
    f["d_park"] = nearest_distance(xy, osm_polygons(src["parks"]["elements"], min_area_ft2=107_639))  # >= 1 hectare
    return f.reset_index(drop=True), months


def build(out_dir: Path = nd.DATA_DIR) -> pd.DataFrame:
    manifest = json.loads((out_dir / "manifest.json").read_text())
    end = pd.Timestamp(manifest["last_week"]) + pd.Timedelta(days=7)
    since = (end - pd.Timedelta(weeks=WINDOW_WEEKS)).strftime("%Y-%m-%d")
    raw = _read_raw(out_dir / "raw")
    src = fetch_all(since)
    cells, months = build_cells(raw, src, end)
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
