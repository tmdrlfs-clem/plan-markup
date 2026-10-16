# Feature Inventory (clean-room)

Source: Bluebeam Revu 21.11 official help docs shipped with the install
(`Help/KeyboardShortcuts.pdf`, `Help/Getting Started.pdf`). Observation of
features and layout only — no binaries decompiled, no code or assets copied.
Our implementation is original (pdf.js / pdf-lib / canvas layer).

Scope legend: **MVP** = must have · **V2** = later · **—** = out of scope

## 1. Layout (user likes this — replicate structure, not visuals)

- Top: menu bar + pinnable custom toolbars
- Left / right / bottom: collapsible panels with tabs
  - Left: Thumbnails, Bookmarks
  - Right: Tool Chest, Properties
  - Bottom: Markups List, Measurements
- Center: document tabs + canvas; split view (horizontal/vertical) with synced pan/zoom
- Bottom status bar: page nav, zoom, snap toggles (grid / content / markup), scale display
- Profiles (UI presets per workflow) — V2
- Dark UI chrome

## 2. Viewing — MVP

Open PDF, multi-document tabs, fit page / fit width / actual size, zoom in/out/tool,
pan (middle-drag, Space+drag), single / continuous / side-by-side modes,
rotate view, next/prev page, first/last, prev/next view history, text search,
rulers, grid. Split view + sync — V2.

## 3. Markup tools — MVP

Select, lasso, pen, highlight, eraser, line, arrow, polyline, polygon,
rectangle, ellipse, arc, cloud, cloud+ (cloud with leader + text), callout,
text box, typewriter, note, stamp, image, dimension, hyperlink, flag.
Text markup: underline, strikethrough, squiggly.
Edit ops: group/ungroup, align (6), bring forward/back, flip, lock,
format painter, copy/paste/paste-in-place, undo/redo.
Modifiers: Shift = 0/45/90° constrain; rotate snaps 15° (Shift = 1°);
Ctrl+Shift+drag = copy along straight line.

## 4. Measurement — MVP

Scale calibration (per page / per viewport), length, polylength, area,
perimeter, count, angle, radius, diameter, volume (V2), dynamic fill (V2).
Captions movable separately (Shift+click). Measurements panel totals.

## 5. Markups List — MVP

Columns: subject, author, date, status, comments, page, layer, color,
measurement value; sort, filter, reorder columns, custom columns (V2).
Import/export markups, export CSV, PDF summary (V2).

## 6. Tool Chest — MVP

Save a configured markup as reusable tool; tool sets; stamps (built-in +
custom with dynamic date/author).

## 7. Compare & page editing — MVP

Compare documents (visual diff with color coding), overlay pages (V2 tuning),
insert / delete / extract / replace / rotate / reorder pages, crop pages,
flatten / unflatten markups.

## 8. Out of scope (for now)

3D PDF, OCR, redaction, forms editor, digital signatures, scripting,
Studio real-time sessions (V2 candidate), Office/CAD plugins, batch tools.

## 9. User's actual daily usage (C:\bluebeam screenshots, 2026-10-15)

Circled by user = must-have:
- **Top toolbars (2 rows)**: file/undo/clipboard/format painter/flatten/snapshot,
  text markup (underline/strike/replace), arrange, select/pan/zoom/lasso, crop.
  Row 2: measure, calibrate, length, polylength, perimeter, area, volume, count,
  diameter, angle, radius, hyperlink, attachment + font/size/color/B/I/U/S/align.
- **Right vertical tool rail**: text box, typewriter, highlight, pen, cloud+, cloud,
  callout, stamp, image, snapshot, line, arrow, arc, polyline, dimension,
  rectangle, ellipse, polygon, measurement tools.
- **Left icon rail → Tool Chest** and **Measurements** panel.
- Bottom: Markups List columns = Subject, Page Label, Comments, Date, Author,
  Status, Colour, Layer, Space. Status bar shows page size + "Scale Not Set".
- **Calibrate dialog**: pages (current / range "3-5 or 1,5"), Preset | Custom,
  `<n> <unit> = <n> <unit>`, separate Y scale, precision (0.01), add preset.
- **Flatten dialog**: file list + page range, per-markup-type checkboxes,
  all / exclude filtered / selected, allow unflatten, flatten to layer.

### User's own tool sets (%APPDATA%\Bluebeam Software\Revu\21\*.btx)
User-authored content → import is in scope (interop with user's own data).
- `My Tools 1.btx` = **Sprinkler Tools**, 66 items (heads pendant/upright/sidewall,
  FS, FHR, FH, FSI, HYD, valves, 1-way/2-way braces, tick/cross inspection marks,
  3 Count Measurement tools)
- `BlueBeam Alarms.btx` = **Fire Alarm Tools**, 56 items (sounder, smoke, heat,
  MCP, horn, strobe, isolate & reinstate/relocate, DBA, mag door, panels...)
- `My Tools.btx` = 16 items
- Format: XML `BluebeamRevuToolSet`; values are hex-encoded zlib. Each item's
  `Raw` = PDF annotation dict (Subtype Stamp/Circle/Line/PolyLine/Ink/Square,
  Subj = label), `Resources` = appearance stream objects. Mode drawing|properties.
  → Importer: decode → build annotation + render AP via pdf.js → store as tool.

## 10. Our addition — Sprinkler layout (NZS 4541)

Place heads / pipes on calibrated drawing; auto-check spacing, max coverage
area per head, distance to walls, obstructions, by hazard class.
Detailed rule set to be specified in PRD (needs NZS 4541 tables from user).
