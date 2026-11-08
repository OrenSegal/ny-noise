---
name: NYC Noise Forecast
description: A statistical-atlas plate for next week's noise complaints, with its own scorecard.
colors:
  ink: "#14213D"
  paper: "#EEF1ED"
  paper-deep: "#E2E7E0"
  surface-plate: "#F7F9F6"
  rule: "#C5CCC2"
  muted: "#4A5468"
  baseline-grey: "#7A8190"
  class-well-below: "#1D5F7A"
  class-below: "#86B4BC"
  class-near-typical: "#D9D5C3"
  class-above: "#E9A15E"
  class-well-above: "#B3392B"
typography:
  title:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "2.1rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  plate-title:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.15rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Libre Franklin, Franklin Gothic Medium, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  note:
    fontFamily: "Libre Franklin, Franklin Gothic Medium, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 400
  tab:
    fontFamily: "Libre Franklin, Franklin Gothic Medium, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
rounded:
  none: "0"
spacing:
  tab-y: "0.55rem"
  tab-x: "1.1rem"
  plate-caption-gap: "1rem"
components:
  plate:
    backgroundColor: "{colors.surface-plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  tab:
    textColor: "{colors.ink}"
    typography: "{typography.tab}"
    padding: "0.55rem 1.1rem"
  tab-selected:
    textColor: "{colors.ink}"
  band-segment-well-below:
    backgroundColor: "{colors.class-well-below}"
    textColor: "#FFFFFF"
  band-segment-below:
    backgroundColor: "{colors.class-below}"
    textColor: "{colors.ink}"
  band-segment-near-typical:
    backgroundColor: "{colors.class-near-typical}"
    textColor: "{colors.ink}"
  band-segment-above:
    backgroundColor: "{colors.class-above}"
    textColor: "{colors.ink}"
  band-segment-well-above:
    backgroundColor: "{colors.class-well-above}"
    textColor: "#FFFFFF"
---

# Design System: NYC Noise Forecast

## Overview

**Creative North Star: "The Working Atlas Plate"**

The dashboard is a statistical-atlas plate for next week's noise complaints, in the manner of Walker's 1874 Statistical Atlas but working as an Operate tool. Cool map-paper ground, navy-black ink, hairline rules and five graded class tints running from deep teal through a warm neutral to vermilion.

Charts and tables sit in thin-ruled plates under serif plate titles, each followed by an italic caption that says how to read it. Density is high and flat; there are no cards, shadows or rounded corners.

**Key Characteristics:**
- Five-class tint scale, teal to vermilion, shared by strip, map and outcomes
- Ink-outlined marks on cool paper
- Franklin for data, Source Serif for titles and italic captions
- Hairline-framed plates, no shadows
- Band strip as legend, histogram and filter

## Colors

A cool sage paper and navy ink, with one diverging five-tint scale as the only chromatic system.

### Primary
- **Deep Teal** (`class-well-below`): the "well below normal" class; also the "hit" outcome, the model-versus-baseline mean line and earlier-forecast lines.
- **Vermilion** (`class-well-above`): the "well above" class; also the selected-tab underline, focus ring, selection accent in Streamlit's theme, "miss" outcomes and the last-week baseline.

### Secondary
- **Pale Teal** (`class-below`): the "below" class.

### Tertiary
- **Ochre Orange** (`class-above`): the "above" class; also 80% range bars, surge-week shading (28% opacity) and text selection.

### Neutral
- **Survey Buff** (`class-near-typical`): the "near typical" class.
- **Navy Ink** (`ink`): text, outlines, axis lines, the model line.
- **Map Paper** (`paper`): page ground.
- **Sidebar Sage** (`paper-deep`): Streamlit secondary background.
- **Plate Stock** (`surface-plate`): fill inside framed charts, tables and hover labels.
- **Hairline Sage** (`rule`): plate frames and gridlines.
- **Slate Caption** (`muted`): captions, notes, annotations.
- **Dotted Baseline Grey** (`baseline-grey`): the same-week-last-year baseline, dotted.

### Named Rules
**The Band Strip Rule.** The five-segment strip of ZIP counts is the legend, the histogram and the filter at once. Any new view that shows forecast class takes its colors from the strip and responds to its selection.

## Typography

**Display Font:** Source Serif 4 (with Georgia, serif)
**Body Font:** Libre Franklin (with Franklin Gothic Medium, Helvetica Neue, Arial, sans-serif)

**Character:** Franklin is the surveyor's hand for numbers and controls, set with tabular numerals app-wide; the serif is the plate engraver's voice for titles and italic captions. Both are self-hosted from `static/`.

