---
name: NYC Noise
description: New York as a thermal sound field. Heat rises off a 250 m hex grid and rings pulse from the loudest blocks.
colors:
  night: "#07090F"
  night-2: "#0D1120"
  panel: "#10152A"
  hair: "#26304D"
  ink: "#EEF0F7"
  ink-2: "#A9B0C6"
  ink-3: "#7E86A1"
  thermal-indigo: "#181040"
  thermal-violet: "#5B1A8A"
  magenta: "#C2187A"
  ember: "#F2552C"
  amber: "#FFB23E"
  hot: "#FFF4D6"
  cold: "#3FD0E0"
  data-slate: "#5B6380"
  data-violet: "#8E5CF7"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Avenir Next Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.4rem, 5.6vw, 4.6rem)"
    fontWeight: 760
    lineHeight: 0.9
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Bricolage Grotesque, Avenir Next Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(1.9rem, 3.6vw, 3rem)"
    fontWeight: 720
    lineHeight: 0.98
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Bricolage Grotesque, Avenir Next Condensed, Arial Narrow, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Bricolage Grotesque, Avenir Next Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  body:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  lede:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Schibsted Grotesk, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    letterSpacing: "0.02em"
rounded:
  bar: "3px"
  inner: "7px"
  control: "8px"
  panel: "10px"
  bar-wide: "12px"
  drawer: "14px"
  pill: "999px"
spacing:
  edge-mobile: "16px"
  edge: "28px"
  grid-gap: "40px"
  section: "56px"
  sheet-top: "96px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.panel}"
    padding: "12px 14px"
  drawer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.drawer}"
    padding: "20px 20px 24px"
    width: "min(400px, calc(100% - 32px))"
  scrubber:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.bar-wide}"
    padding: "12px 16px"
  seg-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.inner}"
    padding: "9px 12px"
  seg-button-hover:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.ink}"
  seg-button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.night}"
  pill:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  pill-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.night}"
  play:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.night}"
    rounded: "50%"
    size: "40px"
  close:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    size: "34px"
  select:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  table-row-selected:
    backgroundColor: "{colors.night-2}"
    textColor: "{colors.ink}"
---

# Design System: NYC Noise

## Overview

**Creative North Star: "The Thermal Sound Field"**

The city is drawn as heat and sound, not as a chart. A full-bleed, tilted map of the five boroughs sits on near-black blue; each 250 m H3 cell rises as an extruded column whose height and colour come from one thermal ramp, and stroked rings travel outward from the 64 hottest cells at a speed set by how far above expectation they run. The visitor should sense where the city is loud before reading a number. Everything else (the lens switch, legend, month scrubber, cell drawer) floats over the field as solid ink panels with a single hairline.

Below the first viewport the map gives way to a reading sheet: condensed Bricolage headlines, a quiet grotesque for prose, Observable Plot figures on the same night ground, hairline stat grids and tables. Density is moderate. The figures carry the colour; the chrome stays in a narrow ladder of blue-greys so that heat is the only warm thing on the screen.

The world refuses the dot map, the choropleth and the card dashboard: intensity on the map is never a filled dot or a flat-filled region, and the analysis is never a grid of boxed tiles.

**Key Characteristics:**
- Near-black blue ground (`night`) with a six-stop thermal ramp carrying every intensity.
- One cool cyan (`cold`) reserved for "quieter than expected" and for good outcomes.
- Extruded hex terrain plus expanding stroked rings; no filled circles as data marks.
- Solid panels, 1px hairline, no glass, no blur.
- Condensed variable display face (Bricolage Grotesque, 82 to 85% width) against Schibsted Grotesk for UI and prose.
- One shared easing curve; all motion stops under reduced motion.

## Colors

A night palette: a seven-step blue-grey ladder for ground, chrome and text, a thermal ramp for heat, and one cold counterpoint.

### Primary
- **Thermal ramp** (`thermal-indigo` to `thermal-violet` to `magenta` to `ember` to `amber` to `hot`): the single carrier of intensity on the map, the legend, the drawer's driver bars and the When heatmap. Defined in `web/src/data.ts` as `THERMAL`; low values are dim and translucent, only true hotspots (above the 99.5th percentile anchor) reach white-hot.
- **Ember** (`ember`): the range slider accent, text selection, "worse than expected" text, forecast interval rule and surge-week shading in charts.
- **Amber** (`amber`): links, the focus ring, the masthead's emphasised word, and model-forecast lines in charts. It is the one warm UI colour outside the data.
- **Hot White** (`hot`): the selected-cell outline on the map, the forecast point, and the strongest model's line in the race chart.
- **Magenta** (`magenta`): mid-ramp heat, the forecast's 80% range fill, the nightlife factor family and residential complaints.

