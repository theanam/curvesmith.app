/* EMF writer per [MS-EMF]. Logical units are 1/20 pt (MM_ANISOTROPIC, window and viewport extents set from a
   1440 dpi reference device); the header frame is in 0.01 mm. Paths are written with MOVETOEX, LINETO and
   POLYBEZIERTO(16) inside BEGINPATH/ENDPATH, then filled with a solid brush or stroked with a geometric pen.
   EMF has no gradients or transparency: gradients become their average color, transparency is dropped. */
import type { CurvsDocument, ExportScope, Matrix, Paint, Subpath, Vec } from '../../core/types';
import { apply, multiply } from '../../core/matrix';
import { subpathsBounds, transformRect, transformSubpath } from '../../core/geometry/bezier';
import { layoutText, measureText, primaryRun } from '../../core/text';
import { type ExportContext, warner } from '../types';
import type { EmfExportOptions } from '../registry';
import { pagesForScope } from '../shared/pages';
import { collectText, flatColor, flattenPage, matrixScale, pathSegments, type DrawOp } from '../shared/scene';
import { loadFonts } from '../shared/fonts';
import { ByteWriter, dataUrlToBytes, sniffImageMime } from '../shared/bytes';
import { decodePng } from '../shared/png';

export const EMR = {
  HEADER: 1,
  POLYBEZIERTO: 5,
  SETWINDOWEXTEX: 9,
  SETWINDOWORGEX: 10,
  SETVIEWPORTEXTEX: 11,
  SETVIEWPORTORGEX: 12,
  EOF: 14,
  SETMAPMODE: 17,
  SETBKMODE: 18,
  SETPOLYFILLMODE: 19,
  SETTEXTALIGN: 22,
  SETTEXTCOLOR: 24,
  MOVETOEX: 27,
  SAVEDC: 33,
  RESTOREDC: 34,
  SELECTOBJECT: 37,
  CREATEBRUSHINDIRECT: 39,
  DELETEOBJECT: 40,
  LINETO: 54,
  SETMITERLIMIT: 58,
  BEGINPATH: 59,
  ENDPATH: 60,
  CLOSEFIGURE: 61,
  FILLPATH: 62,
  STROKEANDFILLPATH: 63,
  STROKEPATH: 64,
  SELECTCLIPPATH: 67,
  STRETCHDIBITS: 81,
  EXTCREATEFONTINDIRECTW: 82,
  EXTTEXTOUTW: 84,
  POLYBEZIERTO16: 88,
  EXTCREATEPEN: 95,
} as const;

/** Logical units per point. */
export const EMF_UNITS_PER_PT = 20;
const NULL_BRUSH = 0x80000005;
const NULL_PEN = 0x80000008;
const H_PEN = 1;
const H_BRUSH = 2;
const H_FONT = 3;

const colorref = (r: number, g: number, b: number) =>
  (Math.round(Math.max(0, Math.min(1, r)) * 255) |
    (Math.round(Math.max(0, Math.min(1, g)) * 255) << 8) |
    (Math.round(Math.max(0, Math.min(1, b)) * 255) << 16)) >>>
  0;

type Rect32 = [number, number, number, number];

class EmfWriter {
  w = new ByteWriter();
  records = 0;
  private bounds: Rect32 = [0, 0, 0, 0];

  constructor(
    private doc: CurvsDocument,
    private warn: (m: string) => void,
  ) {}

  rec(type: number, body: (w: ByteWriter) => void) {
    const start = this.w.length;
    this.w.u32(type);
    this.w.u32(0);
    body(this.w);
    this.w.pad4();
    this.w.setU32(start + 4, this.w.length - start);
    this.records++;
  }

  rect(w: ByteWriter, r: Rect32) {
    r.forEach((v) => w.i32(v));
  }

  u32rec(type: number, ...vals: number[]) {
    this.rec(type, (w) => vals.forEach((v) => w.u32(v)));
  }

  i32rec(type: number, ...vals: number[]) {
    this.rec(type, (w) => vals.forEach((v) => w.i32(v)));
  }

