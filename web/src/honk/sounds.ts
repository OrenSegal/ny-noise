// NYC night sounds: levels for the model, a synthesized voice for the speaker. Icons live in Honk.tsx.
import type { Src } from "./physics";

type Band = "low" | "mid" | "high";
export type Sound = { id: string; label: string; group: string; db: number; dur: number; hs: number; band: Band; quip: string; note?: string;
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

export const SOUNDS: Sound[] = [
  { id: "horn", quip: "Leaning on it because the light turned green a full half second ago.", label: "Car horn", group: "Street", db: 94, dur: 1, hs: 0.8, band: "mid", voice: horn([415, 498], 2600, 0.12) },
  { id: "cab", quip: "Two taps: cab for \"I see you, I'm not stopping.\"", label: "Cab horn, twice", group: "Street", db: 92, dur: 0.6, hs: 0.8, band: "mid", voice: (c, o) => { const g = gate(c, 3.2); g.node.connect(o); return [...horn([440, 554], 2800, 0.12)(c, g.node), g.src]; } },
  { id: "alarm", quip: "In the history of New York, nobody has ever checked on a car alarm.", label: "Car alarm", group: "Street", db: 98, dur: 8, hs: 0.8, band: "high", voice: siren("square", 1100, 450, 5, "sawtooth") },
  { id: "moto", quip: "Revved twice, for the people in the back.", label: "Loud motorcycle", group: "Street", db: 96, dur: 3, hs: 0.7, band: "low", voice: (c, o) => { const lp = filt(c, "lowpass", 700), g = gain(c, 0.2); chain(lp, g, o); const a = osc(c, "sawtooth", 52), b = osc(c, "sawtooth", 78); a.connect(lp); b.connect(lp); return [a, b, lfo(c, "triangle", 0.6, 18, a.frequency), lfo(c, "triangle", 0.6, 27, b.frequency)]; } },
  { id: "fdny", quip: "The one honk the whole block forgives.", label: "Fire truck air horn", group: "Emergency", db: 110, dur: 2, hs: 2.5, band: "low", voice: horn([174, 220, 261], 1600, 0.09, "sawtooth") },
  { id: "nypd", quip: "Two whoops at the red light, then gone.", label: "Police siren", group: "Emergency", db: 104, dur: 8, hs: 1.5, band: "high", voice: siren("sawtooth", 1050, 480, 4.2, "triangle") },
  { id: "ems", quip: "Also forgiven. Go back to sleep.", label: "Ambulance", group: "Emergency", db: 105, dur: 8, hs: 2, band: "mid", voice: siren("sine", 950, 380, 0.3, "triangle") },
  { id: "garbage", quip: "Comes at 3 a.m. so it won't block traffic. It blocks sleep instead.", label: "3 a.m. garbage truck", group: "Machines", db: 88, dur: 8, hs: 2, band: "low", voice: (c, o) => [...noisy("lowpass", 180, 0.5, 0.3, 0.7, "sine")(c, o), ...(() => { const g = gate(c, 1); const b = osc(c, "sine", 1050), v = gain(c, 0.05); chain(b, g.node, v, o); return [b, g.src]; })()] },
  { id: "el", quip: "The El has been announcing itself to the avenue below for a century.", label: "Elevated subway", group: "Machines", db: 95, dur: 8, hs: 9, band: "mid", note: "on the El, 9 m up", voice: (c, o) => [...noisy("bandpass", 520, 1.1, 6.5, 0.6, "sawtooth")(c, o), ...(() => { const s = osc(c, "sine", 2900), g = gain(c, 0.012); chain(s, g, o); return [s, lfo(c, "sine", 0.4, 120, s.frequency)]; })()] },
  { id: "jack", quip: "Emergency gas work. Again. Same hole as last month.", label: "Jackhammer", group: "Machines", db: 100, dur: 8, hs: 1, band: "mid", voice: noisy("highpass", 900, 0.6, 17) },
  { id: "heli", quip: "Circling for forty minutes. Nobody will ever find out why.", label: "Police helicopter", group: "Machines", db: 108, dur: 8, hs: 150, band: "low", note: "hovering 150 m up", voice: noisy("lowpass", 420, 1.3, 11, 0.7, "sawtooth") },
  { id: "party", quip: "Somebody's cousin brought a speaker the size of a fridge.", label: "Block party speaker", group: "Night life", db: 102, dur: 8, hs: 1.2, band: "low", voice: (c, o) => { const k = osc(c, "sine", 52), kg = gate(c, 2, "sawtooth"), lv = gain(c, 0.5); chain(k, kg.node, lv, o); const b = osc(c, "sawtooth", 82), bf = filt(c, "lowpass", 260), bg = gate(c, 4), bl = gain(c, 0.1); chain(b, bf, bg.node, bl, o); return [k, kg.src, b, bg.src]; } },
  { id: "bar", quip: "Last call is 4 a.m. The goodbyes take until 4:40.", label: "Bar letting out", group: "Night life", db: 85, dur: 8, hs: 1.6, band: "mid", voice: (c, o) => { const n = noise(c), f = filt(c, "bandpass", 850, 1.4), g = gain(c, 0.6); chain(n, f, g, o); return [n, lfo(c, "sine", 0.7, 0.35, g.gain), lfo(c, "triangle", 1.9, 250, f.frequency)]; } },
  { id: "bell", quip: "Your pad thai has arrived, and so has everyone's awareness of it.", label: "Delivery e-bike bell", group: "Night life", db: 70, dur: 0.3, hs: 1, band: "high", voice: (c, o) => { const g = gate(c, 1.7, "sawtooth"), v = gain(c, 0.08); chain(g.node, v, o); const a = osc(c, "sine", 2650), b = osc(c, "sine", 3970); a.connect(g.node); b.connect(g.node); return [a, b, g.src]; } },
];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Start a sound now; it plays until stop() (or for `seconds`). The context starts on the first gesture, as browsers require. */
export function play(s: Sound, seconds?: number) {
  ctx ??= new AudioContext();
  if (!master) { master = gain(ctx, 0.5);
    // a brick-wall limiter: some voices are loud by design, nobody's speakers or ears should be
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -12; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.2;
    chain(master, lim, ctx.destination); }
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
  setTimeout(stop, Math.min(seconds ?? 8, 8) * 1000); // a held sound stops at 8 s, which is also where the model stops counting
  return stop;
}
