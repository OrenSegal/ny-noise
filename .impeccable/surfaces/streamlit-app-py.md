---
version: 1
slug: "streamlit-app-py"
primary_target: "streamlit_app.py"
related_targets: []
---

# Surface brief: streamlit_app.py (NYC Noise Forecast dashboard)

Scope: the whole dashboard. Visitor mode: Operate.
Audience: reviewers of the owner's work and NYC residents or venue operators, equal weight. Job: find a ZIP's next-week outlook in seconds; verify the evaluation in a minute.
Constraints: Streamlit on Community Cloud, committed tables only, no tiles or WebGL, no emoji, no invented data. Honest result must stay visible (about 4% better than persistence, loses the Nov 2025 quarter).
Interaction requested: linked views, backtest scrubber, baseline race, compare ZIPs.
Unresolved: none.

## Direction contract

THESIS: A statistical-atlas plate for next week's noise. One classed choropleth whose legend is a histogram of ZIPs that doubles as the filter for every other view. Refuses the KPI-card grid and the continuous heat-blob map.
OWN-WORLD: Walker's 1874 Statistical Atlas, reborn as a working tool. Cool map-paper ground, navy-black ink, hairline rules, five graded class tints from deep teal through warm neutral to vermilion, every mark outlined in ink. Libre Franklin for all data and controls (tabular numerals), Source Serif 4 only for plate titles and italic captions that sit under figures and say how to read them. Recognizable with content removed: framed plates, italic captions, banded legend strips.
STORY: The visitor finds a ZIP, sees it against its own normal, pins up to three, replays how the forecast behaved in past weeks, and ends convinced (or not) by the baseline race, including the quarter the model loses.
FIRST VIEWPORT: Left 60%: the classed map plate with its title and a band strip (five segments with ZIP counts) directly under it. Right 40%: a ranked, sortable table of ZIPs with forecast, an 80% range bar and a vs-typical bar. Above both: one plain sentence stating the citywide forecast, its change from last week, and how many ZIPs sit above their norm, then a tab row (Outlook, ZIP, Compare, Scorecard, When). Primary action: click a ZIP.
FORM: Walker atlas plate, position 4 of my grounded list (MTA manual, Du Bois portraits, Sanborn colour code, Walker atlas, noise-code dB poster, Weather Bureau map, small multiples), seed key 8ea405df. Signature move: the band strip as legend, filter and histogram in one.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
