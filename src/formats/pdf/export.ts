/* PDF writer (pdf-lib, low-level operators so curves stay exact). One page per artboard for scope "all".
   Content is drawn in a y-down frame: every page starts with `cm 1 0 0 -1 ox oy` so document coordinates
   map straight through. Gradients are shading patterns, opacity and blend modes are ExtGStates, layers are
   optional content groups (keepLayers). Text embeds its font when possible, else becomes outlines, else
   falls back to Helvetica. */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames as Ops,
  StandardFonts,
  TextRenderingMode,
  appendBezierCurve,
  beginText,
  clip,
  clipEvenOdd,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  setDashPattern,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingCmykColor,
  setStrokingRgbColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  stroke,
  PDFDict,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { BlendMode, CurvsDocument, ExportScope, Matrix, Paint, Subpath } from '../../core/types';
import { invert, multiply } from '../../core/matrix';
import { resolveColor } from '../../core/color';
import { subpathsBounds } from '../../core/geometry/bezier';
import { layoutText, primaryRun } from '../../core/text';
import { toPt } from '../../core/units';
import { type ExportContext, warner } from '../types';
import type { PdfExportOptions } from '../registry';
import { pagesForScope, type Page } from '../shared/pages';
import {
  collectText,
  flattenPage,
  pathSegments,
  resolvedStops,
  type DrawOp,
  type TextOp,
} from '../shared/scene';
import { fontKey, loadFonts, type LoadedFont } from '../shared/fonts';
import { dataUrlToBytes, sniffImageMime } from '../shared/bytes';

export const BLEED_PT = toPt(3, 'mm');
const MARK_MARGIN = 20;

const BM: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

const op = (name: Ops, args: (number | string)[] = []) =>
  PDFOperator.of(
    name,
    args.map((a) => (typeof a === 'number' ? PDFNumber.of(a) : PDFName.of(a))),
  );

/** Rasterize an image the PDF can't embed directly (WebP, GIF, SVG) to PNG, in browsers. */
async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const bmp = await createImageBitmap(new Blob([copy.buffer], { type: mime }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')?.drawImage(bmp, 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } catch {
    return null;
  }
}

class PdfPageWriter {
  ops: PDFOperator[] = [];
  private gs = new Map<string, PDFName>();
  private patterns = 0;
  private props = new Map<string, string>();

  constructor(
    private w: PdfWriter,
    private page: PDFPage,
    /** Page-space (y down) → PDF default space. */
    public base: Matrix,
  ) {}

  private resources(kind: string): PDFDict {
    const res = this.page.node.normalizedEntries().Resources;
    const existing = res.lookup(PDFName.of(kind));
    if (existing instanceof PDFDict) return existing;
    const d = this.w.pdf.context.obj({});
    res.set(PDFName.of(kind), d);
    return d;
  }

  extGState(fillAlpha: number, strokeAlpha: number, blend: BlendMode): PDFName | null {
    const ca = Math.round(fillAlpha * 1000) / 1000;
    const CA = Math.round(strokeAlpha * 1000) / 1000;
    if (ca >= 1 && CA >= 1 && blend === 'normal') return null;
    const key = `${ca}|${CA}|${blend}`;
    let name = this.gs.get(key);
    if (!name) {
      const dict = this.w.pdf.context.obj({ Type: 'ExtGState', ca, CA, BM: BM[blend] ?? 'Normal' });
      name = this.page.node.newExtGState('GS', dict);
      this.gs.set(key, name);
    }
    return name;
  }

  path(subpaths: Subpath[]) {
    for (const s of pathSegments(subpaths)) {
      if (s.t === 'M') this.ops.push(moveTo(s.p[0], s.p[1]));
      else if (s.t === 'L') this.ops.push(lineTo(s.p[0], s.p[1]));
      else if (s.t === 'C')
        this.ops.push(appendBezierCurve(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.p[0], s.p[1]));
      else this.ops.push(closePath());
    }
  }