  /** Points in logical units. */
  pts(subpaths: Subpath[], m: Matrix): Subpath[] {
    return subpaths.map((s) =>
      transformSubpath(s, multiply([EMF_UNITS_PER_PT, 0, 0, EMF_UNITS_PER_PT, 0, 0], m)),
    );
  }

  path(subpaths: Subpath[], m: Matrix) {
    const sp = this.pts(subpaths, m);
    const b = subpathsBounds(sp) ?? { x: 0, y: 0, width: 0, height: 0 };
    this.bounds = [Math.floor(b.x), Math.floor(b.y), Math.ceil(b.x + b.width), Math.ceil(b.y + b.height)];
    this.rec(EMR.BEGINPATH, () => undefined);
    const r = (v: number) => Math.round(v);
    let pending: Vec[] = [];
    const flush = () => {
      if (!pending.length) return;
      const pts = pending;
      pending = [];
      const fits = pts.every(([x, y]) => Math.abs(x) < 32767 && Math.abs(y) < 32767);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const box: Rect32 = [r(Math.min(...xs)), r(Math.min(...ys)), r(Math.max(...xs)), r(Math.max(...ys))];
      this.rec(fits ? EMR.POLYBEZIERTO16 : EMR.POLYBEZIERTO, (w) => {
        this.rect(w, box);
        w.u32(pts.length);
        for (const [x, y] of pts) {
          if (fits) {
            w.i16(r(x));
            w.i16(r(y));
          } else {
            w.i32(r(x));
            w.i32(r(y));
          }
        }
      });
    };
    for (const s of pathSegments(sp)) {
      if (s.t === 'C') {
        pending.push(s.c1, s.c2, s.p);
        continue;
      }
      flush();
      if (s.t === 'M') this.i32rec(EMR.MOVETOEX, r(s.p[0]), r(s.p[1]));
      else if (s.t === 'L') this.i32rec(EMR.LINETO, r(s.p[0]), r(s.p[1]));
      else this.rec(EMR.CLOSEFIGURE, () => undefined);
    }
    flush();
    this.rec(EMR.ENDPATH, () => undefined);
  }

  solid(p: Paint, opacity: number, blend: string): number {
    if (p.type !== 'solid') this.warn('Gradients became flat colors.');
    const c = flatColor(p, this.doc);
    if (c.a * opacity < 0.999)
      this.warn('EMF has no transparency, so see-through objects were drawn opaque.');
    if (blend !== 'normal') this.warn('Blend modes were dropped.');
    return colorref(c.r, c.g, c.b);
  }

  brush(color: number) {
    this.rec(EMR.CREATEBRUSHINDIRECT, (w) => {
      w.u32(H_BRUSH);
      w.u32(0); // BS_SOLID
      w.u32(color);
      w.u32(0);
    });
    this.u32rec(EMR.SELECTOBJECT, H_BRUSH);
  }

  endBrush() {
    this.u32rec(EMR.SELECTOBJECT, NULL_BRUSH);
    this.u32rec(EMR.DELETEOBJECT, H_BRUSH);
  }

  pen(o: Extract<DrawOp, { op: 'stroke' }>, color: number, width: number, scale: number) {
    const cap = o.cap === 'round' ? 0 : o.cap === 'square' ? 0x100 : 0x200;
    const join = o.join === 'round' ? 0 : o.join === 'bevel' ? 0x1000 : 0x2000;
    const dash =
      o.dash.length && o.dash.some((d) => d > 0)
        ? o.dash.map((d) => Math.max(1, Math.round(d * scale * EMF_UNITS_PER_PT)))
        : [];
    const style = 0x10000 | cap | join | (dash.length ? 7 : 0);
    this.rec(EMR.EXTCREATEPEN, (w) => {
      w.u32(H_PEN);
      w.u32(0); // offBmi
      w.u32(0); // cbBmi
      w.u32(0); // offBits
      w.u32(0); // cbBits
      w.u32(style);
      w.u32(Math.max(1, Math.round(width)));
      w.u32(0); // BS_SOLID
      w.u32(color);
      w.u32(0);
      w.u32(dash.length);
      dash.forEach((d) => w.u32(d));
    });
    this.u32rec(EMR.SELECTOBJECT, H_PEN);
    if (o.join === 'miter') this.u32rec(EMR.SETMITERLIMIT, Math.max(1, Math.round(o.miter)));
  }

