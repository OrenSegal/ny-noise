// Runs the simulation off the main thread so the reveal pulse never stalls. Keeps the last area to avoid re-sending it.
import { type Area, type Src, type Windows, simulate } from "./physics";

let area: Area | null = null;
self.onmessage = (e: MessageEvent<{ id: number; area?: Area; src: Src; gx: number; gy: number; windows: Windows }>) => {
  const { id, src, gx, gy, windows } = e.data;
  if (e.data.area) area = e.data.area;
  try {
    const res = simulate(area!, src, gx, gy, windows);
    (self as unknown as Worker).postMessage({ id, res }, [res.field.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