### Secondary
- **Cold Cyan** (`cold`): the only cool accent. Quieter-than-expected cells on the Surprise lens, "fewer complaints" multipliers in the drawer, `.ok` results in tables, the coverage line, and the green-space factor family.

### Neutral
- **Night** (`night`): page and map ground; the vignette and masthead scrim fade to it.
- **Night 2** (`night-2`): hover fill for segmented buttons, empty track of bar meters, selected table row.
- **Panel** (`panel`): every floating surface (rail, legend, scrubber, drawer, select, map tooltip).
- **Hairline** (`hair`): every border and rule, plus chart zero rules and the scrollbar thumb.
- **Ink** (`ink`): primary text and the pressed/filled state of controls (inverted onto `night`).
- **Ink 2** (`ink-2`): secondary prose, unpressed control text, chart axis text.
- **Ink 3** (`ink-3`): fine print, labels, captions, legend ends; also the dashed reference rules in charts.

### Data categoricals
Chart and type-mix colours reuse the ramp and `cold`, plus **Data Slate** (`data-slate`, "other", built form, and the weakest baseline) and **Data Violet** (`data-violet`, commercial and business). A few single-use categoricals (park green, construction yellow, siren pink) live inline in `data.ts` and `Sections.tsx` and are not system tokens.

### Named Rules
**The Heat Is Data Rule.** Warm colours mean intensity. Outside the thermal ramp, only `amber` (links, focus) and `ember` (selection, slider) appear as UI colour; chrome is otherwise the blue-grey ladder.

**The One Cold Voice Rule.** `cold` means quieter than expected or better than the target. It never decorates.

## Typography

**Display Font:** Bricolage Grotesque (with Avenir Next Condensed, Arial Narrow), self-hosted variable, weight 300 to 800, width 75 to 100%
**Body Font:** Schibsted Grotesk (with Helvetica Neue, Arial), self-hosted variable, weight 400 to 900

**Character:** A tight, condensed grotesque with a slightly quirky skeleton for headlines and big numbers, set against a sturdy newsroom grotesque for everything read at length.

### Hierarchy
- **Display** (760, clamp(2.4rem, 5.6vw, 4.6rem), 0.9, width 82%): the masthead title only; balanced wrap.
- **Headline** (720, clamp(1.9rem, 3.6vw, 3rem), 0.98, width 82%): analysis section titles, max 18ch.
- **Title** (700, 1.6rem, 1.05, width 85%): the drawer heading.
- **Figure** (650 to 700, 1.35 to 2rem, line-height 1, width 85%, tabular figures): headline numbers in the drawer and stat grid, and the scrubber's current month.
- **Lede** (400, 1.06rem, 1.5): section intros in `ink-2`, max 64ch, with bold terms lifted to `ink`.
- **Body** (400, 1rem, 1.5): default prose; drawer verdict at 0.95rem.
- **Label** (600, 0.74 to 0.78rem, +0.02em, sentence case, `ink-3`): the rail's "Lens" label, drawer subheads, table headers. Never uppercase.

### Named Rules
**The Narrow Voice Rule.** Display text is always condensed through `font-stretch` (82% for display and headline, 85% for title and figures) with negative tracking. Bricolage at 100% width is not part of the system.

**The Aligned Figures Rule.** Tabular figures only where numbers line up in columns (stat grid, tables, drawer numbers, scrubber, fact lists). Chart text resets to normal figures because tabular figures widen the period and comma in this face.

## Layout

Two zones. The **stage** is a full-viewport map (100svh, min 560px; 86svh below 860px) with controls absolutely placed at its edges, 28px in from the sides (16px on mobile): masthead top-left behind a radial scrim, lens rail bottom-left above the scrubber, legend bottom-right, a centred hint pill at top, the scrubber full-width along the bottom, and the drawer docked right. The **sheet** below is a centred column (max 1180px, 96px top padding, 28px sides) of sections separated by a hairline and 56px of padding; figures sit in a 1.15fr / 1fr two-column grid with a 40px gap.

At 860px and below: the two-column grid stacks, the masthead drops its paragraph, the lens switch becomes a 2x2 grid without notes, the legend and hint hide, the scrubber tightens to 12px insets, and the drawer becomes a bottom sheet (8px insets, max 72% height). The map opens wider and flatter on mobile (zoom 9.4, pitch 40).

## Elevation & Depth

The interface is flat; depth belongs to the map. Hex columns are extruded and lit (ambient 0.55, diffuse 0.6, warm specular), rings float just above their column, and a radial vignette darkens the stage edges. Floating panels sit flat with a 1px hairline. The drawer is the only shadowed surface, because it overlays the field.

### Shadow Vocabulary
- **Drawer lift** (`box-shadow: 0 24px 60px -12px rgba(0, 0, 0, .6)`): the cell drawer only.