  endPen() {
    this.u32rec(EMR.SELECTOBJECT, NULL_PEN);
    this.u32rec(EMR.DELETEOBJECT, H_PEN);
  }

  pathRecord(type: number) {
    this.rec(type, (w) => this.rect(w, this.bounds));
  }

  draw(o: DrawOp) {
    switch (o.op) {
      case 'fill': {
        if (!o.subpaths.length) return;
        this.brush(this.solid(o.paint, o.opacity, o.blend));
        this.u32rec(EMR.SETPOLYFILLMODE, o.evenOdd ? 1 : 2);
        this.path(o.subpaths, o.m);
        this.pathRecord(EMR.FILLPATH);
        this.endBrush();
        return;
      }
      case 'stroke': {
        if (!o.subpaths.length) return;
        const scale = matrixScale(o.m);
        let width = o.width * scale * EMF_UNITS_PER_PT;
        if (o.align !== 'center') {
          this.rec(EMR.SAVEDC, () => undefined);
          const clipPaths = [...o.subpaths];
          if (o.align === 'outside') {
            const b = subpathsBounds(o.subpaths) ?? { x: 0, y: 0, width: 0, height: 0 };
            const pad = o.width * 4 + 200;
            const n = (x: number, y: number) => ({ x, y, in: null, out: null, kind: 'sharp' as const });
            clipPaths.unshift({
              closed: true,
              nodes: [
                n(b.x - pad, b.y - pad),
                n(b.x + b.width + pad, b.y - pad),
                n(b.x + b.width + pad, b.y + b.height + pad),
                n(b.x - pad, b.y + b.height + pad),
              ],
            });
          }
          this.u32rec(EMR.SETPOLYFILLMODE, o.align === 'outside' || o.evenOdd ? 1 : 2);
          this.path(clipPaths, o.m);
          this.u32rec(EMR.SELECTCLIPPATH, 1); // RGN_AND
          width *= 2;
        }
        this.pen(o, this.solid(o.paint, o.opacity, o.blend), width, scale);
        this.path(o.subpaths, o.m);
        this.pathRecord(EMR.STROKEPATH);
        this.endPen();
        if (o.align !== 'center') this.i32rec(EMR.RESTOREDC, -1);
        return;
      }
      case 'clip':
        this.rec(EMR.SAVEDC, () => undefined);
        this.u32rec(EMR.SETPOLYFILLMODE, o.evenOdd ? 1 : 2);
        this.path(o.subpaths, o.m);
        this.u32rec(EMR.SELECTCLIPPATH, 1);
        return;
      case 'unclip':
        this.i32rec(EMR.RESTOREDC, -1);
        return;
      case 'layer':
      case 'endLayer':
        return;
      case 'image':
        this.image(o);
        return;
      case 'text':
        this.text(o);
        return;
    }
  }

