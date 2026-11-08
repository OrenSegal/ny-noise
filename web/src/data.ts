// Shapes of the JSON written by nynoise/export.py, plus colour and formatting helpers.

export type Cells = {
  months: string[]; window: [string, string]; years: number; features: string[]; types: string[];
  h3: string[]; complaints: number[]; reports: number[]; expected: number[]; oof: number[]; base: number[]; units: number[]; night: number[];
  type_counts: number[][]; monthly: number[][]; x: number[][];
  drivers: [number, number][][]; quieters: [number, number][][];
};
export type FeatureMeta = { label: string; group: string; unit: string };
export type Score = { d2_poisson: number; spearman: number; mae: number };
export type Spatial = {
  cells: number; cv: string; spatial_cv: { full: Score; units_only: Score }; random_cv_full: Score;
  skill_d2_over_units_only: number; importance: Record<string, number>;
  curves: Record<string, { x: number[]; effect: number[] }>;
  checks: { type: string; feature: string; expected_sign: number; spearman: number; agrees: boolean; decile_mean: number[]; decile_x: number[] }[];
  features: Record<string, FeatureMeta>;
};
export type Zip = { zip: string; lat: number; lon: number; pred: number; lo: number; hi: number; last: number; typical: number;
  n: number[]; bt: { pred: (number | null)[]; lo: (number | null)[]; hi: (number | null)[]; actual: (number | null)[] } };
export type Forecast = { target_week: string; weeks: string[]; bt_weeks: string[]; zips: Zip[] };
export type Scorecard = {
  best_model: string; best_baseline: string; wape_skill_vs_best_baseline: number;
  holdout: Record<string, Record<string, number>>; holdout_weeks: [string, string];
  interval: { nominal: number; empirical_coverage: number }; interval_by_zip: { median: number; p10: number; min: number };
  rolling_origin: Record<string, any>[];
  race: { weeks: string[] } & Record<string, (number | null)[]>; weekly_coverage: (number | null)[]; surges: string[];
  model_labels: Record<string, string>;
};
export type Hourly = { type: string[]; dow: number[]; hour: number[]; n: number[] };
export type Manifest = { built_at: string; raw_rows: number; zips: number; first_week: string; last_week: string };
export type Bundle = { cells: Cells; spatial: Spatial; forecast: Forecast; score: Scorecard; hourly: Hourly; manifest: Manifest };

export async function loadAll(): Promise<Bundle> {
  const get = (f: string) => fetch(`/data/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); });
  const [cells, spatial, forecast, score, hourly, manifest] = await Promise.all(
    ["cells.json", "spatial.json", "forecast.json", "scorecard.json", "hourly.json", "manifest.json"].map(get));
  return { cells, spatial, forecast, score, hourly, manifest };
}

// Thermal ramp: cold indigo -> magenta -> ember -> amber -> white hot.
export const THERMAL: [number, number, number][] = [[24, 16, 64], [91, 26, 138], [194, 24, 122], [242, 85, 44], [255, 178, 62], [255, 244, 214]];
export const COLD: [number, number, number] = [63, 208, 224];
export const rampCss = (stops = THERMAL) => `linear-gradient(90deg, ${stops.map((c) => `rgb(${c.join(",")})`).join(", ")})`;

export function thermal(t: number, alpha = 255): [number, number, number, number] {
  const v = Math.max(0, Math.min(1, t)) * (THERMAL.length - 1);
  const i = Math.min(THERMAL.length - 2, Math.floor(v));
  const f = v - i;
  const [a, b] = [THERMAL[i], THERMAL[i + 1]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, alpha];
}

/** Diverging: quieter than expected (cold cyan) <- neutral -> louder (thermal). r is log2(observed / expected). */
export function diverging(r: number, alpha = 255): [number, number, number, number] {
  if (r >= 0) return thermal(0.35 + Math.min(r / 2, 1) * 0.65, alpha);
  const f = Math.min(-r / 2, 1);
  const base = [40, 34, 80];
  return [base[0] + (COLD[0] - base[0]) * f, base[1] + (COLD[1] - base[1]) * f, base[2] + (COLD[2] - base[2]) * f, alpha];
}

export const TYPE_COLORS: Record<string, string> = {
  residential: "#C2187A", street: "#F2552C", vehicle: "#FFB23E", commercial: "#8E5CF7",
  helicopter: "#3FD0E0", park: "#7BD88F", other: "#5B6380",
};
export const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
export const feet = (ft: number) => (ft >= 5280 ? `${(ft / 5280).toFixed(1)} mi` : `${Math.round(ft / 10) * 10} ft`);
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
