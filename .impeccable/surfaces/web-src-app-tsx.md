---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: []
---

# Surface brief: web/src/App.tsx (NYC Noise, React + deck.gl on Vercel)

Scope: the whole web app; replaces the Streamlit dashboard. Visitor mode: Experience for the first viewport (the map is the work), Operate below it (drivers, forecast, scorecard).
Audience: reviewers of the owner's work and NYC residents/venues, equal weight. Jobs: feel where the city is loud; click a spot and learn what is associated with its noise; check next week's ZIP forecast; verify both models' evaluation.
Constraints: static JSON exported by the Python pipeline, no runtime API; drivers are associations, never causes; complaints are reports, not decibels; the spatial model explains, the ZIP model forecasts, and the two are never blurred. Reduced motion stops all ripples and playback.
Pinned by the user: immersive, sound-like, "heat field + ripples", React + deck.gl, not solid circles.

## Direction contract

THESIS: The city as a thermal sound field. Noise is drawn as heat rising off the street grid and as rings travelling outward from the loudest places, so the visitor hears the map before reading it. Refuses the dot map, the choropleth and the card dashboard.
OWN-WORLD: Night city on near-black blue (#07090F). A thermal ramp from cold indigo through magenta and ember orange to white-hot carries all intensity; one cool cyan marks "quieter than expected". Extruded H3 hexes form a heat terrain; expanding stroked rings pulse from hotspots at a rate set by how far above normal they run. Bricolage Grotesque for display, Geist for UI and numbers (tabular). Panels are solid ink with a 1px hairline, no glass.
STORY: The visitor lands inside the sound field, scrubs two years of months and watches the city breathe, clicks a block and reads its top drivers as multipliers ("bars within 300 m: x1.8"), then scrolls to see which factors matter citywide, next week's ZIP forecast, and how honestly both models were scored.
FIRST VIEWPORT: Full-bleed tilted map of the five boroughs. Top-left: title and one-line thesis. Left rail: lens switch (Complaints, Expected from city fabric, Louder than expected, Driver lens). Bottom: month scrubber with play. Right: the cell drawer opens on click. Primary action: click a hex.
FORM: user-pinned direction (heat field + ripples), no concept roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