  text(o: Extract<DrawOp, { op: 'text' }>) {
    this.warn('Text without an available font was written as live text.');
    const run = primaryRun(o.node);
    const full = multiply([EMF_UNITS_PER_PT, 0, 0, EMF_UNITS_PER_PT, 0, 0], o.m);
    const scale = Math.hypot(full[0], full[1]);
    const angle = Math.round((-Math.atan2(full[1], full[0]) * 1800) / Math.PI);
    this.rec(EMR.EXTCREATEFONTINDIRECTW, (w) => {
      w.u32(H_FONT);
      w.i32(-Math.round(run.size * scale));
      w.i32(0);
      w.i32(angle);
      w.i32(angle);
      w.i32(run.font.weight);
      w.u8(run.font.style === 'italic' ? 1 : 0);
      w.u8(0);
      w.u8(0);
      w.u8(1); // DEFAULT_CHARSET
      w.u8(0);
      w.u8(0);
      w.u8(4); // ANTIALIASED_QUALITY
      w.u8(0);
      const face = run.font.family.slice(0, 31);
      for (let i = 0; i < 32; i++) w.u16(i < face.length ? face.charCodeAt(i) : 0);
    });
    this.u32rec(EMR.SELECTOBJECT, H_FONT);
    this.u32rec(EMR.SETTEXTCOLOR, this.solid(o.paint, o.opacity, o.blend));
    this.u32rec(EMR.SETTEXTALIGN, 24); // TA_BASELINE | TA_LEFT
    for (const line of layoutText(o.node).lines) {
      if (!line.text) continue;
      const [x, y] = apply(full, [line.x, line.baseline]);
      const chars = [...line.text].map((c) => c.charCodeAt(0));
      const dx = [...line.text].map((c) =>
        Math.max(1, Math.round(measureText(c, run) * scale + (run.tracking / 1000) * run.size * scale)),
      );
      const strBytes = chars.length * 2;
      const offDx = 76 + Math.ceil(strBytes / 4) * 4;
      this.rec(EMR.EXTTEXTOUTW, (w) => {
        this.rect(w, [0, 0, -1, -1]);
        w.u32(1); // GM_COMPATIBLE
        w.f32(1);
        w.f32(1);
        w.i32(Math.round(x));
        w.i32(Math.round(y));
        w.u32(chars.length);
        w.u32(76);
        w.u32(0);
        this.rect(w, [0, 0, -1, -1]);
        w.u32(offDx);
        chars.forEach((c) => w.u16(c));
        w.pad4();
        dx.forEach((d) => w.u32(d));
      });
    }
    this.u32rec(EMR.SELECTOBJECT, 0x8000000d); // SYSTEM_FONT
    this.u32rec(EMR.DELETEOBJECT, H_FONT);
  }

  image(o: Extract<DrawOp, { op: 'image' }>) {
    const d = o.src ? dataUrlToBytes(o.src) : null;
    const mime = d ? (sniffImageMime(d.bytes) ?? d.mime) : '';
    const px = d && mime === 'image/png' ? decodePng(d.bytes) : null;
    if (!px) {
      this.warn('Only PNG images can be placed in EMF. Other images were left out.');
      return;
    }
    if (Math.abs(o.m[1]) > 1e-9 || Math.abs(o.m[2]) > 1e-9)
      this.warn('Rotated images were placed unrotated.');
    const n = o.node;
    const c = n.crop ?? { x: 0, y: 0, width: px.width, height: px.height };
    const sx = Math.max(0, Math.floor(c.x));
    const sy = Math.max(0, Math.floor(c.y));
    const cw = Math.max(1, Math.min(px.width - sx, Math.round(c.width)));
    const ch = Math.max(1, Math.min(px.height - sy, Math.round(c.height)));
    const stride = Math.ceil((cw * 3) / 4) * 4;
    const bits = new Uint8Array(stride * ch);
    for (let y = 0; y < ch; y++) {
      const row = ch - 1 - y; // bottom-up
      for (let x = 0; x < cw; x++) {
        const s = ((sy + y) * px.width + sx + x) * 4;
        const a = px.rgba[s + 3] / 255;
        const dst = row * stride + x * 3;
        bits[dst] = Math.round(px.rgba[s + 2] * a + 255 * (1 - a));
        bits[dst + 1] = Math.round(px.rgba[s + 1] * a + 255 * (1 - a));
        bits[dst + 2] = Math.round(px.rgba[s] * a + 255 * (1 - a));
      }
    }
    const r = transformRect(
      { x: 0, y: 0, width: n.width, height: n.height },
      multiply([EMF_UNITS_PER_PT, 0, 0, EMF_UNITS_PER_PT, 0, 0], o.m),
    );
    const dest: Rect32 = [
      Math.round(r.x),
      Math.round(r.y),
      Math.round(r.x + r.width),
      Math.round(r.y + r.height),
    ];
    this.rec(EMR.STRETCHDIBITS, (w) => {
      this.rect(w, dest);
      w.i32(dest[0]);
      w.i32(dest[1]);
      w.i32(0);
      w.i32(0);
      w.i32(cw);
      w.i32(ch);
      w.u32(80); // offBmiSrc
      w.u32(40);
      w.u32(120); // offBitsSrc
      w.u32(bits.length);
      w.u32(0); // DIB_RGB_COLORS
      w.u32(0x00cc0020); // SRCCOPY
      w.i32(dest[2] - dest[0]);
      w.i32(dest[3] - dest[1]);
      // BITMAPINFOHEADER
      w.u32(40);
      w.i32(cw);
      w.i32(ch);
      w.u16(1);
      w.u16(24);
      w.u32(0);
      w.u32(bits.length);
      w.i32(2835);
      w.i32(2835);
      w.u32(0);
      w.u32(0);
      w.bytes(bits);
    });
  }
}

