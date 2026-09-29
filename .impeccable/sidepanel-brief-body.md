# CueWave YouTube Side Panel

## Scope

- Surface: `extension/sidepanel.html`
- Mode: Operate
- Primary job: define semantic probes, analyze the current YouTube video, read a time-aligned heatmap, and jump to evidence.
- Secondary tools: caption import, result export/history, and live judgment. These stay accessible but do not compete with the primary loop.

## Chosen theme system

- Default / light: **时间登机牌** — off-white ticket stock, navy wayfinding, perforation and gate-board rhythm.
- Dark mode: **语义换乘图** — graphite station board, luminous route colors, stops and connecting lines.
- Both themes use the same DOM, action order, data, probe colors, and accessibility semantics. Theme changes appearance only and is remembered locally.
- Approved references: `.impeccable/mocks/decision/challenger-gate-board.webp` (default) and `.impeccable/mocks/decision/assigned.webp` (dark).

## Direction contract

### THESIS
CueWave is a fast instrument: add a probe, analyze once, then jump through time-aligned evidence. The interface rejects a stack of equal workflow cards and makes the core loop visible without explanation.

### OWN-WORLD
The default world is a boarding pass and departure board; the dark world is a transit map. Each theme commits to its own visual language without mixing metaphors inside one view. Probe colors remain functional route identifiers in both.

### STORY
Recognize the current video, add or choose a probe, confirm readiness, analyze, scan the timeline, select a hotspot, and jump to the matching moment. Evidence stays close to the result that opened it.

### FIRST VIEWPORT
Show the compact masthead and theme control, current-video strip, dominant probe input, active probes, the primary analyze action and its state, followed immediately by the semantic timeline. Hotspots follow; transcript, storage, export, and live judgment are progressively disclosed.

### FORM
Default theme uses the approved challenger “时间登机牌”. Dark mode uses the approved assigned direction “语义换乘图”. Challenger seed key: `630b0c20`. Approval evidence: the user explicitly selected both and specified the default/dark mapping.

### FINISH
unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

The same time-aligned histogram becomes a gate-board signal trace in light mode and a connected colored transit route in dark mode. Selecting a probe isolates its route while preserving exact video-time alignment.
