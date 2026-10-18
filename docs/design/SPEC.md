# Curvesmith: product & engineering spec

**Product:** Curvesmith, a professional vector editor that runs in the browser.
**Domain:** curvesmith.app, a static site hosted on GitHub Pages.
**Native file:** `.curvs` (see `CURVS_FORMAT.md`).
**References:** Illustrator, Inkscape, Affinity Designer and CorelDRAW. Curvesmith takes the best interaction from each and keeps the UI uncluttered.

> The north star: **advanced capability, beginner-calm interface.** Every power feature must be discoverable without a manual and invisible until it's relevant.

Mockups: `../mockups/png/*.png` (pictures), `../mockups/html/*.html` (open in a browser to inspect exact CSS). Tokens: `../design/tokens.css`. Tool list and icons: `../design/tools.json`.

---

## 1. UX principles (apply to every feature)

1. **Context over chrome.** One context bar under the menus changes with the active tool, as in Affinity. Never show options for a tool that isn't active. The inspector shows only what applies to the current selection.
2. **Hint while doing.** When a tool has no special options, the context bar shows a one-line hint of its modifiers. Example: *"Click for corners · drag for curves · ⌥ breaks a handle · click the first anchor to close"*. Every hint is in `tools.json`.
3. **Everything is searchable.** ⌘K / Ctrl+K opens a command palette over tools, menu commands, layers by name, swatches, recent files and preferences. Each entry shows its shortcut, so the palette teaches shortcuts.
4. **Live, non-destructive by default.** Shapes stay parametric: rectangles keep corner radii, stars keep point count and depth. Booleans stay live compounds, as with Illustrator's compound shapes and Affinity's compound mode. Effects stay in the appearance stack. "Expand" is always available and never forced.
5. **Numbers are first-class.** Every numeric field accepts math (`120/3`, `+12`, `50%`, `10mm`) and unit conversion. Scrub-drag a field's label to change its value; ⇧ gives coarse steps, ⌥ gives fine steps.
6. **The canvas tells you what's happening.** Show live measurements in a HUD near the cursor or node. Smart guides say what they snapped to ("3 nodes aligned", "center", "equal spacing 24 pt"). Show transform dimensions while dragging.
7. **One accent.** Volt green means active, selected or primary, and nothing else. Use no other colors in the chrome, except the success dot in the status bar.
8. **Calm defaults, deep settings.** Open with a sensible workspace. Keep advanced options behind disclosure, never in a modal maze.
9. **Undo everything,** including selection changes in the history panel (collapsed by default), view changes excluded. Unlimited undo per document, which survives reloads through autosave.
10. **Local-first and private.** Files never leave the device. Say so where it matters: the start-screen drop zone and the status bar ("Saved to this device · 2 min ago").

## 2. App shell (match `mockups/png/editor.png` and `editor-dark.png`)

| Region | Size | Contents |
|---|---|---|
| Top bar | 48 px | Mark (links to start screen) · menus File, Edit, Object, Type, View · document tabs (name, extension in muted color, Volt dot when there are unsaved changes, middle-click closes) · centered ⌘K search field · Undo · Version history · theme toggle · **Export** primary button (Volt fill, ink text) |
| Context bar | 40 px | Active tool name + shortcut chip · tool options or hint · right side: snapping chips (Nodes, Guides, Pixel grid, Objects, Angles: toggle chips, Volt outline when on) |
| Toolbar | 52 px, left | 14 tools in 6 groups (see §3) · fill/stroke swatch pair at the bottom (X swaps focus, ⇧X swaps colors, D resets) |
| Canvas | flexible | Rulers (20 px) on top and left · pasteboard `--paste` · artboards with `--shadow-artboard` and their name above · overlays (see §4) |
| Inspector | 304 px, right | Tabs **Design** / **Assets** · Layers panel docked below (262 px default, resizable split) |
| Status bar | 28 px | Artboard (n of N) · artboard size · cursor position · spacer · save state · color mode · zoom % (click for presets) |

