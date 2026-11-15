// NYC night sounds: levels for the model, a synthesized voice for the speaker, a small drawn icon for the picker.
import type { Src } from "./physics";

type Band = "low" | "mid" | "high";
export type Sound = { id: string; label: string; group: string; db: number; dur: number; hs: number; band: Band; icon: string; note?: string;
  voice: (ctx: AudioContext, out: AudioNode) => AudioScheduledSourceNode[] };

const BAND = { low: { lam: 1.4, air: 0.002 }, mid: { lam: 0.7, air: 0.004 }, high: { lam: 0.34, air: 0.009 } } as const;
export const toSrc = (s: Sound, dur: number): Src => ({ db: s.db, dur, hs: s.hs, ...BAND[s.band] });

// --- tiny synth kit: every voice is oscillators and noise, so holding a sound just keeps them running
const osc = (ctx: AudioContext, type: OscillatorType, f: number) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
const gain = (ctx: AudioContext, g: number) => { const n = ctx.createGain(); n.gain.value = g; return n; };
const filt = (ctx: AudioContext, type: BiquadFilterType, f: number, q = 0.8) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
let noiseBuf: AudioBuffer | null = null;
const noise = (ctx: AudioContext) => {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
};
/** An LFO driving `param` around its current value by +-depth. */
const lfo = (ctx: AudioContext, type: OscillatorType, rate: number, depth: number, param: AudioParam) => {
  const o = osc(ctx, type, rate), g = gain(ctx, depth); o.connect(g).connect(param); return o;
};
/** Gate: gain swings 0..1 at `rate` (square = on/off, sawtooth = struck and decaying). */
const gate = (ctx: AudioContext, rate: number, type: OscillatorType = "square") => {
  // a rising sawtooth flipped by a negative depth gives strike-then-decay
  const g = gain(ctx, 0.5); return { node: g, src: lfo(ctx, type, rate, type === "sawtooth" ? -0.5 : 0.5, g.gain) };
};
const chain = (...n: AudioNode[]) => { for (let i = 0; i + 1 < n.length; i++) n[i].connect(n[i + 1]); return n[0]; };

const horn = (freqs: number[], cut: number, level: number, wave: OscillatorType = "square") => (ctx: AudioContext, out: AudioNode) => {
  const lp = filt(ctx, "lowpass", cut), g = gain(ctx, level);
  chain(lp, g, out);
  return freqs.map((f) => { const o = osc(ctx, wave, f); o.connect(lp); return o; });
};
const siren = (type: OscillatorType, centre: number, depth: number, rate: number, shape: OscillatorType) => (ctx: AudioContext, out: AudioNode) => {
  const o = osc(ctx, type, centre), g = gain(ctx, 0.16), lp = filt(ctx, "lowpass", 3500);
  chain(o, lp, g, out);
  return [o, lfo(ctx, shape, rate, depth, o.frequency)];
};
const noisy = (type: BiquadFilterType, f: number, level: number, rate: number, q = 0.8, shape: OscillatorType = "square") => (ctx: AudioContext, out: AudioNode) => {
  const n = noise(ctx), fl = filt(ctx, type, f, q), gt = gate(ctx, rate, shape), g = gain(ctx, level);
  chain(n, fl, gt.node, g, out);
  return [n, gt.src];
};

// Simple stroked glyphs on a 32x24 box; amber accents use the class "a".
const car = "M4 16h24v-3l-4-1-3-4H11l-4 4-3 1z";
const wheels = "M10 16a2.5 2.5 0 1 0 .01 0M22 16a2.5 2.5 0 1 0 .01 0";

