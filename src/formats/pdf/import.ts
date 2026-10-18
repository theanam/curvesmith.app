/* PDF (and PDF-based AI) reader built on pdf.js (lazy-loaded). Walks each page's operator list and rebuilds
   paths with fills and strokes, clip groups, text (as live text where the operators allow) and images.
   One artboard per page (TrimBox when present). Shading patterns become linear/radial gradients.
   Soft masks, image masks and tiling patterns are reported and simplified. */
import type {
  Artboard,
  BlendMode,
  ClipGroupNode,
  CurvsDocument,
  ImageNode,
  ImportReport,
  Matrix,
  Paint,
  PathNode,
  PathShape,
  SceneNode,
  StrokeItem,
  Subpath,
  TextNode,
  Vec,
} from '../../core/types';
import { createDocument, makeFill, makeGroup, makePath, makeStroke, makeText } from '../../core/document';
import { apply, applyVector, IDENTITY, multiply, rotate, translate } from '../../core/matrix';
import { hexToColor, rgb } from '../../core/color';
import { layoutText } from '../../core/text';
import { newId } from '../../core/id';
import { countMessage, emptyReport, note, type ImportOptions } from '../types';
import { bytesToDataUrl, sha256Hex } from '../shared/bytes';
import { encodePng } from '../shared/png';
import { loadOpentype } from '../shared/fonts';

/* pdf.js operator ids (stable across versions; see OPS in pdf.js). */
const OP = {
  setLineWidth: 2,
  setLineCap: 3,
  setLineJoin: 4,
  setMiterLimit: 5,
  setDash: 6,
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  setStrokeColorN: 53,
  setFillColorN: 55,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  shadingFill: 62,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
  constructPath: 91,
  setStrokeTransparent: 92,
  setFillTransparent: 93,
} as const;

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

type Glyph = { unicode?: string; width?: number; isSpace?: boolean } | number | null;
type PdfObjs = { get(id: string, cb?: (v: unknown) => void): unknown; has?(id: string): boolean };
type PdfPage = {
  view: number[];
  rotate: number;
  objs: PdfObjs;
  commonObjs: PdfObjs;
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  cleanup?(): void;
};
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> };
type PdfJs = {
  getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy(): Promise<void> };
  GlobalWorkerOptions: { workerSrc: string };
};

let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js (legacy build for broad browser and Node support), with its worker configured for Vite. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    const g = globalThis as { pdfjsWorker?: unknown; process?: unknown };
    const inBrowser = typeof window !== 'undefined' && typeof Worker !== 'undefined' && !g.process;
    if (inBrowser) {
      const url = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
      lib.GlobalWorkerOptions.workerSrc = url;
    } else if (!g.pdfjsWorker) {
      // No worker threads here (tests, Node): run the worker code on the main thread.
      g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    }
    return lib;
  })();
  pdfjsPromise.catch(() => {
    pdfjsPromise = null;
  });
  return pdfjsPromise;
}

const BLEND_BY_CANVAS: Record<string, BlendMode> = {
  'source-over': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/semi\s*bold|demi/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
];

/** "ABCDEF+TimesNewRomanPS-BoldItalicMT-123" → { family: 'Times New Roman', weight: 700, italic: true }. */
export function parseFontName(raw: string): { family: string; weight: number; italic: boolean } {
  let s = raw.replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, '');
  const [famPart, ...styleParts] = s.split(/[-,]/);
  const style = styleParts.join(' ');
  s = famPart.replace(/(PS)?MT$/, '').replace(/PS$/, '');
  const family = s.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Helvetica';
  let weight = 400;
  for (const [re, w] of WEIGHTS) {
    if (re.test(style)) {
      weight = w;
      break;
    }
  }
  return { family, weight, italic: /italic|oblique/i.test(style) };
}

type Font = { family: string; weight: number; italic: boolean; fontMatrix: number[] };

type State = {
  ctm: Matrix;
  fill: Paint | null;
  stroke: Paint | null;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
  cap: StrokeItem['cap'];
  join: StrokeItem['join'];
  miter: number;
  dash: number[];
  dashPhase: number;
  blend: BlendMode;
  font: Font | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  textMode: number;
  container: SceneNode[];
};