* Panels are collapsible (Tab hides all UI, ⇧Tab hides panels only) and resizable. Remember the layout per user (localStorage).
* Responsive: below 1100 px the inspector becomes an overlay drawer. Below 760 px, show a "best on a larger screen" view-only mode with pan, zoom and export.
* Theme: follows the OS by default. The top-bar toggle cycles Light → Dark → System. Set `data-theme` on `<html>`.

## 3. Tools (order, shortcuts and icons in `design/tools.json`)

| Tool | Key | Reference it comes from | Behavior notes |
|---|---|---|---|
| Move | V | all | Bounding box with corner rotation zones, as in CorelDRAW and Affinity. Double-click a group to enter it (isolation). ⌥-drag duplicates. ⌘D repeats the last transform (Illustrator "Transform Again"). |
| Node | A | Inkscape / Affinity | See §4. Context bar: **Convert** Sharp / Smooth / Symmetric / Auto · Break · Join · Add node · Simplify · "Show all handles". Marquee-select nodes. Arrow keys nudge. |
| Pen | P | Affinity / Illustrator | Click places a corner, drag places a smooth node. ⌥ breaks a handle. Space while dragging repositions the anchor. Hover on a path adds a node, hover on a node deletes it. Rubber-band preview. Modes: Pen / Smart (auto-smooth, Affinity) / Polygon / Line. |
| Pencil | N | Inkscape / Affinity | Freehand fitted to Béziers live, with a smoothing slider. Starting at an endpoint continues that path. Optional pressure → width profile. |
| Scissors | C | Illustrator / Inkscape | Click cuts a path at a point. Drag a line to slice through everything it crosses (knife). |
| Shape builder | ⇧M | Illustrator | Hover highlights regions of overlapping selected shapes. Drag across to merge them, ⌥-drag to erase. The cleanest boolean UX of the four apps. |
| Rectangle | M | Affinity / CorelDRAW | On-canvas corner widgets for radius. Per-corner radius and type (round, chamfer, inset) in the inspector. |
| Ellipse | L | Inkscape | Arc and pie handles on canvas. |
| Star & polygon | * | Inkscape | ↑/↓ change point count while dragging. Inner handle sets depth. Rounding and randomize options. |
| Text | T | all | Click makes point text, drag makes area text, clicking a path types on that path. OpenType features panel. Variable-font axes. Outline text is a command, never automatic. |
| Gradient | G | Affinity / Inkscape | On-canvas gradient line and stops: double-click adds a stop, drag a swatch onto the line. Linear, radial, conic and mesh (mesh in a later phase). |
| Eyedropper | I | Illustrator | Click copies the whole appearance. ⇧-click samples color only. Works on images too. |
| Hand | H | all | Space temporarily activates it from any tool. |
| Zoom | Z | all | Click zooms in, ⌥-click zooms out, a marquee zooms to fit it. ⌘0 fits the artboard, ⌘1 shows 100%, ⌘2 fits the selection. |

The **context bar** content for each tool is the tool's options when it has them, otherwise the `hint` string from `tools.json`.

## 4. Canvas overlays (exact values in `tokens.json → canvasOverlay`)

* Path outline of the selection: 1.5 px, Volt.
* Nodes: 7 px squares with white fill and Volt stroke. A selected node is 10 px, Volt fill, white stroke. Smooth nodes may render as circles to show their type. Pick one convention and keep it consistent.
* Handles: 1 px Volt line, endpoints are 4 px-radius circles with white fill and Volt stroke.
* Smart guides: Volt dashed (3/3) line plus a label pill (Volt fill, ink text, 10 px semibold), e.g. "3 nodes aligned".
* HUD: an ink pill with paper text in mono 11 px, 14 px offset from the active node or cursor. Line 1 shows X/Y. Line 2 is context, in `#7EEBA6` (handle length · angle, or W × H while scaling, or ∠ while rotating).
* Overlays are drawn at screen resolution and stay crisp at any zoom (draw them on a separate overlay layer).

## 5. Inspector

**Design tab** (selection-dependent, sections collapse):