export const SOUNDS: Sound[] = [
  { id: "horn", label: "Car horn", group: "Street", db: 94, dur: 1, hs: 0.8, band: "mid", icon: `${car}${wheels}`, voice: horn([415, 498], 2600, 0.12) },
  { id: "cab", label: "Cab horn, twice", group: "Street", db: 92, dur: 0.6, hs: 0.8, band: "mid", icon: `${car}${wheels}M13 8v-3h6v3`, voice: (c, o) => { const g = gate(c, 3.2); g.node.connect(o); return [...horn([440, 554], 2800, 0.12)(c, g.node), g.src]; } },
  { id: "alarm", label: "Car alarm", group: "Street", db: 98, dur: 8, hs: 0.8, band: "high", icon: `${car}${wheels}M2 6c1-2 3-3 5-3M30 6c-1-2-3-3-5-3`, voice: siren("square", 1100, 450, 5, "sawtooth") },
  { id: "moto", label: "Loud motorcycle", group: "Street", db: 96, dur: 3, hs: 0.7, band: "low", icon: "M7 17a4 4 0 1 0 .01 0M25 17a4 4 0 1 0 .01 0M7 17l6-7h6l6 7M15 10l-2-3h-3", voice: (c, o) => { const lp = filt(c, "lowpass", 700), g = gain(c, 0.2); chain(lp, g, o); const a = osc(c, "sawtooth", 52), b = osc(c, "sawtooth", 78); a.connect(lp); b.connect(lp); return [a, b, lfo(c, "triangle", 0.6, 18, a.frequency), lfo(c, "triangle", 0.6, 27, b.frequency)]; } },
  { id: "fdny", label: "Fire truck air horn", group: "Emergency", db: 110, dur: 2, hs: 2.5, band: "low", icon: "M2 17h28v-8H19l-3-4H8L6 9H2zM4 8l14-4M9 20a2 2 0 1 0 .01 0M24 20a2 2 0 1 0 .01 0", voice: horn([174, 220, 261], 1600, 0.09, "sawtooth") },
  { id: "nypd", label: "Police siren", group: "Emergency", db: 104, dur: 8, hs: 1.5, band: "high", icon: `${car}${wheels}M12 7h8M14 4h4`, voice: siren("sawtooth", 1050, 480, 4.2, "triangle") },
  { id: "ems", label: "Ambulance", group: "Emergency", db: 105, dur: 8, hs: 2, band: "mid", icon: "M3 17h26v-9H14V5H5L3 9zM19 9v6M16 12h6M9 19a2 2 0 1 0 .01 0M23 19a2 2 0 1 0 .01 0", voice: siren("sine", 950, 380, 0.3, "triangle") },
  { id: "garbage", label: "3 a.m. garbage truck", group: "Machines", db: 88, dur: 8, hs: 2, band: "low", icon: "M3 17h20V7H3zM23 17h6v-6l-3-3h-3M8 20a2 2 0 1 0 .01 0M24 20a2 2 0 1 0 .01 0M7 10h12", voice: (c, o) => [...noisy("lowpass", 180, 0.5, 0.3, 0.7, "sine")(c, o), ...(() => { const g = gate(c, 1); const b = osc(c, "sine", 1050), v = gain(c, 0.05); chain(b, g.node, v, o); return [b, g.src]; })()] },
  { id: "el", label: "Elevated subway", group: "Machines", db: 95, dur: 8, hs: 9, band: "mid", note: "on the El, 9 m up", icon: "M2 9h28v6H2zM6 15v6M26 15v6M16 15v6M5 12h4M12 12h4M19 12h4", voice: (c, o) => [...noisy("bandpass", 520, 1.1, 6.5, 0.6, "sawtooth")(c, o), ...(() => { const s = osc(c, "sine", 2900), g = gain(c, 0.012); chain(s, g, o); return [s, lfo(c, "sine", 0.4, 120, s.frequency)]; })()] },
  { id: "jack", label: "Jackhammer", group: "Machines", db: 100, dur: 8, hs: 1, band: "mid", icon: "M14 3h4v4h-4zM11 7h10v3H11zM15 10h2v8h-2zM16 18l-1 3h2z", voice: noisy("highpass", 900, 0.6, 17) },
  { id: "heli", label: "Police helicopter", group: "Machines", db: 108, dur: 8, hs: 150, band: "low", note: "hovering 150 m up", icon: "M4 6h24M16 6v3M9 9h11l4 4-3 3H11l-3-3zM24 12h5M12 16v3M20 16v3M10 19h12", voice: noisy("lowpass", 420, 1.3, 11, 0.7, "sawtooth") },
  { id: "party", label: "Block party speaker", group: "Night life", db: 102, dur: 8, hs: 1.2, band: "low", icon: "M9 3h14v18H9zM16 15a3 3 0 1 0 .01 0M16 7a1.5 1.5 0 1 0 .01 0", voice: (c, o) => { const k = osc(c, "sine", 52), kg = gate(c, 2, "sawtooth"), lv = gain(c, 0.5); chain(k, kg.node, lv, o); const b = osc(c, "sawtooth", 82), bf = filt(c, "lowpass", 260), bg = gate(c, 4), bl = gain(c, 0.1); chain(b, bf, bg.node, bl, o); return [k, kg.src, b, bg.src]; } },
  { id: "bar", label: "Bar letting out", group: "Night life", db: 85, dur: 8, hs: 1.6, band: "mid", icon: "M8 10a3 3 0 1 0 .01 0M16 8a3 3 0 1 0 .01 0M24 10a3 3 0 1 0 .01 0M3 21c0-4 3-6 5-6s5 2 5 6M11 21c0-5 3-7 5-7s5 2 5 7M19 21c0-4 3-6 5-6s5 2 5 6", voice: (c, o) => { const n = noise(c), f = filt(c, "bandpass", 850, 1.4), g = gain(c, 0.6); chain(n, f, g, o); return [n, lfo(c, "sine", 0.7, 0.35, g.gain), lfo(c, "triangle", 1.9, 250, f.frequency)]; } },
  { id: "bell", label: "Delivery e-bike bell", group: "Night life", db: 70, dur: 0.3, hs: 1, band: "high", icon: "M6 17a4 4 0 1 0 .01 0M26 17a4 4 0 1 0 .01 0M6 17l5-7h9l6 7M20 10l1-4h3M14 10l3 7", voice: (c, o) => { const g = gate(c, 1.7, "sawtooth"), v = gain(c, 0.08); chain(g.node, v, o); const a = osc(c, "sine", 2650), b = osc(c, "sine", 3970); a.connect(g.node); b.connect(g.node); return [a, b, g.src]; } },
];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Start a sound now; it plays until stop() (or for `seconds`). The context starts on the first gesture, as browsers require. */
export function play(s: Sound, seconds?: number) {
  ctx ??= new AudioContext();
  if (!master) { master = gain(ctx, 0.7); chain(master, ctx.createDynamicsCompressor(), ctx.destination); }
  void ctx.resume();
  const env = gain(ctx, 0), t = ctx.currentTime;
  env.connect(master);
  env.gain.setTargetAtTime(1, t, 0.01);
  const nodes = s.voice(ctx, env);
  nodes.forEach((n) => n.start(t));
  let stopped = false;
  const stop = () => {
    if (stopped || !ctx) return;
    stopped = true;
    const e = ctx.currentTime;
    env.gain.cancelScheduledValues(e); env.gain.setTargetAtTime(0, e, 0.04);
    nodes.forEach((n) => n.stop(e + 0.3));
  };
  if (seconds !== undefined) setTimeout(stop, seconds * 1000);
  return stop;
}