type Counters = {
  softMasks: number;
  imageMasks: number;
  tiling: number;
  shadings: number;
  hiddenText: number;
  images: number;
  text: number;
  paths: number;
};

class PageReader {
  st: State;
  stack: State[] = [];
  tm: Matrix = [...IDENTITY];
  tlm: Matrix = [...IDENTITY];
  pendingClip: 'nonzero' | 'evenodd' | null = null;
  lastFill: { node: PathShape; key: string; container: SceneNode[] } | null = null;
  lastText: {
    node: TextNode;
    end: Vec;
    size: number;
    angle: number;
    color: string;
    container: SceneNode[];
  } | null = null;
  fonts = new Map<string, Font>();
  resolved = new Map<string, unknown>();
  root: SceneNode[] = [];

  constructor(
    private page: PdfPage,
    private base: Matrix,
    private doc: CurvsDocument,
    private c: Counters,
  ) {
    this.st = {
      ctm: [...IDENTITY],
      fill: { type: 'solid', color: rgb(0, 0, 0) },
      stroke: { type: 'solid', color: rgb(0, 0, 0) },
      fillAlpha: 1,
      strokeAlpha: 1,
      lineWidth: 1,
      cap: 'butt',
      join: 'miter',
      miter: 10,
      dash: [],
      dashPhase: 0,
      blend: 'normal',
      font: null,
      fontSize: 12,
      charSpacing: 0,
      wordSpacing: 0,
      hScale: 1,
      leading: 0,
      rise: 0,
      textMode: 0,
      container: this.root,
    };
  }

  get M(): Matrix {
    return multiply(this.base, this.st.ctm);
  }

  /** Resolve pdf.js objects (images, patterns, fonts) up front; they arrive asynchronously. */
  async resolve(ids: Set<string>, timeout = 5000) {
    await Promise.all(
      [...ids].map(
        (id) =>
          new Promise<void>((done) => {
            const store = id.startsWith('g_') ? this.page.commonObjs : this.page.objs;
            const t = setTimeout(done, timeout);
            try {
              store.get(id, (v) => {
                clearTimeout(t);
                this.resolved.set(id, v);
                done();
              });
            } catch {
              clearTimeout(t);
              done();
            }
          }),
      ),
    );
  }