  /** Shading pattern for a gradient whose coordinates are in the space given by `m` (page space). */
  gradientPattern(p: Extract<Paint, { stops: unknown }>, m: Matrix): string {
    const ctx = this.w.pdf.context;
    const stops = resolvedStops(p, this.w.doc);
    const fn = (a: (typeof stops)[number], b: (typeof stops)[number]) =>
      ctx.obj({
        FunctionType: 2,
        Domain: [0, 1],
        C0: [a.color.r, a.color.g, a.color.b],
        C1: [b.color.r, b.color.g, b.color.b],
        N: 1,
      });
    let func;
    if (stops.length === 2) func = fn(stops[0], stops[1]);
    else {
      const fns = [];
      const bounds: number[] = [];
      const encode: number[] = [];
      for (let i = 0; i < stops.length - 1; i++) {
        fns.push(fn(stops[i], stops[i + 1]));
        if (i > 0) bounds.push(stops[i].offset);
        encode.push(0, 1);
      }
      func = ctx.obj({ FunctionType: 3, Domain: [0, 1], Functions: fns, Bounds: bounds, Encode: encode });
    }
    if (stops.some((s) => s.color.a < 1)) this.w.warn('Gradient transparency was simplified.');
    if (p.type === 'conic') this.w.warn('Conic gradients were saved as linear gradients.');
    const [fx, fy] = p.from;
    const [tx, ty] = p.to;
    const shading =
      p.type === 'radial'
        ? ctx.obj({
            ShadingType: 3,
            ColorSpace: 'DeviceRGB',
            Coords: [fx, fy, 0, fx, fy, Math.hypot(tx - fx, ty - fy) || 1],
            Function: func,
            Extend: [true, true],
          })
        : ctx.obj({
            ShadingType: 2,
            ColorSpace: 'DeviceRGB',
            Coords: [fx, fy, tx, ty],
            Function: func,
            Extend: [true, true],
          });
    const pm = multiply(this.base, m);
    const pattern = ctx.register(ctx.obj({ PatternType: 2, Shading: shading, Matrix: pm }));
    const name = `P${++this.patterns}`;
    this.resources('Pattern').set(PDFName.of(name), pattern);
    return name;
  }

  /** Set fill or stroke paint. Returns the alpha to put in the ExtGState. */
  setPaint(p: Paint, m: Matrix, kind: 'fill' | 'stroke', opacity: number): number {
    if (p.type === 'solid') {
      const c = resolveColor(p.color, this.w.doc.swatches);
      this.ops.push(kind === 'fill' ? setFillingRgbColor(c.r, c.g, c.b) : setStrokingRgbColor(c.r, c.g, c.b));
      return c.a * opacity;
    }
    const name = this.gradientPattern(p, m);
    this.ops.push(op(kind === 'fill' ? Ops.NonStrokingColorspace : Ops.StrokingColorspace, ['Pattern']));
    this.ops.push(op(kind === 'fill' ? Ops.NonStrokingColorN : Ops.StrokingColorN, [name]));
    const stops = resolvedStops(p, this.w.doc);
    return opacity * (stops.reduce((s, x) => s + x.color.a, 0) / stops.length);
  }

  begin(m: Matrix): boolean {
    if (Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-12) return false;
    this.ops.push(pushGraphicsState(), concatTransformationMatrix(...m));
    return true;
  }

