# The `.curvs` file format, version 1

A `.curvs` file is a **ZIP archive** (deflate; use `fflate` in the browser). Compatible readers MUST check `manifest.json` before anything else.

```
my-design.curvs
├── mimetype              "application/x-curvesmith" (first entry, STORED/uncompressed, like ODF/EPUB)
├── manifest.json         format id, version, app version, entry list
├── document.json         the document model (below)
├── thumbnail.png         512 px max side, first artboard, for recent-files grids and OS previews
├── assets/<sha256>.<ext> embedded images (png, jpg, webp, svg), referenced by hash
└── fonts/<sha256>.woff2  embedded font files (only when the font license allows embedding)
```

## manifest.json
```json
{
  "format": "curvs",
  "formatVersion": 1,
  "minReaderVersion": 1,
  "generator": "Curvesmith 1.0.0",
  "created": "2026-10-19T10:00:00Z",
  "modified": "2026-10-19T12:41:00Z",
  "document": "document.json",
  "thumbnail": "thumbnail.png"
}
```
* Readers refuse files whose `minReaderVersion` is higher than theirs, and say so clearly in the UI.
* Writers bump `formatVersion` on additive changes. They bump `minReaderVersion` only on breaking changes. Readers MUST keep unknown keys when re-saving (store them in an `extra` bag).

## document.json (shape)
```jsonc
{
  "id": "doc_01J…",                       // ULID
  "units": "mm",                          // display unit; geometry is ALWAYS stored in points (1/72 in)
  "colorProfile": "srgb",                 // "srgb" (screen) or "cmyk" (print: colors are stored as CMYK inks, print exports write DeviceCMYK)
  "swatches": [ { "id": "sw_1", "name": "Deep teal", "color": { "space": "srgb", "r": 0.169, "g": 0.373, "b": 0.42, "a": 1 }, "global": true } ],
  "styles":   [ { "id": "st_1", "name": "Wave", "appearance": { /* Appearance */ } } ],
  "symbols":  [ { "id": "sy_1", "name": "Sun", "root": { /* Node */ } } ],
  "fonts":    [ { "family": "Geist", "style": "Regular", "file": "fonts/ab12….ttf" } ],   // uploaded fonts the document uses are embedded; Google and installed fonts are listed by name only (no file)
  "artboards": [
    {
      "id": "ab_1", "name": "Poster A2",
      "x": 0, "y": 0, "width": 1190.55, "height": 1683.78,
      "background": null,
      "guides": [ { "axis": "x", "pos": 36 } ],
      "children": [ /* Node[] back-to-front */ ]
    }
  ],
  "view": { "artboard": "ab_1", "zoom": 1, "cx": 595, "cy": 841 },   // restored on open
  "extra": {}
}
```

### Node (discriminated by `type`)
Common fields: `id`, `name`, `visible`, `locked`, `opacity` (0–1), `blend` (CSS blend-mode names), `transform` (`[a,b,c,d,e,f]` affine, in points), `appearance`.

| type | own fields |
|---|---|
| `group` | `children: Node[]`, `isolated?: boolean` |
| `path` | `subpaths: Subpath[]`, `fillRule: "nonzero" \| "evenodd"` |
| `rect` | `width`, `height`, `corners: [Corner×4]` (`{ radius, kind: "round" \| "chamfer" \| "inset" }`) |
| `ellipse` | `rx`, `ry`, `arcStart?`, `arcEnd?`, `pie?: boolean` |
| `star` | `points`, `outerRadius`, `innerRatio`, `rounding`, `polygon: boolean` |
| `shape` | `kind` (`triangle`, `diamond`, `trapezoid`, `parallelogram`, `gem`, `doubleStar`, `squareStar`, `flower`, `cog`, `arrow`, `chevron`, `cross`, `bolt`, `donut`, `frame`, `pie`, `arc`, `segment`, `crescent`, `cloud`, `calloutRect`, `calloutEllipse`, `tear`, `heart`, `shield`, `spiral`), `width`, `height`, `params` (per-kind numbers and booleans; percents stored as fractions). Painted with the even-odd rule. |
| `text` | `mode: "point" \| "area" \| "onPath"`, `pathRef?`, `box?`, `runs: [{ text, font, size, tracking, leading, features, fill… }]`, `paragraph: { align, indent… }` |
| `image` | `asset: "assets/<sha256>.png"`, `width`, `height`, `crop?` |
| `boolean` | `op: "union" \| "subtract" \| "intersect" \| "exclude" \| "divide"`, `children: Node[]` (live compound) |
| `instance` | `symbol: "sy_1"`, `overrides: {}` |
| `clipGroup` | `clip: Node`, `children: Node[]` |

### Subpath
```jsonc
{ "closed": true,
  "nodes": [ { "x": 0, "y": 360, "in": null, "out": [70, 320], "kind": "smooth" },  // handles absolute, null = no handle
             { "x": 210, "y": 360, "in": [140, 400], "out": [280, 320], "kind": "smooth" } ] }
```
`kind` ∈ `sharp | smooth | symmetric | auto` (Node tool "Convert" options).

### Appearance (Illustrator-style stack, painted bottom-to-top in array order)
```jsonc
{ "items": [
    { "kind": "fill",   "visible": true, "paint": { "type": "solid", "color": { "swatch": "sw_1" } }, "opacity": 1, "blend": "normal" },
    { "kind": "stroke", "visible": true, "paint": { "type": "solid", "color": { "space": "srgb", "r": 0.1, "g": 0.09, "b": 0.125, "a": 1 } },
      "width": 3, "align": "center", "cap": "round", "join": "round", "miter": 4, "dash": [], "dashOffset": 0,
      "profile": [[0, 0.1], [0.5, 1], [1, 0.1]], "arrowStart": null, "arrowEnd": null },
    { "kind": "effect", "visible": true, "effect": { "type": "innerShadow", "x": 0, "y": 6, "blur": 12, "color": { "space": "srgb", "r": 0, "g": 0, "b": 0, "a": 0.35 } } }
] }
```
Paint types: `solid`, `linear`, `radial`, `conic` (`stops: [{ offset, color }]`, `from`/`to` in object space), `mesh` (reserved for phase 3), `pattern` (reserved).
A color is either `{ "swatch": id }` (live link to a global swatch) or `{ "space": "srgb" | "display-p3" | "cmyk" | "spot", … }`.

## Rules
* Every `id` is a ULID and unique in the document. Copy/paste between docs re-IDs.
* Geometry is in points. Coordinates are artboard-relative after the node's `transform`.
* JSON is UTF-8, with no comments in real files (comments above are documentation). Numbers have at most 4 decimal places.
* Embedded assets are deduplicated by SHA-256. Writers drop unreferenced assets on save.
* Writers write to a temp handle and then replace, to avoid corrupting the file if the tab closes mid-save.
* Undo history is **not** stored in the file. Autosave history lives in OPFS per document ID.
