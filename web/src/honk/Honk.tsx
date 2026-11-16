import DeckGL from "@deck.gl/react";
import { LinearInterpolator, WebMercatorViewport } from "@deck.gl/core";
import { BitmapLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Map as BaseMap } from "react-map-gl/maplibre";
import { latLngToCell } from "h3-js";
import { type Icon, IconAmbulance, IconBarrierBlock, IconBeer, IconBellRinging, IconBike, IconCar, IconCarSuv, IconDeviceSpeaker, IconFiretruck, IconHelicopter,
  IconCurrentLocation, IconHelpCircle, IconMinus, IconMotorbike, IconPlus, IconShare2, IconTrain, IconTruck, IconUrgent, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "../MapView"; // registers the MapLibre worker
import { type Cells, fmt, rampCss, reducedMotion, thermal } from "../data";
import Search from "../Search";
import { track } from "../track";
import { covers, loadArea } from "./area";
import { type Area, type Result, type Src, type Windows, CAL, PX, RANGE, SPEED, bounds, fromGrid, selfCheck, toGrid } from "./physics";
import Report from "./Report";
import { shareCard } from "./share";
import { SOUNDS, type Sound, play, toSrc } from "./sounds";
import "./honk.css";

if (import.meta.env.DEV) selfCheck();

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const PLACES = [
  { name: "East Village", sub: "walk-ups and bars", lat: 40.7265, lon: -73.9840 },
  { name: "Midtown", sub: "towers, few sleepers", lat: 40.7570, lon: -73.9860 },
  { name: "Harlem", sub: "brownstone rows", lat: 40.8090, lon: -73.9440 },
  { name: "Washington Heights", sub: "big prewar blocks", lat: 40.8480, lon: -73.9370 },
  { name: "Williamsburg", sub: "lofts by the L", lat: 40.7140, lon: -73.9580 },
  { name: "Bed-Stuy", sub: "brownstone Brooklyn", lat: 40.6865, lon: -73.9440 },
  { name: "Jackson Heights", sub: "under the 7 train", lat: 40.7495, lon: -73.8880 },
  { name: "Astoria", sub: "near the N/W El", lat: 40.7660, lon: -73.9210 },
  { name: "Mott Haven", sub: "South Bronx", lat: 40.8085, lon: -73.9230 },
  { name: "St. George", sub: "Staten Island", lat: 40.6420, lon: -74.0790 },
];
const LEGEND = [[30, "library"], [50, "office"], [70, "vacuum"], [90, "subway"], [105, "siren"]] as const;
const END = RANGE / SPEED + 0.5;
const WINDOWS: Windows[] = ["open", "tilted", "closed"];
const NIGHTLY = [1, 4, 12, 40];

// The simulation runs in a worker; the last area sent is remembered there.
let worker: Worker | null = null, sent: Area | null = null, seq = 0;
function simulateOff(a: Area, src: Src, gx: number, gy: number, windows: Windows): Promise<Result> {
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const id = ++seq, w = worker;
  return new Promise((ok, fail) => {
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", on);
      if (e.data.error) fail(new Error(e.data.error)); else ok(e.data.res);
    };
    w.addEventListener("message", on);
    w.postMessage({ id, src, gx, gy, windows, ...(sent === a ? {} : { area: a }) });
    sent = a;
  });
}
// 311 for the block under a honk, from the noise map's own data (fetched once, only when needed).
let cellsP: Promise<{ c: Cells; at: Map<string, number> } | null> | null = null;
const getCells = () => (cellsP ??= fetch("/data/cells.json").then((r) => r.json())
  .then((c: Cells) => ({ c, at: new Map(c.h3.map((h, i) => [h, i])) })).catch(() => null));
type Block = { h3: string; i: number; c: Cells; perYear: number; expected: number } | null;

/** A honk is shareable: everything needed to replay it lives in the hash. */
const readHash = () => {
  const q = new URLSearchParams(window.location.hash.slice(1)), lat = parseFloat(q.get("lat") ?? ""), lon = parseFloat(q.get("lon") ?? "");
  const sound = SOUNDS.find((s) => s.id === q.get("s")), d = parseFloat(q.get("d") ?? "");
  return {
    at: Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat - 40.7) < 0.5 && Math.abs(lon + 73.95) < 0.5 ? { lat, lon } : null,
    sound, dur: Number.isFinite(d) ? Math.min(30, Math.max(0.1, d)) : undefined,
    windows: WINDOWS.find((w) => w === q.get("w")), nightly: NIGHTLY.find((n) => n === Number(q.get("n"))),
    place: q.get("p")?.slice(0, 60) || undefined, report: q.get("r") === "1",
  };
};
const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };

type View = { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number };
type Shot = { res: Result; area: Area; lat: number; lon: number; sound: Sound; dur: number; start: number; windows: Windows; place: string };
type Hold = { lat: number; lon: number; start: number; stop: () => void };

const flavour = (n: number) =>
  n < 0.5 ? "Nobody stirred. New Yorkers have slept through worse, and louder."
  : n < 4 ? "A super, a light sleeper, and a dog who now needs to go out."
  : n < 16 ? "About a bodega line at 3 a.m., and just as thrilled."
  : n < 60 ? "A full subway car, give or take the guy with the bike."
  : n < 200 ? "A co-op board meeting. Every one of them is drafting a letter."
  : n < 800 ? "A sold-out show at the Bowery Ballroom, none of them happy."
  : n < 2000 ? "A Broadway house, all staring at the ceiling."
  : "A Yankees home crowd, minus the fun. Someone's already on with 311.";
/** What a level in a bedroom is like, for people who don't think in decibels. */
const LIKE = [[35, "a whisper"], [45, "a fridge humming"], [55, "two people talking"], [65, "a TV turned up"], [75, "a vacuum cleaner"], [85, "a blender at full tilt"], [Infinity, "a subway platform"]] as const;
const like = (db: number) => LIKE.find(([l]) => db < l)![1];
/** The nearest named neighbourhood within ~1.5 km, for the share card; otherwise just "New York". */
const nearest = (lat: number, lon: number) => {
  let best = "New York", bd = 1.5;
  for (const p of PLACES) { const d = Math.hypot((p.lat - lat) * 111, (p.lon - lon) * 84); if (d < bd) { bd = d; best = p.name; } }
  return best;
};
const count = (n: number) => (n > 0 && n < 1 ? "<1" : fmt(n));

const ICONS: Record<string, Icon> = { horn: IconCar, cab: IconCarSuv, alarm: IconBellRinging, moto: IconMotorbike, fdny: IconFiretruck, nypd: IconUrgent,
  ems: IconAmbulance, garbage: IconTruck, el: IconTrain, jack: IconBarrierBlock, heli: IconHelicopter, party: IconDeviceSpeaker, bar: IconBeer, bell: IconBike };
function Glyph({ s, size = 28 }: { s: Sound; size?: number }) {
  const I = ICONS[s.id] ?? IconVolume;
  return <I size={size} stroke={1.6} aria-hidden="true" />;
}