### Named Rules
**The Solid Panel Rule.** Panels are opaque `panel` with a `hair` border. No backdrop blur, no glass, no gradient fills on chrome.

## Shapes

Gently rounded, nested radii: 7px buttons inside 10px containers, 8px for standalone controls (select, close), 12px for the scrubber bar, 14px for the drawer. Pills and the hint are fully round (999px); the play button is a 40px circle. Meter bars and the ramp swatch use half their height (3px, 5px). Tables and stat grids are square with hairline rules. On the map the cell is the shape: H3 hexagons at 0.9 coverage, outlined in 3px `hot` when selected.

## Components

### Buttons
- **Segmented lens switch:** a `panel` tray (10px radius, 4px padding, 2px gap) of left-aligned buttons with a smaller note line. Default `ink-2` on transparent; hover fills `night-2` and lifts text to `ink`; pressed inverts to `ink` fill with `night` text at weight 600. Transitions 180ms on the shared ease.
- **Play:** a 40px `ink` circle with a `night` glyph drawn as inline SVG; hover scales to 1.06; disabled at 40% opacity when the lens has no time axis or reduced motion is on.
- **Close:** a 34px transparent square (8px radius, hairline border) with an inline SVG cross; hover lifts text to `ink` and the border to `ink-3`.

### Chips
- **Filter pills:** hairline outline, transparent, `ink-2`, 6px 12px, fully round. Pressed fills `ink` with `night` text and an `ink` border. Used for factor pick, model toggles and complaint-type filters; state is exposed through `aria-pressed`.

### Cards / Containers
- **Corner Style:** 10px (legend, lens tray), 12px (scrubber), 14px (drawer).
- **Background:** `panel` everywhere.
- **Shadow Strategy:** flat, except the drawer (see Elevation).
- **Border:** 1px `hair`.
- **Internal Padding:** 12px 14px (legend), 12px 16px (scrubber), 20px 20px 24px (drawer).

### Inputs / Fields
- **Select:** inherits the UI font, `panel` fill, `ink` text, hairline border, 8px radius, full width of the rail.
- **Range slider:** native input tinted with `accent-color: ember`.
- **Focus:** every focusable element gets a 2px `amber` outline at 2px offset.

### Navigation
The lens rail is the only navigation: a sentence-case "Lens" label over the segmented switch, with a factor select that appears under "A single factor". There is no top nav.

### Cell Drawer (signature)
Slides in from the right (24px, 320ms) over the map. Contains: a condensed title, three figures with small `ink-3` captions, a verdict sentence, driver multipliers as label / bold value / 6px meter bar whose fill comes from the thermal ramp (quieter factors use `cold`), a type-mix stacked bar with a swatch key, a 110px monthly Plot sparkline (ember area, amber line), and a two-column fact list with values right-aligned in `ink`.

### Stat Grid and Tables
Stat grids are hairline-ruled cells (min 160px, 16px 18px padding) holding a Figure numeral over an `ink-3` caption. Tables are full-width, 0.88rem, hairline row rules, `ink-3` headers, `ink-2` cells; hover lifts a row to `ink`, the selected row takes `night-2`, and outcome cells read `cold` (ok) or `ember` (bad) alongside a text value.

### Heat Field (signature)
The deck.gl map: CARTO Dark Matter without labels, extruded hexes coloured by the thermal ramp with alpha rising with intensity, elevation `t^2.2`, 450ms attribute transitions between lenses and months, and two offset ring layers on 64 hotspots. One requestAnimationFrame clock drives every ring and pauses on a hidden tab; reduced motion freezes it.

## Do's and Don'ts

### Do:
- **Do** carry every intensity through the six-stop thermal ramp, and every "quieter than expected" through `cold`.
- **Do** float controls over the map as opaque `panel` surfaces with a 1px `hair` border.
- **Do** set headlines and large numbers in Bricolage Grotesque at 82 to 85% width with negative tracking.
- **Do** keep labels sentence case at 0.74 to 0.78rem in `ink-3`.
- **Do** use the shared ease `cubic-bezier(.16, 1, .3, 1)` for state changes and stop all animation, ripples and playback under `prefers-reduced-motion`.
- **Do** pair any colour-coded result with a value or word (`x1.8`, "yes", "+12%").

### Don't:
- **Don't** draw map intensity as filled dots or flat-filled regions; use extruded hexes and stroked rings.
- **Don't** use backdrop blur or translucent glass panels.
- **Don't** introduce warm colours for chrome beyond `amber` and `ember`.
- **Don't** add shadows to panels at rest; the drawer is the only lifted surface.
- **Don't** set Bricolage at full width or use it for running text.
- **Don't** uppercase labels or add kicker lines above headings.