  async draw(o: DrawOp) {
    switch (o.op) {
      case 'fill': {
        if (!o.subpaths.length || !this.begin(o.m)) return;
        const a = this.setPaint(o.paint, o.m, 'fill', o.opacity);
        const gs = this.extGState(a, 1, o.blend);
        if (gs) this.ops.push(setGraphicsState(gs));
        this.path(o.subpaths);
        this.ops.push(o.evenOdd ? op(Ops.FillEvenOdd) : fill(), popGraphicsState());
        return;
      }
      case 'stroke': {
        if (!o.subpaths.length || !this.begin(o.m)) return;
        let width = o.width;
        if (o.align !== 'center') {
          if (o.align === 'outside') {
            const b = subpathsBounds(o.subpaths) ?? { x: 0, y: 0, width: 0, height: 0 };
            const pad = o.width * 4 + 1000;
            this.ops.push(
              moveTo(b.x - pad, b.y - pad),
              lineTo(b.x + b.width + pad, b.y - pad),
              lineTo(b.x + b.width + pad, b.y + b.height + pad),
            );
            this.ops.push(lineTo(b.x - pad, b.y + b.height + pad), closePath());
          }
          this.path(o.subpaths);
          this.ops.push(o.align === 'outside' || o.evenOdd ? clipEvenOdd() : clip(), endPath());
          width *= 2;
        }
        const a = this.setPaint(o.paint, o.m, 'stroke', o.opacity);
        const gs = this.extGState(1, a, o.blend);
        if (gs) this.ops.push(setGraphicsState(gs));
        this.ops.push(setLineWidth(width));
        this.ops.push(
          setLineCap(
            o.cap === 'round'
              ? LineCapStyle.Round
              : o.cap === 'square'
                ? LineCapStyle.Projecting
                : LineCapStyle.Butt,
          ),
        );
        this.ops.push(
          setLineJoin(
            o.join === 'round'
              ? LineJoinStyle.Round
              : o.join === 'bevel'
                ? LineJoinStyle.Bevel
                : LineJoinStyle.Miter,
          ),
        );
        if (o.join === 'miter') this.ops.push(op(Ops.SetLineMiterLimit, [Math.max(1, o.miter)]));
        if (o.dash.length && o.dash.some((d) => d > 0)) this.ops.push(setDashPattern(o.dash, o.dashOffset));
        this.path(o.subpaths);
        this.ops.push(stroke(), popGraphicsState());
        return;
      }
      case 'clip': {
        if (!this.begin(o.m)) {
          this.ops.push(pushGraphicsState());
          return;
        }
        this.path(o.subpaths);
        this.ops.push(
          o.evenOdd ? clipEvenOdd() : clip(),
          endPath(),
          concatTransformationMatrix(...invert(o.m)),
        );
        return;
      }
      case 'unclip':
        this.ops.push(popGraphicsState());
        return;
      case 'layer': {
        if (!this.w.opts.keepLayers) return;
        let key = this.props.get(o.name);
        if (!key) {
          key = `OC${this.props.size + 1}`;
          this.props.set(o.name, key);
          this.resources('Properties').set(PDFName.of(key), this.w.ocg(o.name));
        }
        this.ops.push(PDFOperator.of(Ops.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(key)]));
        return;
      }
      case 'endLayer':
        if (this.w.opts.keepLayers) this.ops.push(PDFOperator.of(Ops.EndMarkedContent));
        return;
      case 'image':
        await this.image(o);
        return;
      case 'text':
        await this.text(o);
        return;
    }
  }

  async image(o: Extract<DrawOp, { op: 'image' }>) {
    const img = o.src ? await this.w.image(o.src) : null;
    if (!img || !this.begin(o.m)) return;
    const n = o.node;
    const gs = this.extGState(o.opacity, 1, o.blend);
    if (gs) this.ops.push(setGraphicsState(gs));
    const name = this.page.node.newXObject('Im', img.ref);
    if (n.crop && n.crop.width > 0 && n.crop.height > 0) {
      this.ops.push(
        moveTo(0, 0),
        lineTo(n.width, 0),
        lineTo(n.width, n.height),
        lineTo(0, n.height),
        closePath(),
        clip(),
        endPath(),
      );
      const sx = n.width / n.crop.width;
      const sy = n.height / n.crop.height;
      const W = img.width * sx;
      const H = img.height * sy;
      this.ops.push(concatTransformationMatrix(W, 0, 0, -H, -n.crop.x * sx, -n.crop.y * sy + H));
    } else this.ops.push(concatTransformationMatrix(n.width, 0, 0, -n.height, 0, n.height));
    this.ops.push(drawObject(name), popGraphicsState());
  }

  async text(o: TextOp) {
    const n = o.node;
    const run = primaryRun(n);
    const font = await this.w.font(n.runs[0].font);
    if (!this.begin(o.m)) return;
    const a = this.setPaint(o.paint, o.m, o.stroke ? 'stroke' : 'fill', o.opacity);
    const gs = o.stroke ? this.extGState(1, a, o.blend) : this.extGState(a, 1, o.blend);
    if (gs) this.ops.push(setGraphicsState(gs));
    const key = this.page.node.newFontDictionary('F', font.pdf.ref);
    this.ops.push(beginText(), setFontAndSize(key, run.size));
    if (run.tracking) this.ops.push(setCharacterSpacing((run.tracking / 1000) * run.size));
    if (o.stroke) {
      this.ops.push(setTextRenderingMode(TextRenderingMode.Outline), setLineWidth(o.stroke.width));
      this.ops.push(
        setLineJoin(
          o.stroke.join === 'round'
            ? LineJoinStyle.Round
            : o.stroke.join === 'bevel'
              ? LineJoinStyle.Bevel
              : LineJoinStyle.Miter,
        ),
      );
    }
    for (const line of layoutText(n).lines) {
      if (!line.text) continue;
      this.ops.push(setTextMatrix(1, 0, 0, -1, line.x, line.baseline), showText(font.encode(line.text)));
    }
    this.ops.push(endText(), popGraphicsState());
  }

  cropMarks(trim: { x: number; y: number; width: number; height: number }, bleed: number) {
    const gap = bleed + 3;
    const len = 14;
    const { x, y, width: w, height: h } = trim;
    this.ops.push(pushGraphicsState(), setStrokingCmykColor(1, 1, 1, 1), setLineWidth(0.25));
    const line = (x1: number, y1: number, x2: number, y2: number) =>
      this.ops.push(moveTo(x1, y1), lineTo(x2, y2), stroke());
    for (const cx of [x, x + w]) {
      for (const cy of [y, y + h]) {
        const sx = cx === x ? -1 : 1;
        const sy = cy === y ? -1 : 1;
        line(cx + sx * gap, cy, cx + sx * (gap + len), cy);
        line(cx, cy + sy * gap, cx, cy + sy * (gap + len));
      }
    }
    this.ops.push(popGraphicsState());
  }

  flush() {
    for (let i = 0; i < this.ops.length; i += 4000) this.page.pushOperators(...this.ops.slice(i, i + 4000));
    this.ops = [];
  }
}