1. Selection header: icon, name (double-click to rename), type and count ("Path · 3 nodes", "4 objects").
2. **Transform:** X, Y, W, H, rotation, constrain-proportions lock, 9-point reference picker (Illustrator), align and distribute icons (align to selection / key object / artboard via a dropdown), flip H/V.
3. **Appearance** (Illustrator Appearance panel, simplified): an ordered stack of Fill / Stroke / Effect rows. Each row has visibility, swatch, value and opacity. Drag to reorder. Clicking a row opens its editor in a popover: color picker (HSB, RGB, HEX, OKLCH, CMYK, swatches, eyedropper) or stroke settings (weight, align inside/center/outside, caps, joins, dashes with presets, arrowheads, **width profile** editor as in Illustrator and Affinity). The "+" button adds a fill, stroke or effect. Then blend mode and opacity.
4. **Combine:** Union, Subtract, Intersect, Divide (+ Exclude in the overflow menu). Live by default; note "Non-destructive by default. Expand any time."
5. Shape-specific sections appear only for that shape type (corner radii, star points, text typography…).

**Assets tab:** document colors (global swatches: editing one updates every use, like Affinity's global colors), color groups, symbols (instances update from the master; overrides per instance), styles (saved appearance stacks), brushes (later).

**Layers panel:** a tree with object-type icons and indentation of 16 px per level. Eye and lock icons appear on hover, and stay visible while their toggle is on. Drag to reorder and reparent. Alt-click the eye to solo. Selected row uses `--accent-soft`. Search/filter field. Artboards are top-level rows.

## 6. Start screen (`mockups/png/home.png`)

Sidebar: Home, Files on this device, Libraries, then Dark mode toggle and Preferences. Main area:

* Heading "Start something" and a search field (⌘K).
* **New document** presets: A4, US Letter, Social square 1080 px, App icon 1024 px, Presentation 1920 × 1080, Custom size (mm / in / px / pt). Users can save their own presets.
* **Drop zone**: "Drop any vector file here to open it". It shows format chips and the line "Files open locally in your browser. Nothing is uploaded." plus a Browse files button. Dropping a file anywhere in the app opens it too.
* **Recent** grid with thumbnails (from the `.curvs` thumbnail or a rendered preview) and "format · edited time". Use File System Access handles stored in IndexedDB so recent files reopen without re-picking where the browser allows. Otherwise fall back to OPFS copies.

## 7. Export (`mockups/png/export*.png`)

A modal dialog, 1040 px max width.

* **Header:** title and a scope segmented control: Selection / This artboard / All artboards (n).
* **Left:** format list, grouped under NATIVE, VECTOR and RASTER, each with a short descriptor.
* **Center:** a live preview on a checkerboard.
* **Right:** options for the selected format:
  * SVG: text kept as text or converted to outlines · styling as attributes / inline CSS / classes · decimal places · minify · responsive (viewBox only) · include artboard background · layer names as IDs.
  * Raster: scale 1×/2×/3×/custom · W/H · quality (JPG/WebP) · transparent background · anti-alias.
  * Documents (PDF, AI, EPS, DXF, EMF, .curvs): compatibility · embed fonts · keep layers · bleed · crop marks.
* **Footer:** file name with extension · estimated size · Cancel · **Export {FORMAT}**.

Remember export settings per format and per document. File › Export again re-runs the last export without the dialog. Later: slices / export persona (Affinity) for batch asset export.

## 8. File formats

Be honest in the UI about the limits of each format: show an import report ("3 effects were flattened, 1 font substituted") instead of silently degrading.

| Format | Open | Save/Export | Approach |
|---|---|---|---|
| **.curvs** | ✅ | ✅ | Native ZIP package. Lossless. See `CURVS_FORMAT.md`. |
| **SVG / SVGZ** | ✅ | ✅ | Own parser to the document model (paths, shapes, groups, transforms, gradients, clip/mask, text, `<use>`/symbols, CSS styles). Own writer with the options in §7. SVGZ uses gzip via `fflate`. |
| **PDF** | ✅ | ✅ | Import: **pdf.js** (Apache-2.0) operator list → paths, fills, strokes, text, images. One artboard per page. Export: **pdf-lib** (MIT) or a small purpose-built writer. Vector, embedded/subset fonts, optional bleed and crop marks, PDF/X-4 profile later. |
| **AI** | ✅ (PDF-compatible) | ✅ (PDF-based) | Modern `.ai` files embed a PDF stream ("Create PDF Compatible File", on by default), so import through the PDF path. Legacy PostScript-only AI (pre-CS) needs a PostScript interpreter, as for EPS. Export writes a PDF-based file with `.ai` extension that Illustrator opens. Illustrator's private editing data is not written: say so in the export panel. |
| **EPS** | ⚠️ phase 3 | ✅ | Export: generate PostScript directly (straightforward for paths, fills and strokes; gradients as shading dictionaries). Import needs a PostScript interpreter. Ghostscript compiled to WASM works but is **AGPL**. Decide licensing first (see Open decisions). |
| **DXF** | ✅ | ✅ | Import with `dxf-parser` (MIT): lines, polylines, arcs, splines → paths, layers kept. Export: own writer for R12/R14 (paths flattened to polylines/splines, units in the dialog). Targets laser and vinyl cutters. |
| **EMF / WMF** | ✅ | ✅ (EMF) | Own parser and writer based on the published [MS-EMF]/[MS-WMF] specs, covering path records, pens, brushes and text. |
| **CDR** | ⚠️ phase 3 | ❌ | Import: compile **libcdr + librevenge** (MPL-2.0) to WASM and map its drawing calls into the model. Writing CDR isn't feasible: no public writer or spec exists. Offer CDR users PDF/SVG/EPS instead. |
| **PNG / JPG / WebP** | ✅ (as images) | ✅ | Export through OffscreenCanvas/canvas `toBlob`, with PNG pHYs DPI chunk written. Import places an image, and **Image Trace** (later) vectorizes it. Use a permissively licensed tracer. potrace is GPL, so avoid it unless the license decision allows it. |
| Affinity `.afdesign` | ❌ | ❌ | Closed and undocumented. Not supported. Point users to SVG/PDF. |

All format code lives in `src/formats/<format>/{import,export}.ts` behind one interface:
```ts
interface FormatAdapter {
  id: string; extensions: string[]; mime: string[];
  canImport: boolean; canExport: boolean;
  import?(bytes: Uint8Array, opts: ImportOptions): Promise<{ doc: CurvsDocument; report: ImportReport }>;
  export?(doc: CurvsDocument, scope: ExportScope, opts: unknown): Promise<Blob>;
}
```
Heavy adapters (pdf.js, libcdr WASM) are **lazy-loaded** on first use.

## 9. Architecture (recommended)

* **Build:** Vite + TypeScript (strict). Deploy to GitHub Pages with a GitHub Actions workflow (`actions/deploy-pages`). Keep `public/CNAME` = `curvesmith.app`. Vite `base: '/'` because a custom domain is used.
* **UI:** React with a small store (Zustand) for UI state. The document model lives outside React, in a framework-free core package, so it can be tested and later run in a worker.
* **Rendering:** **CanvasKit (Skia WASM, BSD-3)** on a `<canvas>`. It gives robust paths, strokes, dashes, gradients and image filters, **PathOps for booleans**, and text shaping (Paragraph API). Draw overlays on a second, lightweight canvas or as SVG. Use dirty-rect rendering and tile caching for large docs. Canvas2D with `Path2D` is an acceptable fallback renderer for thumbnails.
* **Geometry core:** own Bézier utilities (split, length, nearest point, offset for strokes-to-outline, simplify by curve fitting, Schneider's algorithm, for the pencil). Use CanvasKit PathOps for boolean operations and outline stroke.
* **Text:** CanvasKit Paragraph + HarfBuzz shaping. `opentype.js` for outlining text and reading font features. Local fonts through the Local Font Access API where available (permission prompt). Bundled OFL fonts otherwise.
* **History:** command pattern with patches, using immer patches or a custom op log. Each op is serializable, which makes autosave, crash recovery and future collaboration possible (Yjs-compatible design, not required now).
* **Persistence:** File System Access API (`showOpenFilePicker`/`showSaveFilePicker`, handles stored in IndexedDB) where supported. Elsewhere, download/upload fallbacks. Autosave snapshots to **OPFS** every 30 s and on blur.
* **PWA:** service worker (Workbox) with an offline-first app shell and `file_handlers` in `manifest.webmanifest` (already provided), so the installed app opens `.curvs`, `.svg` and the other formats from the OS.
* **GitHub Pages limitation:** you can't set COOP/COEP headers, so **SharedArrayBuffer and WASM threads are unavailable**. Keep WASM single-threaded, or ship `coi-serviceworker` deliberately and test it. Use Web Workers with transferables for heavy import/export.
* **Color:** sRGB working space in phase 1. Store colors with their space (`srgb`, `display-p3`, `cmyk`, `spot`) in the model from day one so CMYK and spot colors can be added without a format change.
* **Units:** the internal unit is the **point (1/72 in)**, matching PDF and AI. The display unit is per document (mm, in, px, pt, pc), and the status bar and inputs convert.

```
src/
  core/        document model, ops/history, geometry, selection, snapping (no DOM)
  render/      CanvasKit renderer, overlay renderer, hit-testing, viewport
  tools/       one module per tool: pointer state machine + context-bar schema
  formats/     curvs, svg, pdf, ai, eps, dxf, emf, cdr, raster
  ui/          shell, panels, dialogs, command palette, components (tokens only)
  workers/     import/export workers
```

## 10. Keyboard (defaults; remappable in Preferences)

⌘N new · ⌘O open · ⌘S save .curvs · ⇧⌘S save as · ⌘E export again · ⇧⌘E export dialog · ⌘K command palette · ⌘Z / ⇧⌘Z undo/redo · ⌘G / ⇧⌘G group/ungroup · ⌘J join · ⌘8 make compound · ⌘D transform again · ⌘[ ] arrange · ⌘; show/hide guides · ⌘' grid · ⌘R rulers · Tab hide UI · ⌘0 / ⌘1 / ⌘2 zoom fit/100%/selection · tool keys as in §3. On Windows and Linux, Ctrl replaces ⌘. Show platform-correct glyphs.

## 11. Quality bar

* **Performance:** 60 fps pan, zoom and drag with 10k paths. Open a 20 MB PDF in under 3 s on a mid-range laptop. First load under 300 KB of JS before lazy chunks. CanvasKit loads after the shell paints, so the start screen is instant.
* **Accessibility:** every control is a real `<button>`/`<input>` with a label. Icon buttons have `aria-label` and a tooltip with the shortcut. Visible focus rings (2 px Volt outline, offset 2). Full keyboard operation of panels. Text contrast ≥ 4.5:1 in both themes. Volt text on light surfaces uses `--cs-volt-deep`. `prefers-reduced-motion` respected.
* **Tests:** Vitest for core geometry and model ops. **Golden round-trip tests** for every format (fixtures in `tests/fixtures/<format>/`: import → export → re-import, then compare). Playwright E2E for the main flows: new doc, draw with the pen, boolean, export SVG, reload restores autosave.

## 12. Roadmap

* **Phase 1 (MVP):** app shell in both themes, start screen, Move/Node/Pen/Rectangle/Ellipse/Star/Text/Hand/Zoom, layers, transform, appearance (single fill and stroke), booleans, snapping and smart guides, undo/redo, `.curvs` save/open, SVG import/export, PNG export, autosave, PWA.
* **Phase 2:** Pencil, Scissors, Shape builder, Gradient tool, multiple fills/strokes, effects (drop/inner shadow, blur), width profiles, symbols, global colors, PDF import/export, AI import/export (PDF-based), DXF, EMF, JPG/WebP, command palette complete, export presets.
* **Phase 3:** EPS import, CDR import (WASM), image trace, mesh gradients, CMYK/spot and PDF/X, variable-width brushes, version history UI, plugin API.

## 13. Open decisions (ask the product owner before building these)

1. **License of Curvesmith itself.** If it's open source under GPL/AGPL, Ghostscript (EPS/legacy AI import) and potrace (tracing) are usable. If it's closed source, avoid them or isolate them as separate opt-in modules.
2. **Font strategy.** Bundled OFL set only, or also the Local Font Access API (Chromium only, permission prompt)?
3. **Analytics/telemetry.** Recommended: none, or privacy-first and opt-in, to stay consistent with "nothing is uploaded".
