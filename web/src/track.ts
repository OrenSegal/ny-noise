// Vercel Web Analytics, without the npm package: the script is served by Vercel once Analytics is on for the project.
// Custom events need a plan that includes them; until then they are dropped and page views still count.
type VA = ((kind: "event", e: { name: string; data?: Record<string, string | number | boolean> }) => void) & { q?: unknown[] };
declare global { interface Window { va?: VA; vaq?: unknown[] } }

export function startAnalytics() {
  if (import.meta.env.DEV || window.va) return;
  window.va = ((...a: unknown[]) => { (window.vaq ??= []).push(a); }) as VA;
  const s = document.createElement("script");
  s.defer = true; s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
}

export const track = (name: string, data: Record<string, string | number | boolean> = {}) => window.va?.("event", { name, data });