type FontHandle = { pdf: PDFFont; encode: (s: string) => PDFHexString };

class PdfWriter {
  private images = new Map<string, Promise<PDFImage | null>>();
  private fontsCache = new Map<string, Promise<FontHandle>>();
  private ocgs = new Map<string, PDFRef>();
  private fontkitReady: Promise<void> | null = null;

  constructor(
    public pdf: PDFDocument,
    public doc: CurvsDocument,
    public opts: PdfExportOptions,
    public fonts: Map<string, LoadedFont>,
    public warn: (m: string) => void,
  ) {}

  image(src: string): Promise<PDFImage | null> {
    let p = this.images.get(src);
    if (!p) {
      p = (async () => {
        const d = dataUrlToBytes(src);
        if (!d) return null;
        const mime = sniffImageMime(d.bytes) ?? d.mime;
        try {
          if (mime === 'image/png') return await this.pdf.embedPng(d.bytes);
          if (mime === 'image/jpeg') return await this.pdf.embedJpg(d.bytes);
          const png = await toPng(d.bytes, mime);
          if (png) return await this.pdf.embedPng(png);
        } catch {
          /* fall through */
        }
        this.warn('Some images could not be embedded and were left out.');
        return null;
      })();
      this.images.set(src, p);
    }
    return p;
  }

  font(ref: { family: string; weight: number; style: 'normal' | 'italic' }): Promise<FontHandle> {
    const key = fontKey(ref);
    let p = this.fontsCache.get(key);
    if (!p) {
      p = (async () => {
        const loaded = this.fonts.get(key);
        if (loaded && this.opts.embedFonts) {
          try {
            this.fontkitReady ??= import('@pdf-lib/fontkit').then((m) =>
              this.pdf.registerFontkit((m.default ?? m) as never),
            );
            await this.fontkitReady;
            const f = await this.pdf.embedFont(loaded.bytes, { subset: true });
            return { pdf: f, encode: (s: string) => f.encodeText(s) };
          } catch {
            /* fall back below */
          }
        }
        this.warn('Some fonts were unavailable and were replaced with Helvetica.');
        const f = await this.pdf.embedFont(
          ref.weight >= 600 ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
        );
        const allowed = new Set(f.getCharacterSet());
        return {
          pdf: f,
          encode: (s: string) =>
            f.encodeText([...s].map((ch) => (allowed.has(ch.codePointAt(0)!) ? ch : '?')).join('')),
        };
      })();
      this.fontsCache.set(key, p);
    }
    return p;
  }

