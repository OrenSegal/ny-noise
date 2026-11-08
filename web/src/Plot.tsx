import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

/** Render an Observable Plot spec into a div; rebuilds when deps change and on resize. */
export default function PlotFigure({ make, deps, label }: { make: (width: number) => ReturnType<typeof Plot.plot>; deps: unknown[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const node = make(el.clientWidth || 640);
      el.replaceChildren(node);
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div ref={ref} role="img" aria-label={label} />;
}

export const plotStyle = { background: "transparent", color: "#A9B0C6", fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif", fontSize: "12px", overflow: "visible" };
export { Plot };