function utf16(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
}

export async function exportEmfBytes(
  doc: CurvsDocument,
  scope: ExportScope,
  _opts: Partial<EmfExportOptions>,
  ctx: ExportContext,
): Promise<Uint8Array> {
  const warn = warner(ctx);
  const page = pagesForScope(doc, scope, ctx, false)[0] ?? {
    name: ctx.name,
    width: 1,
    height: 1,
    x: 0,
    y: 0,
    backgrounds: [],
    roots: [],
    artboards: [],
  };
  const fonts = await loadFonts(collectText(page, doc));
  const ops = flattenPage(page, { doc, fonts, textOutlines: true, warn });
  const e = new EmfWriter(doc, warn);
  const Wl = Math.max(1, Math.round(page.width * EMF_UNITS_PER_PT));
  const Hl = Math.max(1, Math.round(page.height * EMF_UNITS_PER_PT));
  const mmW = (page.width / 72) * 25.4;
  const mmH = (page.height / 72) * 25.4;
  const refMmW = Math.max(1, Math.ceil(mmW));
  const refMmH = Math.max(1, Math.ceil(mmH));
  // Reference device at 1440 dpi: one device pixel per logical unit.
  const devW = Math.round((refMmW / 25.4) * 1440);
  const devH = Math.round((refMmH / 25.4) * 1440);
  const desc = utf16(`Curvesmith\0${(ctx.name || 'Untitled').slice(0, 64)}\0\0`);
  e.rec(EMR.HEADER, (w) => {
    e.rect(w, [0, 0, Wl - 1, Hl - 1]);
    e.rect(w, [0, 0, Math.round(mmW * 100), Math.round(mmH * 100)]);
    w.u32(0x464d4520); // " EMF"
    w.u32(0x00010000);
    w.u32(0); // nBytes, patched below
    w.u32(0); // nRecords, patched below
    w.u16(4); // handles: 0 reserved, pen, brush, font
    w.u16(0);
    w.u32(desc.length / 2);
    w.u32(108);
    w.u32(0);
    w.i32(devW);
    w.i32(devH);
    w.i32(refMmW);
    w.i32(refMmH);
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.i32(refMmW * 1000);
    w.i32(refMmH * 1000);
    w.bytes(desc);
  });
  e.u32rec(EMR.SETMAPMODE, 8); // MM_ANISOTROPIC
  e.i32rec(EMR.SETWINDOWORGEX, 0, 0);
  e.i32rec(EMR.SETWINDOWEXTEX, Wl, Hl);
  e.i32rec(EMR.SETVIEWPORTORGEX, 0, 0);
  e.i32rec(EMR.SETVIEWPORTEXTEX, Wl, Hl);
  e.u32rec(EMR.SETBKMODE, 1); // TRANSPARENT
  e.u32rec(EMR.SELECTOBJECT, NULL_PEN);
  e.u32rec(EMR.SELECTOBJECT, NULL_BRUSH);
  for (const o of ops) e.draw(o);
  e.rec(EMR.EOF, (w) => {
    w.u32(0);
    w.u32(16);
    w.u32(20);
  });
  e.w.setU32(48, e.w.length);
  e.w.setU32(52, e.records);
  return e.w.result();
}