  ocg(name: string): PDFRef {
    let r = this.ocgs.get(name);
    if (!r) {
      const ctx = this.pdf.context;
      r = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(name) }));
      this.ocgs.set(name, r);
    }
    return r;
  }

  finishLayers() {
    if (!this.ocgs.size) return;
    const refs = [...this.ocgs.values()];
    const ctx = this.pdf.context;
    this.pdf.catalog.set(
      PDFName.of('OCProperties'),
      ctx.obj({ OCGs: refs, D: { Order: refs, ON: refs, BaseState: 'ON' } }),
    );
  }
}

async function writePage(w: PdfWriter, page: Page, fontsOutline: boolean) {
  const bleed = w.opts.bleed ? BLEED_PT : 0;
  const off = bleed + (w.opts.cropMarks ? MARK_MARGIN : 0);
  const W = page.width + off * 2;
  const H = page.height + off * 2;
  const p = w.pdf.addPage([W, H]);
  p.setMediaBox(0, 0, W, H);
  p.setTrimBox(off, off, page.width, page.height);
  if (bleed) p.setBleedBox(off - bleed, off - bleed, page.width + bleed * 2, page.height + bleed * 2);
  const base: Matrix = [1, 0, 0, -1, off, H - off];
  const pw = new PdfPageWriter(w, p, base);
  pw.ops.push(pushGraphicsState(), concatTransformationMatrix(...base));
  const bgPage: Page = bleed
    ? {
        ...page,
        backgrounds: page.backgrounds.map((b) => ({
          ...b,
          rect: {
            x: b.rect.x - bleed,
            y: b.rect.y - bleed,
            width: b.rect.width + bleed * 2,
            height: b.rect.height + bleed * 2,
          },
        })),
      }
    : page;
  const ops = flattenPage(bgPage, { doc: w.doc, fonts: w.fonts, textOutlines: fontsOutline, warn: w.warn });
  for (const o of ops) await pw.draw(o);
  pw.ops.push(popGraphicsState());
  if (w.opts.cropMarks) pw.cropMarks({ x: off, y: off, width: page.width, height: page.height }, bleed);
  pw.flush();
}

export const PDF_DEFAULTS: PdfExportOptions = {
  compatibility: 'PDF 1.7',
  embedFonts: true,
  keepLayers: false,
  bleed: false,
  cropMarks: false,
};

export async function exportPdfBytes(
  doc: CurvsDocument,
  scope: ExportScope,
  options: Partial<PdfExportOptions>,
  ctx: ExportContext,
): Promise<Uint8Array> {
  const opts = { ...PDF_DEFAULTS, ...options };
  const warn = warner(ctx);
  const pages = pagesForScope(doc, scope, ctx, true);
  const pdf = await PDFDocument.create();
  const now = new Date();
  pdf.setTitle(ctx.name || 'Untitled');
  pdf.setProducer('Curvesmith');
  pdf.setCreator('Curvesmith');
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const texts = pages.flatMap((pg) => collectText(pg, doc));
  const fonts = texts.length ? await loadFonts(texts) : new Map<string, LoadedFont>();
  const w = new PdfWriter(pdf, doc, opts, fonts, warn);
  // Without embedding, text becomes outlines where the font is available (Helvetica otherwise).
  const outline = !opts.embedFonts;
  for (const page of pages) await writePage(w, page, outline);
  if (!pages.length) pdf.addPage([595, 842]);
  w.finishLayers();
  return pdf.save({ useObjectStreams: false });
}
