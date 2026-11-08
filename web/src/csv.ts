import { cellToLatLng } from "h3-js";
import type { Bundle } from "./data";

/** Build the block table in the browser and hand it to the user as a CSV file. */
export function downloadCsv(b: Bundle) {
  const c = b.cells;
  const head = ["h3", "lat", "lon", "complaints_per_year", "complaint_days_per_year", "reports_per_year", "top_address_share", "expected_per_year", "observed_over_expected", "night_share", "residential_units", ...c.features];
  const rows = c.h3.map((h, i) => {
    const [lat, lon] = cellToLatLng(h);
    return [h, lat.toFixed(5), lon.toFixed(5), (c.complaints[i] / c.years).toFixed(1), (c.days[i] / c.years).toFixed(1), (c.reports[i] / c.years).toFixed(1), c.top_share[i], (c.oof[i] / c.years).toFixed(1),
      ((c.complaints[i] + 1) / (c.oof[i] + 1)).toFixed(3), c.night[i], c.units[i], ...c.features.map((_, k) => c.x[k][i])].join(",");
  });
  const url = URL.createObjectURL(new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `nyc-noise-blocks-${c.window[1]}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