export default function Honk() {
  const [init] = useState(readHash);
  const [sound, setSound] = useState<Sound>(init.sound ?? SOUNDS[0]);
  const label = useRef<string | undefined>(init.place); // an address picked in search names the honk; otherwise the nearest neighbourhood
  const [locating, setLocating] = useState(false);
  const [help, setHelp] = useState(false);
  const [view, setView] = useState<View>({ longitude: init.at?.lon ?? PLACES[0].lon, latitude: init.at?.lat ?? PLACES[0].lat, zoom: init.at ? 16 : 15.4, pitch: 0, bearing: 0 });
  const [windows, setWindows] = useState<Windows>(init.windows ?? "open");
  const [nightly, setNightly] = useState(init.nightly ?? 1);
  const [block, setBlock] = useState<Block>(null);
  const [report, setReport] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState<{ lat: number; lon: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const area = useRef<Area | null>(null);
  const loading = useRef<Promise<Area> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; t: number; timer: number; moved: boolean } | null>(null);
  const size = useRef({ width: 800, height: 600 });

  // One clock for every animation: the reveal, the hold ring, the busy pulse.
  const t = shot ? (reducedMotion() ? END : Math.max(0, now - shot.start) / 1000) : 0; // `now` can predate the shot for one frame
  const animating = !!hold || !!busy || (shot !== null && t < END);
  useEffect(() => {
    if (!animating) return;
    let id = 0;
    const tick = () => { setNow(performance.now()); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [animating]);
  // Opened from a shared link or the noise map: replay that honk (silently; browsers block sound before a gesture).
  useEffect(() => {
    if (init.at) honk(init.at.lat, init.at.lon, init.dur ?? sound.dur, true);
    else window.history.replaceState(null, "", "#tab=honk");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount

  const unproject = (x: number, y: number) => {
    const [lon, lat] = new WebMercatorViewport({ ...view, ...size.current }).unproject([x, y]);
    return { lat, lon };
  };
  const writeHash = (s: Shot, n: number, r = false) => window.history.replaceState(null, "", `#${new URLSearchParams({
    tab: "honk", lat: s.lat.toFixed(5), lon: s.lon.toFixed(5), s: s.sound.id, d: s.dur.toFixed(1), w: s.windows, n: String(n), p: s.place, ...(r ? { r: "1" } : {}) })}`);
  const sound$ = (s: Sound, secs?: number) => (muted ? () => {} : play(s, secs));

  // On a phone the result card covers the lower half: glide the honk into the upper third so its spread stays in view.
  const frameSpot = (lat: number, lon: number) => {
    if (window.innerWidth > 860) return;
    const vp = new WebMercatorViewport({ ...view, ...size.current }), [x, y] = vp.project([lon, lat]);
    const [longitude, latitude] = vp.unproject([x, y + size.current.height * 0.17]);
    setView({ ...view, longitude, latitude, transitionDuration: reducedMotion() ? 0 : 450, transitionInterpolator: new LinearInterpolator(["longitude", "latitude"]) } as View);
  };

  async function honk(lat: number, lon: number, dur: number, replay = false, s: Sound = sound) {
    setErr(null); setShared(null); setBlock(null); setReport(false);
    frameSpot(lat, lon);
    setBusy({ lat, lon });
    try {
      let a = area.current;
      if (!a || !covers(a, lat, lon)) {
        loading.current = loadArea(lat, lon);
        a = await loading.current;
        area.current = a;
      }
      const [gx, gy] = toGrid(a, lat, lon);
      const res = await simulateOff(a, toSrc(s, dur), gx, gy, windows);
      const at = fromGrid(a, res.sx, res.sy); // the source may have moved to the nearest street
      const next = { res, area: a, ...at, sound: s, dur, windows, start: performance.now(), place: label.current ?? nearest(lat, lon) };
      label.current = undefined;
      setShot(next);
      writeHash(next, nightly);
      track("honk", { sound: s.id, windows, replay, woke: Math.round(res.woke.mid) });
      getCells().then((cc) => {
        const i = cc?.at.get(latLngToCell(lat, lon, 9));
        setBlock(cc && i !== undefined ? { h3: cc.c.h3[i], i, c: cc.c, perYear: cc.c.complaints[i] / cc.c.years, expected: cc.c.oof[i] / cc.c.years } : null);
        if (replay && init.report && cc && i !== undefined) { setReport(true); writeHash(next, nightly, true); }
      });
    } catch (e) {
      setErr(`Could not load the buildings here (${e instanceof Error ? e.message : e}). Try again in a moment.`);
    } finally {
      setBusy(null);
    }
  }

  // Map gestures: tap honks for the sound's own length; press and hold honks for as long as you hold (up to 8 s counts).
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("a, button")) return;
    const r = box.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const p = { x, y, t: performance.now(), moved: false, timer: 0 };
    p.timer = window.setTimeout(() => {
      if (press.current !== p || p.moved) return;
      const at = unproject(x, y);
      vibrate(20);
      setHold({ ...at, start: performance.now(), stop: sound$(sound) });
    }, 280);
    press.current = p;
  };
  const move = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.moved) return;
    const r = box.current!.getBoundingClientRect();
    if (Math.hypot(e.clientX - r.left - p.x, e.clientY - r.top - p.y) > 6) {
      p.moved = true;
      if (hold) { hold.stop(); setHold(null); }
    }
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (p.moved) return;
    if (hold) { hold.stop(); setHold(null); honk(hold.lat, hold.lon, Math.max(0.3, (performance.now() - hold.start) / 1000)); return; }
    const at = unproject(p.x, p.y);
    sound$(sound, sound.dur);
    honk(at.lat, at.lon, sound.dur);
  };
  // The big button honks at the last spot, or the middle of the map.
  const spot = () => (shot ? { lat: shot.lat, lon: shot.lon } : { lat: view.latitude, lon: view.longitude });
  const btnDown = (e: React.PointerEvent) => { if (e.button === 0) { vibrate(20); setHold({ ...spot(), start: performance.now(), stop: sound$(sound) }); } };
  const btnUp = () => { if (!hold) return; hold.stop(); setHold(null); honk(hold.lat, hold.lon, Math.max(0.3, (performance.now() - hold.start) / 1000)); };
  const btnKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (e.repeat) return;
    const s = spot(); sound$(sound, sound.dur); honk(s.lat, s.lon, sound.dur);
  };

  // An address or your location honks there straight away: the question is always "who would this wake?"
  const honkAt = (lat: number, lon: number, name?: string) => {
    label.current = name;
    setView({ ...view, latitude: lat, longitude: lon, zoom: Math.max(view.zoom, 16) });
    sound$(sound, sound.dur); honk(lat, lon, sound.dur);
  };
  const locate = () => {
    if (!navigator.geolocation) return setErr("This browser can't share its location. Search an address instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => {
      setLocating(false);
      const { latitude: lat, longitude: lon } = p.coords;
      if (Math.abs(lat - 40.7) > 0.3 || Math.abs(lon + 73.95) > 0.35) return setErr("You're outside the five boroughs. Lucky you. Tap the map or search a New York address.");
      honkAt(lat, lon, "your block");
    }, () => { setLocating(false); setErr("No location, no problem. Tap the map or search an address."); }, { timeout: 8000, maximumAge: 60000 });
  };
  const pick = (s: Sound) => { setSound(s); sound$(s, Math.min(s.dur, 1.2)); };

  // The full field as an image once per honk; each frame shows it out to the wavefront.
  const full = useMemo(() => {
    if (!shot) return null;
    const { res, area: a } = shot, W = a.W, c = document.createElement("canvas");
    c.width = W; c.height = W;
    const ctx = c.getContext("2d")!, img = ctx.createImageData(W, W);
    for (let p = 0; p < W * W; p++) {
      const L = res.field[p];
      if (!(L >= 36)) continue;
      const [r, g, b] = thermal((L - 30) / 78);
      img.data.set([r, g, b, Math.round(40 + 200 * Math.min(1, (L - 36) / 26))], p * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }, [shot]);
  const wave = Math.min(RANGE, SPEED * t);
  const frame = useMemo(() => {
    if (!full || !shot) return null;
    if (wave >= RANGE) return full;
    const c = document.createElement("canvas");
    c.width = full.width; c.height = full.height;
    const ctx = c.getContext("2d")!;
    ctx.beginPath(); ctx.arc(shot.res.sx + 0.5, shot.res.sy + 0.5, wave / PX, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(full, 0, 0);
    return c;
  }, [full, shot, wave]);

  // The loudest bedroom, labelled on the map once the wave has passed it.
  const loudest = useMemo(() => shot?.res.hits.reduce<typeof shot.res.hits[number] | null>((m, h) => (!m || h.peak > m.peak ? h : m), null) ?? null, [shot]);
  // Half the people woken lived within this distance.
  const halfWithin = useMemo(() => {
    if (!shot) return 0;
    let acc = 0;
    for (const h of shot.res.hits) { acc += h.woke; if (acc >= shot.res.woke.mid / 2) return h.d; }
    return 0;
  }, [shot]);

  let woke = 0, reacted = 0;
  if (shot) for (const h of shot.res.hits) { if (h.d > wave) break; woke += h.woke; reacted += h.reacted; }
  const done = shot !== null && wave >= RANGE;
  const setNightlyAndLink = (n: number) => { setNightly(n); if (shot) writeHash(shot, n, report); };
  const openReport = (on: boolean) => { setReport(on); if (shot) writeHash(shot, nightly, on); if (on) track("report", {}); };
  // From the report: play a suspect at this address, worst case, and show who it wakes.
  const hear = (id: string) => {
    const s = SOUNDS.find((x) => x.id === id)!;
    if (!shot) return;
    label.current = shot.place;
    setSound(s); sound$(s, s.dur); honk(shot.lat, shot.lon, s.dur, false, s);
  };
  useEffect(() => { if (done) vibrate([12, 60, 12]); }, [done]);
  const share = async () => {
    if (!shot || !full) return;
    const how = await shareCard({ field: full, sx: shot.res.sx, sy: shot.res.sy, woke: shot.res.woke.mid, lo: shot.res.woke.lo, hi: shot.res.woke.hi,
      sound: shot.sound.label, place: shot.place, url: window.location.href });
    setShared(how === "shared" ? "Shared" : how === "copied" ? "Link copied, image saved" : null);
    track("share", { how, sound: shot.sound.id });
  };
  const toMap = () => {
    track("honk_to_map", {});
    window.location.hash = `lens=complaints&view=blocks&cell=${block!.h3}`;
  };
  const heldFor = hold ? Math.max(0, now - hold.start) / 1000 : 0;

  const layers = [
    frame && shot && new BitmapLayer({ id: "honk-field", image: frame, bounds: bounds(shot.area) }),
    shot && new ScatterplotLayer({ id: "honk-range", data: [shot], getPosition: (d: Shot) => [d.lon, d.lat], getRadius: RANGE, filled: false, stroked: true,
      getLineColor: [255, 244, 214, done ? 40 : 18], lineWidthUnits: "pixels", getLineWidth: 1, updateTriggers: { getLineColor: [done] } }),
    shot && !done && new ScatterplotLayer({ id: "honk-wave-glow", data: [shot], getPosition: (d: Shot) => [d.lon, d.lat], getRadius: Math.max(1, wave), filled: false, stroked: true,
      getLineColor: [242, 85, 44, Math.round(70 * (1 - wave / RANGE))], lineWidthUnits: "pixels", getLineWidth: 16, updateTriggers: { getRadius: [wave], getLineColor: [wave] } }),
    shot && !done && new ScatterplotLayer({ id: "honk-wave", data: [shot], getPosition: (d: Shot) => [d.lon, d.lat], getRadius: Math.max(1, wave), filled: false, stroked: true,
      getLineColor: [255, 178, 62, Math.round(220 * (1 - wave / RANGE)) + 30], lineWidthUnits: "pixels", getLineWidth: 2, updateTriggers: { getRadius: [wave], getLineColor: [wave] } }),
    shot && done && halfWithin > 0 && new ScatterplotLayer({ id: "honk-half", data: [shot], getPosition: (d: Shot) => [d.lon, d.lat], getRadius: halfWithin, filled: false, stroked: true,
      getLineColor: [255, 244, 214, 150], lineWidthUnits: "pixels", getLineWidth: 1.2 }),
    shot && new TextLayer({ id: "honk-notes", data: [
        ...(done && halfWithin > 0 && size.current.width > 860 ? [{ pos: [shot.lon, shot.lat + halfWithin / 110540] as [number, number], text: "half of those woken live inside this ring", dy: -10 }] : []),
        ...(done ? [{ pos: [shot.lon, shot.lat + RANGE / 110540] as [number, number], text: "600 m: counting stops here", dy: -10 }] : []),
        ...(!done && wave > 60 ? [{ pos: [shot.lon, shot.lat - wave / 110540] as [number, number], text: `${Math.round(wave)} m, ${(wave / SPEED).toFixed(1)} s`, dy: 12 }] : []),
      ], getPosition: (d: { pos: [number, number] }) => d.pos, getText: (d: { text: string }) => d.text, getPixelOffset: (d: { dy: number }) => [0, d.dy],
      getSize: 12, getColor: [238, 240, 247, 230], fontFamily: '"Schibsted Grotesk", system-ui, sans-serif', fontWeight: 600,
      outlineWidth: 3, outlineColor: [7, 9, 15, 230], fontSettings: { sdf: true }, updateTriggers: { getPosition: [wave, done] } }),
    (busy || hold) && new ScatterplotLayer({ id: "honk-pulse", data: [busy ?? hold], getPosition: (d: { lat: number; lon: number }) => [d.lon, d.lat],
      getRadius: hold ? 14 + Math.min(8, heldFor) * 9 : 12 + 10 * ((now / 600) % 1), radiusUnits: "pixels", filled: false, stroked: true,
      getLineColor: [255, 178, 62, hold ? 230 : Math.round(255 * (1 - ((now / 600) % 1)))], lineWidthUnits: "pixels", getLineWidth: 2,
      updateTriggers: { getRadius: [now], getLineColor: [now] } }),
    (shot || busy || hold) && new ScatterplotLayer({ id: "honk-halo", data: [hold ?? busy ?? shot], getPosition: (d: { lat: number; lon: number }) => [d.lon, d.lat],
      getRadius: 18, radiusUnits: "pixels", getFillColor: [255, 178, 62, 55] }),
    (shot || busy || hold) && new ScatterplotLayer({ id: "honk-src", data: [hold ?? busy ?? shot], getPosition: (d: { lat: number; lon: number }) => [d.lon, d.lat],
      getRadius: 6, radiusUnits: "pixels", getFillColor: [255, 178, 62, 255], stroked: true, getLineColor: [7, 9, 15, 255], lineWidthUnits: "pixels", getLineWidth: 2 }),
  ].filter(Boolean);

  const jokes = shot && done ? [
    [Math.round(shot.res.over[62] / 35), "rats scattered"],
    [Math.round(shot.res.over[72] / 180), "pigeons took off"],
    [Math.max(0, Math.round(shot.res.over[58] / 9000)), "bodega cats glared"],
  ] as const : null;

  return (
    <div className="honk">
      <div ref={box} className="honk-map" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <DeckGL viewState={view} onViewStateChange={({ viewState }) => setView(viewState as View)}
          onResize={(s) => { size.current = s; }}
          controller={{ dragRotate: false, touchRotate: false, keyboard: true, doubleClickZoom: false }}
          layers={layers} getCursor={({ isDragging }) => (isDragging ? "grabbing" : "crosshair")}>
          <BaseMap mapStyle={STYLE} reuseMaps attributionControl={{ compact: true }} />
        </DeckGL>
      </div>

      {!shot && !busy && !hold && <div className="coach" aria-hidden="true"><i /><i /><span>Tap anywhere</span></div>}

      <div className="honk-tl">
        <header className={`honk-hero${shot || busy ? " small" : ""}`}>
          <p className="eyebrow">3 a.m. · New York</p>
          <h1>How many New Yorkers did you wake?</h1>
          <p className="lede">Pick a sound, tap a street. The color is how loud it gets outside; the count is who it wakes inside, building by building, floor by floor.</p>
        </header>
        <div className="honk-find">
          <Search onPick={(lat, lon, l) => honkAt(lat, lon, l.split(",")[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()))} placeholder="Honk at an address" />
          <button className="chip sq" onClick={locate} disabled={locating} aria-label="Honk at my location" title="Honk at my location">
            <IconCurrentLocation size={17} stroke={1.8} aria-hidden="true" className={locating ? "spin" : ""} /></button>
        </div>
        <div className="chip-row">
        <button className="chip" aria-pressed={windows !== "open"} onClick={() => setWindows(WINDOWS[(WINDOWS.indexOf(windows) + 1) % 3])}
          title={`Measured median: an open window takes off ${CAL.win.open[1]} dB, tilted ${CAL.win.tilted[1]}, closed ${CAL.win.closed[1]}`}>Windows {windows}</button>
        </div>
        <div className="chip-row">
          <button className="chip sq" onClick={() => setHelp(true)} aria-label="How it is calculated"><IconHelpCircle size={17} stroke={1.8} aria-hidden="true" /></button>
          <button className="chip sq" aria-pressed={muted} onClick={() => setMuted(!muted)} aria-label={muted ? "Turn sound on" : "Mute"}>
            {muted ? <IconVolumeOff size={17} stroke={1.8} aria-hidden="true" /> : <IconVolume size={17} stroke={1.8} aria-hidden="true" />}
          </button>
          <button className="chip sq" onClick={() => setView({ ...view, zoom: Math.min(19, view.zoom + 1) })} aria-label="Zoom in"><IconPlus size={17} stroke={1.8} aria-hidden="true" /></button>
          <button className="chip sq" onClick={() => setView({ ...view, zoom: Math.max(11, view.zoom - 1) })} aria-label="Zoom out"><IconMinus size={17} stroke={1.8} aria-hidden="true" /></button>
        </div>
      </div>

      {(shot || busy || err) && <section className={`honk-count${more ? " more" : ""}${done ? " done" : ""}`} aria-label="People woken">
        <p className="sr-only" aria-live="polite">{done ? `${count(shot.res.woke.mid)} people woke up, range ${count(shot.res.woke.lo)} to ${count(shot.res.woke.hi)}.` : busy ? "Honking…" : ""}</p>
        <div className="big-n" aria-hidden="true"><b className={shot && !done ? "ticking" : ""}>{shot ? count(done ? shot.res.woke.mid : woke) : busy ? "…" : "0"}</b><span>woke up</span></div>
        {done && <p className="range">range <b>{count(shot.res.woke.lo)}</b> to <b>{count(shot.res.woke.hi)}</b>, from measured window losses and an assumed side-street loss</p>}
        {busy && <p className="hint">Measuring every building nearby…</p>}
        {shot && !busy && <>
          <div className="meter" aria-hidden="true"><i style={{ transform: `scaleX(${wave / RANGE})` }} /></div>
          <div className="stats">
            <span><b>{fmt(done ? shot.res.reacted.mid : reacted)}</b>heard it asleep</span>
            <span><b>{Math.round(wave)} m</b>{done ? "heard to" : "and spreading"}</span>
          </div>
          <p className="sub">{shot.sound.label}, {shot.dur < 1 ? shot.dur.toFixed(1) : Math.round(shot.dur)} s, windows {shot.windows}</p>
        </>}
        {done && loudest && <p className="why">The loudest bedroom got <b>{Math.round(loudest.peak)} dB</b>, about as loud as {like(loudest.peak)}.
          {halfWithin > 0 && <> Half the people woken live within <b>{Math.round(halfWithin)} m</b>.</>} Most of the color on the map is people who heard it and slept on.</p>}
        {done && jokes && <>
          <p className="flav">{flavour(shot.res.woke.mid)} <span>{shot.sound.quip}</span></p>
          <div className="nightly">
            <label htmlFor="nightly">If it happens</label>
            <select id="nightly" value={nightly} onChange={(e) => setNightlyAndLink(+e.target.value)}>
              {NIGHTLY.map((n) => <option key={n} value={n}>{n === 1 ? "once a night" : `${n} times a night`}</option>)}
            </select>
            <span>every night, that is about <b>{fmt(shot.res.woke.mid * nightly * 365)}</b> awakenings a year, counting each time someone wakes. Getting used to it is already in there: the wake curve comes from people who live with night flights.</span>
          </div>
          {block && <p className="block311">People on this block file about <b>{fmt(block.perYear)}</b> noise complaints a year to 311 ({fmt(block.expected)} expected).
            One honk woke {count(shot.res.woke.mid)}. Complaints count who calls, not who hears. <button className="linkish" onClick={toMap}>See the block on the noise map</button></p>}
          {block && <button className="report-btn" onClick={() => openReport(true)}>Block report: what keeps this block up at night</button>}
          <ul className="jokes">{jokes.map(([n, l]) => <li key={l}><b>{fmt(n)}</b> {l}</li>)}</ul>
          <div className="actions">
            <button className="share" onClick={share}><IconShare2 size={17} stroke={1.8} aria-hidden="true" />{shared ?? "Share this honk"}</button>
            <button className="more-btn" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
          </div>
        </>}
        {err && <p className="err">{err}</p>}
      </section>}

      <div className="honk-bottom">
        <div className="strip" role="radiogroup" aria-label="Sound">
          {SOUNDS.map((s) => (
            <button key={s.id} role="radio" aria-checked={sound.id === s.id} onClick={() => pick(s)} title={`${s.label}, ${s.db} dB at 7 m`}>
              <Glyph s={s} /><span className="sr-only">{s.label}</span>
            </button>
          ))}
        </div>
        <button className={`honk-btn${hold ? " held" : ""}`} onPointerDown={btnDown} onPointerUp={btnUp} onPointerLeave={btnUp} onKeyDown={btnKey}
          aria-label={`Honk: ${sound.label}. Hold for longer.`}>
          <Glyph s={sound} /><span>{hold ? `${Math.min(8, heldFor).toFixed(1)} s` : "Honk"}</span>
        </button>
        <p className="tip"><b>{sound.label}</b> {sound.db} dB at 7 m{sound.note ? `, ${sound.note}` : ""} · {sound.quip}</p>
      </div>

      <div className="honk-legend" aria-label="Level legend">
        <div className="ramp" style={{ background: rampCss() }} />
        <div className="ticks">{LEGEND.map(([db, l]) => <span key={db}><b>{db}</b>{l}</span>)}</div>
      </div>

      {report && block && shot && <Report c={block.c} i={block.i} place={shot.place} woke={shot.res.woke.mid} sound={shot.sound.label}
        onHear={hear} onClose={() => openReport(false)} />}

      {help && (
        <div className="honk-intro" role="dialog" aria-modal="true" aria-labelledby="honk-help" onClick={(e) => e.target === e.currentTarget && setHelp(false)}>
          <div className="card help">
            <div className="help-head"><h2 id="honk-help">How it is calculated</h2><button className="close" onClick={() => setHelp(false)} aria-label="Close">×</button></div>
            <p>Each honk loads every building within about 750 m (NYC footprints and roof heights, rebuilt with each weekly deploy) and works out the loudest moment on a 4 m grid, then at each floor of each home.</p>
            <h3>The physics</h3>
            <ul>
              <li><b>Spreading.</b> 6 dB less per doubling of distance, plus air absorption that grows with pitch.</li>
              <li><b>Over the roofs.</b> Every building between the source and a window bends the sound over its roof and takes off up to 25 dB, by its height from the city's footprint survey.</li>
              <li><b>Down the street.</b> Sound also travels along the open streets: about 5 dB lost on turning a corner, then a steady extra loss down the side street, an assumption set so the total comes to roughly 20 to 30 dB per 100 m, as a computed street-canyon study found. This stands in for reflections off façades. Each spot takes the louder of the two paths.</li>
              <li><b>Into the home.</b> Measured in 102 homes (Locher et al., 2018), an open window takes off a median 10 dB, a tilted one 16 and a closed one 28. Residents are spread evenly along each building's outside walls and up its floors, and every stretch of wall hears what the air right outside it hears: a back wall onto a quiet yard gets the yard's level. Shared party walls have no windows.</li>
            </ul>
            <h3>From noise to people</h3>
            <ul>
              <li><b>Woke up.</b> Each sleeper's chance of waking comes from the loudest moment in the room (Basner et al., 2006): none below 33 dB, about 6% at 60, about 10% at 73. The curve was fitted up to 73 dB and is extended beyond it.</li>
              <li><b>The range.</b> Every honk is run three times: window losses at their measured quartiles and the side-street loss at its assumed low and high values. The big number is the middle run. The range leaves out the source level (±5 dB) and the wake curve itself, so the truth can fall outside it.</li>
              <li><b>Length.</b> Under a second counts as quieter; each doubling past a second adds 1.5 dB, up to 8 s. Hold to honk longer.</li>
              <li><b>Heard it asleep</b> means above 32 dB in the room, the level where the WHO finds the sleeping body starts to react (a shift in sleep stage, a movement), without necessarily waking.</li>
              <li><b>Who lives where.</b> Homes per tax lot from PLUTO, split across that lot's buildings by volume, at about 2.36 people per home so the city adds up to the 2020 Census (8,804,190). 95% of them are counted as asleep, the share of Americans asleep at 3 a.m. in the American Time Use Survey.</li>
              <li><b>Every night.</b> Repeats are added up, so the yearly figure counts awakenings, not people: one light sleeper can wake many times. No extra discount for getting used to it, because the wake curve already includes it. It was measured in 64 people living near Cologne/Bonn, a busy night-cargo airport, and counts only awakenings beyond the ones they'd have anyway; in the lab, the same levels wake people far more often. A horn isn't a plane, so treat the total as an estimate.</li>
              <li>The rats, pigeons and bodega cats are a joke. The supers are real.</li>
            </ul>
            <h3>Limits</h3>
            <p>The source stands still, and nobody past 600 m is counted, so the loudest sources are undercounted. No terrain, no trees, no single-bounce reflections, and building heights are roof heights, not every setback. Expect ±3 to 5 dB with a clear line of sight and ±5 to 10 dB deep inside a block. Source levels are typical values, ±5 dB.</p>
            <p className="fine">Data: NYC building footprints and MapPLUTO (NYC Open Data), basemap © CARTO, © OpenStreetMap. Idea and method after Ofir Shifman's Tel Aviv honk map, rebuilt for New York with its own data and sounds.</p>
          </div>
        </div>
      )}
    </div>
  );
}