  async loadFonts() {
    const ot = await loadOpentype();
    for (const [id, v] of this.resolved) {
      if (!id.startsWith('g_') || !v || typeof v !== 'object') continue;
      const f = v as {
        data?: Uint8Array;
        bold?: boolean;
        italic?: boolean;
        black?: boolean;
        fallbackName?: string;
        fontMatrix?: number[];
      };
      let name: string | null = null;
      if (f.data && ot) {
        try {
          const copy = f.data.slice();
          const parsed = ot.parse(copy.buffer) as unknown as {
            names: Record<string, Record<string, Record<string, string>> | Record<string, string>>;
          };
          const n = parsed.names;
          const pick = (k: string) =>
            (n.windows as Record<string, Record<string, string>> | undefined)?.[k]?.en ??
            (n.macintosh as Record<string, Record<string, string>> | undefined)?.[k]?.en ??
            (n[k] as Record<string, string> | undefined)?.en;
          name = pick('postScriptName') ?? pick('fullName') ?? pick('fontFamily') ?? null;
        } catch {
          name = null;
        }
      }
      const fallback =
        f.fallbackName === 'serif' ? 'Times' : f.fallbackName === 'monospace' ? 'Courier' : 'Helvetica';
      const parsed = parseFontName(name ?? fallback);
      this.fonts.set(id, {
        family: parsed.family,
        weight: f.black ? 900 : f.bold && parsed.weight < 700 ? 700 : parsed.weight,
        italic: parsed.italic || !!f.italic,
        fontMatrix: f.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0],
      });
    }
  }

  save() {
    this.stack.push(this.st);
    this.st = { ...this.st, dash: [...this.st.dash] };
  }

  restore() {
    const s = this.stack.pop();
    if (s) this.st = s;
  }

  subpaths(buf: ArrayLike<number> | null, m: Matrix): Subpath[] {
    const out: Subpath[] = [];
    if (!buf) return out;
    let cur: Subpath | null = null;
    let last: Vec = [0, 0];
    const node = (p: Vec): PathNode => ({ x: p[0], y: p[1], in: null, out: null, kind: 'sharp' });
    for (let i = 0; i < buf.length;) {
      const op = buf[i++];
      if (op === DRAW.moveTo) {
        last = apply(m, [buf[i++], buf[i++]]);
        cur = { closed: false, nodes: [node(last)] };
        out.push(cur);
      } else if (op === DRAW.lineTo) {
        last = apply(m, [buf[i++], buf[i++]]);
        if (!cur) out.push((cur = { closed: false, nodes: [] }));
        cur.nodes.push(node(last));
      } else if (op === DRAW.curveTo || op === DRAW.quadraticCurveTo) {
        let c1: Vec;
        let c2: Vec;
        let p: Vec;
        if (op === DRAW.curveTo) {
          c1 = apply(m, [buf[i++], buf[i++]]);
          c2 = apply(m, [buf[i++], buf[i++]]);
          p = apply(m, [buf[i++], buf[i++]]);
        } else {
          const q = apply(m, [buf[i++], buf[i++]]);
          p = apply(m, [buf[i++], buf[i++]]);
          c1 = [last[0] + (2 / 3) * (q[0] - last[0]), last[1] + (2 / 3) * (q[1] - last[1])];
          c2 = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])];
        }
        if (!cur) out.push((cur = { closed: false, nodes: [node(last)] }));
        cur.nodes[cur.nodes.length - 1].out = c1;
        cur.nodes.push({ ...node(p), in: c2 });
        last = p;
      } else if (op === DRAW.closePath) {
        if (cur) {
          const f = cur.nodes[0];
          const l = cur.nodes[cur.nodes.length - 1];
          if (cur.nodes.length > 1 && Math.abs(f.x - l.x) < 1e-4 && Math.abs(f.y - l.y) < 1e-4) {
            f.in = l.in;
            cur.nodes.pop();
          }
          cur.closed = true;
          last = [f.x, f.y];
          cur = null;
        }
      } else break;
    }
    return out.filter((s) => s.nodes.length > 0);
  }

  shadingPaint(id: string, matrix: number[] | null): Paint | null {
    const ir = this.resolved.get(id) as unknown[] | undefined;
    if (!Array.isArray(ir)) return null;
    if (ir[0] !== 'RadialAxial') {
      this.c.shadings++;
      return null;
    }
    const stops = (ir[3] as [number, string][]).map(([offset, hex]) => ({
      offset,
      color: hexToColor(hex) ?? rgb(0, 0, 0),
    }));
    const pm = multiply(this.base, matrix && matrix.length === 6 ? (matrix as Matrix) : this.st.ctm);
    const p0 = ir[4] as Vec;
    const p1 = ir[5] as Vec;
    if (ir[1] === 'radial') {
      const r1 = Number(ir[7]) || 1;
      return { type: 'radial', stops, from: apply(pm, p1), to: apply(pm, [p1[0] + r1, p1[1]]) };
    }
    return { type: 'linear', stops, from: apply(pm, p0), to: apply(pm, p1) };
  }

  colorPaint(args: unknown[]): Paint | null {
    const hex = typeof args[0] === 'string' ? args[0] : null;
    const c = hex ? hexToColor(hex) : null;
    return c ? { type: 'solid', color: c } : null;
  }

  patternPaint(args: unknown[]): Paint | null {
    if (args[0] === 'TilingPattern') {
      this.c.tiling++;
      return { type: 'solid', color: rgb(0.6, 0.6, 0.6) };
    }
    if (args[0] === 'Shading' && typeof args[1] === 'string')
      return this.shadingPaint(args[1], (args[2] as number[]) ?? null);
    return null;
  }

  add(n: SceneNode) {
    this.st.container.push(n);
  }

  paintPath(op: number, buf: ArrayLike<number> | null) {
    const M = this.M;
    const subpaths = this.subpaths(buf, M);
    if (this.pendingClip) {
      const clip = makePath(subpaths, { items: [] }, 'Clip');
      clip.fillRule = this.pendingClip;
      const { children: _c, type: _t, ...base } = makeGroup([], 'Clip group');
      const g: ClipGroupNode = { ...base, type: 'clipGroup', clip, children: [] };
      this.add(g);
      this.st.container = g.children;
      this.pendingClip = null;
      this.lastFill = null;
    }
    if (!subpaths.length || op === OP.endPath) return;
    const doFill =
      op === OP.fill ||
      op === OP.eoFill ||
      op === OP.fillStroke ||
      op === OP.eoFillStroke ||
      op === OP.closeFillStroke ||
      op === OP.closeEOFillStroke;
    const doStroke =
      op === OP.stroke ||
      op === OP.closeStroke ||
      op === OP.fillStroke ||
      op === OP.eoFillStroke ||
      op === OP.closeFillStroke ||
      op === OP.closeEOFillStroke;
    if (op === OP.closeStroke || op === OP.closeFillStroke || op === OP.closeEOFillStroke)
      for (const s of subpaths) s.closed = true;
    const evenOdd = op === OP.eoFill || op === OP.eoFillStroke || op === OP.closeEOFillStroke;
    const key = `${this.st.ctm.join(',')}|${buf ? Array.from(buf).join(',') : ''}`;
    const items: PathShape['appearance']['items'] = [];
    if (doFill && this.st.fill) {
      const f = makeFill();
      f.paint = this.st.fill;
      f.opacity = this.st.fillAlpha;
      items.push(f);
    }
    let stroke: StrokeItem | null = null;
    if (doStroke && this.st.stroke) {
      const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
      stroke = makeStroke(undefined, Math.max(this.st.lineWidth, 0) * scale || 0.25);
      stroke.paint = this.st.stroke;
      stroke.opacity = this.st.strokeAlpha;
      stroke.cap = this.st.cap;
      stroke.join = this.st.join;
      stroke.miter = this.st.miter;
      stroke.dash = this.st.dash.map((d) => d * scale);
      stroke.dashOffset = this.st.dashPhase * scale;
    }
    // A stroke painted right after a fill of the same path joins that object (fill + stroke = one shape).
    if (
      stroke &&
      !doFill &&
      this.lastFill &&
      this.lastFill.key === key &&
      this.lastFill.container === this.st.container
    ) {
      const target = this.lastFill.node;
      if (target.appearance.items.length === 1 && target.blend === this.st.blend) {
        target.appearance.items.push(stroke);
        this.lastFill = null;
        return;
      }
    }
    if (stroke) items.push(stroke);
    if (!items.length) return;
    const p = makePath(subpaths, { items });
    p.fillRule = evenOdd ? 'evenodd' : 'nonzero';
    p.blend = this.st.blend;
    this.add(p);
    this.c.paths++;
    this.lastFill = doFill && !doStroke ? { node: p, key, container: this.st.container } : null;
    this.lastText = null;
  }

  showText(glyphs: Glyph[]) {
    const st = this.st;
    const font = st.font;
    if (!font) return;
    const size = st.fontSize;
    const fm = font.fontMatrix[0] || 0.001;
    const start = this.tm;
    let x = 0;
    let text = '';
    for (const g of glyphs) {
      if (g === null || g === undefined) continue;
      if (typeof g === 'number') {
        const dx = (-g / 1000) * size * st.hScale;
        if (dx > size * 0.2 && text && !text.endsWith(' ')) text += ' ';
        x += dx;
        continue;
      }
      text += g.unicode ?? '';
      x += ((g.width ?? 0) * fm * size + st.charSpacing + (g.isSpace ? st.wordSpacing : 0)) * st.hScale;
    }
    this.tm = multiply(this.tm, translate(x, 0));
    if (st.textMode === 3 || st.textMode === 7) {
      if (text.trim()) this.c.hiddenText++;
      return;
    }
    if (!text.trim()) return;
    const full = multiply(this.M, start);
    const origin = apply(full, [0, st.rise]);
    const end = apply(full, [x, st.rise]);
    const axis = applyVector(full, [1, 0]);
    const px = Math.hypot(axis[0], axis[1]) * size;
    const angle = Math.atan2(axis[1], axis[0]);
    const strokeMode = st.textMode === 1 || st.textMode === 5;
    const paint = strokeMode ? st.stroke : st.fill;
    const colorKey = JSON.stringify(paint);
    const lt = this.lastText;
    if (
      lt &&
      lt.container === st.container &&
      Math.abs(lt.size - px) < 0.01 &&
      Math.abs(lt.angle - angle) < 1e-3 &&
      lt.color === colorKey &&
      Math.hypot(origin[0] - lt.end[0], origin[1] - lt.end[1]) < px * 0.6
    ) {
      const gap = Math.hypot(origin[0] - lt.end[0], origin[1] - lt.end[1]);
      const run = lt.node.runs[0];
      run.text += (gap > px * 0.15 && !run.text.endsWith(' ') && !text.startsWith(' ') ? ' ' : '') + text;
      lt.node.name = run.text.slice(0, 24);
      lt.end = end;
      return;
    }
    const n = makeText(0, 0, text);
    n.runs[0] = {
      ...n.runs[0],
      size: px,
      font: { family: font.family, weight: font.weight, style: font.italic ? 'italic' : 'normal' },
      tracking: (st.charSpacing / Math.max(size, 1e-6)) * 1000,
    };
    const items: TextNode['appearance']['items'] = [];
    if (paint) {
      if (strokeMode) {
        const s = makeStroke(undefined, Math.max(0.25, st.lineWidth * Math.hypot(axis[0], axis[1])));
        s.paint = paint;
        s.opacity = st.strokeAlpha;
        items.push(s);
      } else {
        const f = makeFill();
        f.paint = paint;
        f.opacity = st.fillAlpha;
        items.push(f);
      }
    }
    n.appearance = { items };
    const ascent = layoutText(n).ascent;
    n.transform = multiply(translate(origin[0], origin[1]), multiply(rotate(angle), translate(0, -ascent)));
    this.add(n);
    this.c.text++;
    this.lastText = { node: n, end, size: px, angle, color: colorKey, container: st.container };
    this.lastFill = null;
  }

  async image(
    data: { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray } | undefined,
  ) {
    if (!data || !data.data || !data.width || !data.height) return;
    const { width: w, height: h, kind } = data;
    const src = data.data;
    const rgba = new Uint8Array(w * h * 4);
    if (kind === 3) rgba.set(src.subarray(0, w * h * 4));
    else if (kind === 2) {
      for (let i = 0, j = 0; i < w * h; i++, j += 3) {
        rgba[i * 4] = src[j];
        rgba[i * 4 + 1] = src[j + 1];
        rgba[i * 4 + 2] = src[j + 2];
        rgba[i * 4 + 3] = 255;
      }
    } else if (kind === 1) {
      const rowBytes = (w + 7) >> 3;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const d = (y * w + x) * 4;
          rgba[d] = rgba[d + 1] = rgba[d + 2] = v;
          rgba[d + 3] = 255;
        }
    } else return;
    const png = encodePng(w, h, rgba);
    const key = `assets/${await sha256Hex(png)}.png`;
    this.doc.assets[key] ??= bytesToDataUrl(png, 'image/png');
    const { children: _c, type: _t, ...base } = makeGroup([], 'Image');
    const node: ImageNode = { ...base, type: 'image', asset: key, width: w, height: h };
    node.opacity = this.st.fillAlpha;
    // The image fills the unit square of user space, first row at y = 1.
    node.transform = multiply(this.M, [1 / w, 0, 0, -1 / h, 0, 1]);
    this.add(node);
    this.c.images++;
    this.lastFill = null;
    this.lastText = null;
  }

  async run(fnArray: number[], argsArray: unknown[][]) {
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const a = (argsArray[i] ?? []) as unknown[];
      switch (fn) {
        case OP.save:
          this.save();
          break;
        case OP.restore:
          this.restore();
          break;
        case OP.transform:
          this.st.ctm = multiply(this.st.ctm, a.slice(0, 6) as Matrix);
          break;
        case OP.setLineWidth:
          this.st.lineWidth = Number(a[0]);
          break;
        case OP.setLineCap:
          this.st.cap = (['butt', 'round', 'square'] as const)[Number(a[0])] ?? 'butt';
          break;
        case OP.setLineJoin:
          this.st.join = (['miter', 'round', 'bevel'] as const)[Number(a[0])] ?? 'miter';
          break;
        case OP.setMiterLimit:
          this.st.miter = Number(a[0]);
          break;
        case OP.setDash:
          this.st.dash = Array.isArray(a[0]) ? (a[0] as number[]).map(Number) : [];
          this.st.dashPhase = Number(a[1]) || 0;
          break;
        case OP.setGState:
          for (const [k, v] of (a[0] as [string, unknown][]) ?? []) {
            if (k === 'LW') this.st.lineWidth = Number(v);
            else if (k === 'LC') this.st.cap = (['butt', 'round', 'square'] as const)[Number(v)] ?? 'butt';
            else if (k === 'LJ') this.st.join = (['miter', 'round', 'bevel'] as const)[Number(v)] ?? 'miter';
            else if (k === 'ML') this.st.miter = Number(v);
            else if (k === 'D' && Array.isArray(v)) {
              this.st.dash = ((v[0] as number[]) ?? []).map(Number);
              this.st.dashPhase = Number(v[1]) || 0;
            } else if (k === 'ca') this.st.fillAlpha = Number(v);
            else if (k === 'CA') this.st.strokeAlpha = Number(v);
            else if (k === 'BM') this.st.blend = BLEND_BY_CANVAS[String(v)] ?? 'normal';
            else if (k === 'SMask' && v) this.c.softMasks++;
          }
          break;
        case OP.setFillRGBColor:
          this.st.fill = this.colorPaint(a);
          break;
        case OP.setStrokeRGBColor:
          this.st.stroke = this.colorPaint(a);
          break;
        case OP.setFillTransparent:
          this.st.fill = null;
          break;
        case OP.setStrokeTransparent:
          this.st.stroke = null;
          break;
        case OP.setFillColorN:
          this.st.fill = this.patternPaint(a);
          break;
        case OP.setStrokeColorN:
          this.st.stroke = this.patternPaint(a);
          break;
        case OP.constructPath: {
          const op = Number(a[0]);
          const data = a[1] as (ArrayLike<number> | null)[] | null;
          this.paintPath(op, data?.[0] ?? null);
          break;
        }
        case OP.clip:
          this.pendingClip = 'nonzero';
          break;
        case OP.eoClip:
          this.pendingClip = 'evenodd';
          break;
        case OP.shadingFill: {
          const paint = typeof a[0] === 'string' ? this.shadingPaint(a[0], null) : null;
          if (paint) {
            const r = makePath(
              [
                {
                  closed: true,
                  nodes: [
                    [-1e4, -1e4],
                    [1e4, -1e4],
                    [1e4, 1e4],
                    [-1e4, 1e4],
                  ].map(([x, y]) => ({ x, y, in: null, out: null, kind: 'sharp' as const })),
                },
              ],
              { items: [{ ...makeFill(), paint, opacity: this.st.fillAlpha }] },
              'Gradient',
            );
            // Paints the current clip: a big rectangle, clipped by the enclosing clip group.
            this.add(r);
          }
          break;
        }
        case OP.beginText:
          this.tm = [...IDENTITY];
          this.tlm = [...IDENTITY];
          break;
        case OP.setFont: {
          this.st.font = this.fonts.get(String(a[0])) ?? {
            family: 'Helvetica',
            weight: 400,
            italic: false,
            fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
          };
          this.st.fontSize = Math.abs(Number(a[1])) || 12;
          break;
        }
        case OP.setCharSpacing:
          this.st.charSpacing = Number(a[0]);
          break;
        case OP.setWordSpacing:
          this.st.wordSpacing = Number(a[0]);
          break;
        case OP.setHScale:
          this.st.hScale = Number(a[0]) / 100;
          break;
        case OP.setLeading:
          this.st.leading = Number(a[0]);
          break;
        case OP.setTextRise:
          this.st.rise = Number(a[0]);
          break;
        case OP.setTextRenderingMode:
          this.st.textMode = Number(a[0]);
          break;
        case OP.setTextMatrix: {
          const m = Array.from(a[0] as ArrayLike<number>) as Matrix;
          this.tm = m.length === 6 ? m : (a.slice(0, 6) as Matrix);
          this.tlm = [...this.tm];
          break;
        }
        case OP.moveText:
          this.tlm = multiply(this.tlm, translate(Number(a[0]), Number(a[1])));
          this.tm = [...this.tlm];
          break;
        case OP.setLeadingMoveText:
          this.st.leading = -Number(a[1]);
          this.tlm = multiply(this.tlm, translate(Number(a[0]), Number(a[1])));
          this.tm = [...this.tlm];
          break;
        case OP.nextLine:
          this.tlm = multiply(this.tlm, translate(0, -this.st.leading));
          this.tm = [...this.tlm];
          break;
        case OP.showText:
        case OP.showSpacedText:
          this.showText((a[0] as Glyph[]) ?? []);
          break;
        case OP.nextLineShowText:
          this.tlm = multiply(this.tlm, translate(0, -this.st.leading));
          this.tm = [...this.tlm];
          this.showText((a[0] as Glyph[]) ?? []);
          break;
        case OP.paintFormXObjectBegin:
          this.save();
          if (Array.isArray(a[0]) || ArrayBuffer.isView(a[0])) {
            const m = Array.from(a[0] as ArrayLike<number>);
            if (m.length === 6) this.st.ctm = multiply(this.st.ctm, m as Matrix);
          }
          break;
        case OP.paintFormXObjectEnd:
          this.restore();
          break;
        case OP.beginGroup: {
          this.save();
          const g = a[0] as { matrix?: number[]; smask?: unknown } | undefined;
          if (g?.matrix && g.matrix.length === 6) this.st.ctm = multiply(this.st.ctm, g.matrix as Matrix);
          if (g?.smask) this.c.softMasks++;
          break;
        }
        case OP.endGroup:
          this.restore();
          break;
        case OP.paintImageXObject:
          await this.image(this.resolved.get(String(a[0])) as never);
          break;
        case OP.paintInlineImageXObject:
          await this.image(a[0] as never);
          break;
        case OP.paintImageMaskXObject:
        case OP.paintImageMaskXObjectGroup:
        case OP.paintImageMaskXObjectRepeat:
        case OP.paintSolidColorImageMask:
        case OP.paintInlineImageXObjectGroup:
        case OP.paintImageXObjectRepeat:
          this.c.imageMasks++;
          break;
      }
    }
  }
}