### Hierarchy
- **Title** (600, 2.1rem, 1.1, -0.01em; 1.6rem under 640px): the single page h1.
- **Plate title** (600, 1.15rem, -0.01em): names each figure or table.
- **Body / lede** (400, 1.06rem, 1.55, max 74ch): the forecast sentence; bold figures at 650.
- **Caption** (italic serif, 400, 0.9rem, 1.45, max 70ch, muted): under every figure.
- **Note** (400, 0.86rem, muted, max 74ch): small print such as the reporting-not-loudness disclaimer.
- **Tab / label** (600, 1rem): tab row and controls.

### Named Rules
**The Two Voices Rule.** Franklin speaks data and controls; Source Serif speaks titles and captions. They never swap.

## Layout

Wide Streamlit layout, content capped at 1400px. Page order: title, lede sentence, note, pin selector, then the tab row (Outlook, ZIP replay, Compare, Scorecard, When). Outlook is a 5:4 two-column split with large gap: band strip then map plate on the left, ranked table on the right. Scorecard uses 3:2 controls and a two-column lower row. Rhythm is rem-based; captions sit 0.25rem under a figure and 1rem before the next. Under 640px the title shrinks and side padding drops to 0.8rem.

## Elevation & Depth

Flat. No shadows exist in the build. Depth comes from hairline frames (`rule`) on plate stock over the paper ground, and from ink outlines on marks. Unselected strip segments drop to 30% opacity.

### Named Rules
**The Flat Plate Rule.** No shadows. Plates are framed by a hairline and sit flat on the paper.

## Shapes

Square. No corner radii are set by the design. Marks are outlined in ink: strip segments 1px, map bubbles 0.8px, bars 0.6px, point markers 1.5px; pinned ZIPs get an open ink ring (2.5px). Map bubbles are circles sized by the square root of forecast volume.

### Named Rules
**The Ink Outline Rule.** Every mark carries an ink outline, so tints separate by line, not only by hue.

## Components

### Band Strip
The signature component: one stacked horizontal bar, five segments in class order, labelled with ZIP counts (name added when a segment holds 20 or more). Ink-outlined, white text on the two dark ends, ink text elsewhere. Clicking a segment filters map and table; a "Show all classes" button clears it.

### Plates (charts and tables)
1px `rule` frame on `surface-plate`, transparent chart background, ink axis lines, `rule` gridlines, Franklin 12px chart text, hover labels in plate stock with an ink border.

### Tabs
Ink hairline under the row, semibold tabs, selected tab ink with a 3px vermilion underline. Focus-visible gets a 2px vermilion outline with 2px offset.

### Readout
Ink 1px top rule, body text, hit in teal and miss in vermilion at weight 650, followed by a muted note.

### Maps and series
Map is a longitude/latitude bubble scatter (no tiles), one trace per class. Series colors: model ink 3.2px; last week vermilion, 4-week mean teal, same week last year grey dotted, all 2px; compared ZIPs ink, vermilion, teal.

## Do's and Don'ts

### Do:
- **Do** classify forecasts into the five bands (well below, below, near typical, above, well above) at -30%, -10%, +10%, +30% against the ZIP's own 52-week mean, and tint every band mark with its class color.
- **Do** outline every data mark in ink (`#14213D`): 1px on strip segments, 0.8px on bubbles, 0.6px on bars, 1.5px on point markers.
- **Do** frame every chart and table in a 1px hairline (`#C5CCC2`) on plate stock (`#F7F9F6`) over the paper ground.
- **Do** set Libre Franklin with tabular numerals for all data, controls and tables; set Source Serif 4 only for the page title, plate titles and italic captions.
- **Do** put an italic serif caption under each figure that says how to read it, in slate (`#4A5468`).
- **Do** use vermilion for the selected tab underline, focus ring and 'miss' outcomes, and deep teal for 'hit' outcomes.
- **Do** keep the model line in ink at 3.2px and the baselines in class teal, vermilion and dotted grey (`#7A8190`) at 2px.

### Don't:
- **Don't** use shadows, gradients or rounded corners; depth is hairline frames and ink outlines.
- **Don't** encode forecast magnitude as a continuous color ramp on the map; the classed five-tint scale is the only forecast encoding (the weekday-hour heatmap is a separate count ramp and stays out of the band system).
- **Don't** set data, labels or controls in the serif face.
- **Don't** use more than the five class tints plus ink, muted and baseline grey for series color.
- **Don't** hide the honest result: the losing quarter and the surge weeks stay visible in the scorecard.
