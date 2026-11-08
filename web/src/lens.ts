// Turn a lens into a classed map: per-cell values, 7 bins with readable breaks, colours and counts.
import { type Cells, type Spatial, feet, fmt, thermal } from "./data";

export type Lens = "complaints" | "exposure" | "expected" | "anomaly" | "factor";
export type TimeOfDay = "all" | "day" | "night";
export type RGB = [number, number, number];
export type Classed = {
  value: Float64Array; cls: Int8Array; breaks: number[]; labels: string[]; colors: RGB[]; counts: number[];
  title: string; unit: string; format: (v: number) => string;
};

const SEQ: RGB[] = [0.1, 0.24, 0.38, 0.52, 0.66, 0.82, 0.98].map((t) => thermal(t).slice(0, 3) as RGB);
const DIV: RGB[] = [[63, 208, 224], [46, 143, 168], [42, 76, 110], [62, 58, 86], [179, 64, 122], [242, 85, 44], [255, 178, 62]];
const RATIO_BREAKS = [0.5, 0.67, 0.9, 1.1, 1.5, 2];

/** Round to 1, 2, 2.5 or 5 times a power of ten so breaks read like a printed legend. */
function nice(v: number) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

function quantileBreaks(values: ArrayLike<number>, qs: number[], round: boolean) {
  const s = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const q of qs) {
    const raw = s[Math.min(s.length - 1, Math.floor(q * s.length))];
    const b = round ? nice(raw) : raw;
    if (!out.length || b > out[out.length - 1]) out.push(b);
  }
  return out;
}

function rawValue(cells: Cells, lens: Lens, month: number, factor: number, i: number, tod: TimeOfDay = "all") {
  if (lens === "complaints") {
    if (month >= 0) return cells.monthly[i][month] * 12;
    const share = tod === "night" ? cells.night[i] : tod === "day" ? 1 - cells.night[i] : 1;
    return (cells.complaints[i] * share) / cells.years;
  }
  if (lens === "expected") return cells.oof[i] / cells.years;
  if (lens === "anomaly") return (cells.complaints[i] + 1) / (cells.oof[i] + 1);
  return cells.x[factor][i];
}

export function classify(cells: Cells, spatial: Spatial, lens: Lens, month: number, factor: number, tod: TimeOfDay = "all"): Classed {
  const n = cells.h3.length;
  const value = new Float64Array(n);
  for (let i = 0; i < n; i++) value[i] = rawValue(cells, lens, month, factor, i, month >= 0 ? "all" : tod);
  const fname = cells.features[factor];
  const isDist = lens === "factor" && fname.startsWith("d_");

  // Breaks come from the whole two-year window so a month in the replay is read on the same scale.
  let breaks: number[];
  let format: (v: number) => string;
  if (lens === "anomaly") {
    breaks = RATIO_BREAKS;
    format = (v) => `${v.toFixed(v < 1 ? 2 : 1)}x`;
  } else if (lens === "factor") {
    breaks = quantileBreaks(value, [1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7], false);
    format = isDist ? feet : (v) => (fname.endsWith("_exposure") ? fmt(v, 2) : fmt(v));
  } else {
    const base = new Float64Array(n);
    for (let i = 0; i < n; i++) base[i] = rawValue(cells, lens, -1, factor, i, month >= 0 ? "all" : tod);
    breaks = quantileBreaks(base, [0.2, 0.4, 0.6, 0.75, 0.88, 0.96], true);
    format = (v) => fmt(v);
  }

  const k = breaks.length + 1;
  const ramp = lens === "anomaly" ? DIV : SEQ;
  const palette = Array.from({ length: k }, (_, j) => ramp[Math.round((j / Math.max(k - 1, 1)) * (ramp.length - 1))]);
  const colors = isDist ? palette.slice().reverse() : palette; // nearer is hotter for distances
  const cls = new Int8Array(n);
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    let c = 0;
    while (c < breaks.length && value[i] >= breaks[c]) c++;
    cls[i] = c;
    counts[c]++;
  }
  const labels = Array.from({ length: k }, (_, j) =>
    j === 0 ? `under ${format(breaks[0])}` : j === k - 1 ? `${format(breaks[k - 2])} and up` : `${format(breaks[j - 1])} to ${format(breaks[j])}`);
  const meta = spatial.features[fname];
  const title = lens === "complaints" ? (month >= 0 ? "Complaints, annualised month" : tod === "night" ? "Night complaints a year (22-06)" : tod === "day" ? "Day complaints a year (06-22)" : "Complaints a year")
    : lens === "expected" ? "Expected complaints a year, from the block's fabric"
    : lens === "anomaly" ? "Observed against expected" : meta?.label ?? fname;
  const unit = lens === "factor" ? meta?.unit ?? "" : lens === "anomaly" ? "ratio" : "per year";
  return { value, cls, breaks, labels, colors, counts, title, unit, format };
}