/** Ids of objects referenced by the operator list (images, patterns, fonts). */
function referencedObjects(fnArray: number[], argsArray: unknown[][]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < fnArray.length; i++) {
    const a = argsArray[i] ?? [];
    const fn = fnArray[i];
    if (fn === OP.paintImageXObject || fn === OP.shadingFill || fn === OP.setFont) {
      if (typeof a[0] === 'string') ids.add(a[0]);
    } else if (
      (fn === OP.setFillColorN || fn === OP.setStrokeColorN) &&
      a[0] === 'Shading' &&
      typeof a[1] === 'string'
    )
      ids.add(a[1]);
  }
  return ids;
}

/** TrimBoxes per page (pdf.js does not expose them). Best effort: null when unreadable. */
async function trimBoxes(bytes: Uint8Array): Promise<(number[] | null)[] | null> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPages().map((p) => {
      const media = p.getMediaBox();
      const t = p.getTrimBox();
      const same =
        Math.abs(t.x - media.x) < 1e-3 &&
        Math.abs(t.y - media.y) < 1e-3 &&
        Math.abs(t.width - media.width) < 1e-3 &&
        Math.abs(t.height - media.height) < 1e-3;
      return same ? null : [t.x, t.y, t.width, t.height];
    });
  } catch {
    return null;
  }
}

export async function importPdf(
  bytes: Uint8Array,
  opts: ImportOptions,
  format: 'pdf' | 'ai' = 'pdf',
): Promise<{ doc: CurvsDocument; report: ImportReport }> {
  const report = emptyReport(format);
  let lib: PdfJs;
  try {
    lib = await loadPdfJs();
  } catch {
    throw new Error('The PDF reader could not be loaded. Check your connection and try again.');
  }
  const trims = await trimBoxes(bytes);
  let pdf: PdfDoc;
  let task: ReturnType<PdfJs['getDocument']> | null = null;
  try {
    task = lib.getDocument({
      data: bytes.slice(),
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableFontFace: true,
      fontExtraProperties: true,
      useSystemFonts: false,
      isEvalSupported: false,
      verbosity: 0,
    });
    pdf = await task.promise;
  } catch (e) {
    await task?.destroy().catch(() => undefined);
    const msg = String((e as Error)?.message ?? e);
    if (/password/i.test(msg))
      throw new Error('This PDF is password protected. Remove the password and try again.', { cause: e });
    throw new Error('This PDF could not be read. It may be damaged.', { cause: e });
  }
  const name = opts.fileName.replace(/\.(pdf|ai)$/i, '') || 'Untitled';
  const doc = createDocument({ name, width: 1, height: 1, units: 'pt' });
  doc.artboards = [];
  const counters: Counters = {
    softMasks: 0,
    imageMasks: 0,
    tiling: 0,
    shadings: 0,
    hiddenText: 0,
    images: 0,
    text: 0,
    paths: 0,
  };
  let x = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      let base = vp.transform.slice(0, 6) as Matrix;
      let W = vp.width;
      let H = vp.height;
      const trim = trims?.[n - 1];
      if (trim) {
        const corners = [
          apply(base, [trim[0], trim[1]]),
          apply(base, [trim[0] + trim[2], trim[1] + trim[3]]),
        ];
        const left = Math.min(corners[0][0], corners[1][0]);
        const top = Math.min(corners[0][1], corners[1][1]);
        W = Math.abs(corners[1][0] - corners[0][0]);
        H = Math.abs(corners[1][1] - corners[0][1]);
        base = multiply(translate(-left, -top), base);
      }
      const ops = await page.getOperatorList();
      const reader = new PageReader(page, base, doc, counters);
      await reader.resolve(referencedObjects(ops.fnArray, ops.argsArray));
      await reader.loadFonts();
      await reader.run(ops.fnArray, ops.argsArray);
      const ab: Artboard = {
        id: newId('ab'),
        name: pdf.numPages > 1 ? `Page ${n}` : name,
        x,
        y: 0,
        width: W,
        height: H,
        background: null,
        guides: [],
        children: reader.root,
      };
      doc.artboards.push(ab);
      x += W + 40;
      page.cleanup?.();
    }
  } finally {
    await task.destroy().catch(() => undefined);
  }
  if (!doc.artboards.length) throw new Error('This PDF has no pages.');
  doc.view = {
    artboard: doc.artboards[0].id,
    zoom: 1,
    cx: doc.artboards[0].width / 2,
    cy: doc.artboards[0].height / 2,
  };
  const w = report.warnings;
  if (format === 'ai') w.push('Imported the PDF content of this .ai file.');
  if (counters.softMasks) w.push(countMessage(counters.softMasks, 'soft mask', 'soft masks', 'dropped'));
  if (counters.imageMasks) w.push(countMessage(counters.imageMasks, 'image mask', 'image masks', 'skipped'));
  if (counters.tiling)
    w.push(countMessage(counters.tiling, 'pattern fill', 'pattern fills', 'replaced with a flat color'));
  if (counters.shadings)
    w.push(countMessage(counters.shadings, 'mesh gradient', 'mesh gradients', 'dropped'));
  if (counters.hiddenText) w.push('Hidden text (such as OCR layers) was skipped.');
  if (counters.text) w.push('Text was matched to fonts by name. Line breaks and spacing may differ.');
  note(report, 'pages', doc.artboards.length);
  note(report, 'paths', counters.paths);
  note(report, 'text', counters.text);
  note(report, 'images', counters.images);
  return { doc, report };
}
