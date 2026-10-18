/* SVG reader (DOMParser based). Maps SVG elements into the document model: shapes, groups, transforms,
   CSS (attributes, style="", <style> rules), gradients, <use>/<symbol>, simple clip paths, text and images.
   Masks, filters, patterns and markers are reported and dropped. 1 user unit = 1 px = 1 pt. */
import { gunzipSync } from 'fflate';
import type {
  Appearance,
  AppearanceItem,
  BlendMode,
  ClipGroupNode,
  CurvsDocument,
  GradientStop,
  GroupNode,
  ImageNode,
  ImportReport,
  Matrix,
  Paint,
  PathShape,
  SceneNode,
  SrgbColor,
  StrokeItem,
  Subpath,
  TextNode,
  Vec,
} from '../../core/types';
import {
  createDocument,
  makeEllipse,
  makeFill,
  makeGroup,
  makePath,
  makeRect,
  makeStroke,
  makeText,
} from '../../core/document';
import { apply, IDENTITY, invert, multiply, rotate, scale, translate } from '../../core/matrix';
import { parsePathData } from '../../core/geometry/pathdata';
import { ellipseSubpaths, rectSubpaths, uniformCorners } from '../../core/geometry/shapes';
import { nodeBounds } from '../../core/geometry/node';
import { type Rect, transformSubpath, unionRect } from '../../core/geometry/bezier';
import { layoutText } from '../../core/text';
import { rgb } from '../../core/color';
import { PT_PER } from '../../core/units';
import { countMessage, emptyReport, note, type ImportOptions } from '../types';
import {
  bytesToDataUrl,
  dataUrlToBytes,
  extForMime,
  fromUtf8,
  readImageSize,
  sha256Hex,
  sniffImageMime,
} from '../shared/bytes';
import { cascade, parseDeclarations, parseStylesheet, parseSvgColor, type CssRule } from './css';

type Style = Record<string, string>;

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'display',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'mix-blend-mode',
  'isolation',
  'stop-color',
  'stop-opacity',
  'marker-start',
  'marker-mid',
  'marker-end',
  'marker',
];
const NOT_INHERITED = new Set([
  'opacity',
  'clip-path',
  'mask',
  'filter',
  'mix-blend-mode',
  'isolation',
  'display',
  'stop-color',
  'stop-opacity',
]);
const SKIP_TAGS = new Set([
  'defs',
  'style',
  'title',
  'desc',
  'metadata',
  'symbol',
  'clippath',
  'mask',
  'lineargradient',
  'radialgradient',
  'pattern',
  'filter',
  'marker',
  'script',
  'namedview',
  'sodipodi:namedview',
]);
const BLENDS = new Set<string>([
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

const num = (v: string | null | undefined, fallback = 0) => {
  if (v === null || v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const numberList = (v: string | null | undefined) =>
  (v ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

/** A length in user units (= points). Percentages use `ref`. */
export function parseLength(v: string | null | undefined, ref = 0, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|mm|cm|in|pc|%|em|ex)?\s*$/i.exec(v);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === '%') return (n / 100) * ref;
  if (unit === 'em') return n * 16;
  if (unit === 'ex') return n * 8;
  if (unit === 'mm' || unit === 'cm' || unit === 'in' || unit === 'pc' || unit === 'pt')
    return n * PT_PER[unit];
  return n;
}

/** SVG transform list → matrix (functions apply left to right, as nested coordinate systems). */
export function parseTransform(s: string | null | undefined): Matrix {
  let m: Matrix = [...IDENTITY];
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let t: RegExpExecArray | null;
  while ((t = re.exec(s))) {
    const a = numberList(t[2]);
    let n: Matrix = [...IDENTITY];
    switch (t[1].toLowerCase()) {
      case 'matrix':
        if (a.length === 6) n = a as Matrix;
        break;
      case 'translate':
        n = translate(a[0] ?? 0, a[1] ?? 0);
        break;
      case 'scale':
        n = scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
        break;
      case 'rotate': {
        const r = rotate(((a[0] ?? 0) * Math.PI) / 180);
        n = a.length >= 3 ? multiply(translate(a[1], a[2]), multiply(r, translate(-a[1], -a[2]))) : r;
        break;
      }
      case 'skewx':
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewy':
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, n);
  }
  return m;
}

/** viewBox → viewport matrix per preserveAspectRatio. */
export function viewBoxMatrix(vb: number[], w: number, h: number, par: string | null): Matrix {
  const [vx, vy, vw, vh] = vb;
  if (!(vw > 0 && vh > 0)) return [...IDENTITY];
  const p = (par ?? 'xMidYMid meet').trim().split(/\s+/);
  const align = p[0] === 'defer' ? (p[1] ?? 'xMidYMid') : p[0];
  const slice = p.includes('slice');
  let sx = w / vw;
  let sy = h / vh;
  if (align !== 'none') {
    const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
  }
  let tx = -vx * sx;
  let ty = -vy * sy;
  if (align !== 'none') {
    const ax = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0;
    const ay = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0;
    tx += (w - vw * sx) * ax;
    ty += (h - vh * sy) * ay;
  }
  return [sx, 0, 0, sy, tx + 0, ty + 0];
}

type Geom =
  | { kind: 'path'; subpaths: Subpath[]; offset: Matrix }
  | { kind: 'rect'; w: number; h: number; r: number; offset: Matrix }
  | { kind: 'ellipse'; rx: number; ry: number; offset: Matrix };

const geomSubpaths = (g: Geom): Subpath[] =>
  g.kind === 'path'
    ? g.subpaths
    : g.kind === 'rect'
      ? rectSubpaths({ width: g.w, height: g.h, corners: uniformCorners(g.r) })
      : ellipseSubpaths(g);

type Counters = Record<
  | 'masks'
  | 'filters'
  | 'patterns'
  | 'markers'
  | 'external'
  | 'unsupported'
  | 'clips'
  | 'cssSkipped'
  | 'spread'
  | 'focal'
  | 'textStyles',
  number
>;

class SvgReader {
  rules: CssRule[] = [];
  ids = new Map<string, Element>();
  doc: CurvsDocument;
  counters: Counters = {
    masks: 0,
    filters: 0,
    patterns: 0,
    markers: 0,
    external: 0,
    unsupported: 0,
    clips: 0,
    cssSkipped: 0,
    spread: 0,
    focal: 0,
    textStyles: 0,
  };
  pendingAssets: Promise<void>[] = [];
  /** Viewport size for percentage lengths. */
  vw = 300;
  vh = 150;
  private useStack: string[] = [];

  constructor(
    public root: Element,
    name: string,
  ) {
    this.doc = createDocument({ name, width: 1, height: 1, units: 'px' });
    this.doc.artboards[0].background = null;
    for (const el of Array.from(root.ownerDocument.getElementsByTagName('*'))) {
      const id = el.getAttribute('id');
      if (id && !this.ids.has(id)) this.ids.set(id, el);
    }
    for (const st of Array.from(root.ownerDocument.getElementsByTagName('style'))) {
      const parsed = parseStylesheet(st.textContent ?? '', this.rules.length);
      this.rules.push(...parsed.rules);
      this.counters.cssSkipped += parsed.skipped;
    }
  }

  get diag() {
    return Math.hypot(this.vw, this.vh) / Math.SQRT2;
  }

  computeStyle(el: Element, parent: Style): Style {
    const s: Style = {};
    for (const [k, v] of Object.entries(parent)) if (!NOT_INHERITED.has(k)) s[k] = v;
    const own: Style = {};
    for (const p of STYLE_PROPS) {
      const v = el.getAttribute(p);
      if (v !== null) own[p] = v.trim();
    }
    if (this.rules.length) Object.assign(own, cascade(el, this.rules));
    const inline = el.getAttribute('style');
    if (inline) Object.assign(own, parseDeclarations(inline));
    for (const [k, v] of Object.entries(own)) {
      if (v === 'inherit') {
        if (parent[k] !== undefined) s[k] = parent[k];
      } else s[k] = v;
    }
    return s;
  }

  ref(v: string | null | undefined): Element | null {
    if (!v) return null;
    const m = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(v) ?? /^#(.+)$/.exec(v.trim());
    return m ? (this.ids.get(m[1]) ?? null) : null;
  }

  href(el: Element) {
    return (
      el.getAttribute('href') ??
      el.getAttribute('xlink:href') ??
      el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    );
  }

  color(v: string, style: Style): SrgbColor | null {
    if (/^currentcolor$/i.test(v.trim())) return parseSvgColor(style.color ?? 'black') ?? rgb(0, 0, 0);
    return parseSvgColor(v);
  }

  /** Gradient attribute with href inheritance. */
  gradAttr(el: Element, name: string, depth = 0): string | null {
    const v = el.getAttribute(name);
    if (v !== null || depth > 8) return v;
    const parent = this.ref(this.href(el));
    return parent && /gradient$/i.test(parent.localName) ? this.gradAttr(parent, name, depth + 1) : null;
  }

  gradStops(el: Element, depth = 0): GradientStop[] {
    const stops = Array.from(el.children).filter((c) => c.localName === 'stop');
    if (!stops.length && depth < 8) {
      const parent = this.ref(this.href(el));
      if (parent && /gradient$/i.test(parent.localName)) return this.gradStops(parent, depth + 1);
    }
    let last = 0;
    return stops.map((s) => {
      const st = this.computeStyle(s, {});
      const off = s.getAttribute('offset') ?? '0';
      let o = off.trim().endsWith('%') ? parseFloat(off) / 100 : num(off);
      o = Math.max(last, Math.min(1, Math.max(0, o)));
      last = o;
      const c = this.color(st['stop-color'] ?? 'black', st) ?? rgb(0, 0, 0);
      const a = Math.max(0, Math.min(1, num(st['stop-opacity'], 1)));
      return { offset: o, color: { ...c, a: c.a * a } };
    });
  }

  /** Convert a paint value into a Paint in the node's local space. */
  paint(v: string, style: Style, bbox: Rect | null, localFromUser: Matrix): Paint | null {
    const t = v.trim();
    if (t === 'none' || t === 'transparent') return null;
    if (t.startsWith('url(')) {
      const el = this.ref(t);
      const fallback = t.replace(/^url\([^)]*\)\s*/, '');
      if (el && (el.localName === 'linearGradient' || el.localName === 'radialGradient')) {
        const g = this.gradient(el, bbox, localFromUser);
        if (g) return g;
      } else if (el && el.localName === 'pattern') this.counters.patterns++;
      if (fallback) return this.paint(fallback, style, bbox, localFromUser);
      return el && el.localName === 'pattern' ? { type: 'solid', color: rgb(0.6, 0.6, 0.6) } : null;
    }
    const c = this.color(t, style);
    return c ? { type: 'solid', color: c } : null;
  }

  gradient(el: Element, bbox: Rect | null, localFromUser: Matrix): Paint | null {
    const stops = this.gradStops(el);
    if (!stops.length) return null;
    if (stops.length === 1) return { type: 'solid', color: stops[0].color };
    const units = this.gradAttr(el, 'gradientUnits') ?? 'objectBoundingBox';
    const gt = parseTransform(this.gradAttr(el, 'gradientTransform'));
    const spread = this.gradAttr(el, 'spreadMethod');
    if (spread && spread !== 'pad') this.counters.spread++;
    const bboxUnits = units !== 'userSpaceOnUse';
    if (bboxUnits && (!bbox || bbox.width === 0 || bbox.height === 0))
      return { type: 'solid', color: stops[0].color };
    const coord = (name: string, def: string, ref: number) => {
      const v = this.gradAttr(el, name) ?? def;
      if (bboxUnits) return v.trim().endsWith('%') ? parseFloat(v) / 100 : num(v);
      return parseLength(v, ref);
    };
    const toUser: Matrix = bboxUnits ? multiply([bbox!.width, 0, 0, bbox!.height, bbox!.x, bbox!.y], gt) : gt;
    const map = (p: Vec): Vec => apply(localFromUser, apply(toUser, p));
    if (el.localName === 'linearGradient') {
      const p1: Vec = [coord('x1', '0%', this.vw), coord('y1', '0%', this.vh)];
      const p2: Vec = [coord('x2', '100%', this.vw), coord('y2', '0%', this.vh)];
      return { type: 'linear', stops, from: map(p1), to: map(p2) };
    }
    const cx = coord('cx', '50%', this.vw);
    const cy = coord('cy', '50%', this.vh);
    const r = coord('r', '50%', this.diag);
    const fx = this.gradAttr(el, 'fx');
    const fy = this.gradAttr(el, 'fy');
    if (
      (fx !== null && coord('fx', '0', this.vw) !== cx) ||
      (fy !== null && coord('fy', '0', this.vh) !== cy)
    )
      this.counters.focal++;
    const c = map([cx, cy]);
    // For a non-square bounding box the radius follows the box width (a circle stays a circle).
    const e = map([cx + r, cy]);
    return { type: 'radial', stops, from: c, to: e };
  }

  appearance(style: Style, bbox: Rect | null, localFromUser: Matrix, fillDefault = 'black'): Appearance {
    const items: AppearanceItem[] = [];
    const fillPaint = this.paint(style.fill ?? fillDefault, style, bbox, localFromUser);
    if (fillPaint) {
      const f = makeFill();
      f.paint = fillPaint;
      f.opacity = Math.max(0, Math.min(1, num(style['fill-opacity'], 1)));
      items.push(f);
    }
    const strokePaint = style.stroke ? this.paint(style.stroke, style, bbox, localFromUser) : null;
    const width = parseLength(style['stroke-width'], this.diag, 1);
    if (strokePaint && width > 0) {
      const s: StrokeItem = makeStroke(undefined, width);
      s.paint = strokePaint;
      s.opacity = Math.max(0, Math.min(1, num(style['stroke-opacity'], 1)));
      const cap = style['stroke-linecap'];
      if (cap === 'round' || cap === 'square' || cap === 'butt') s.cap = cap;
      const join = style['stroke-linejoin'];
      if (join === 'round' || join === 'bevel' || join === 'miter') s.join = join;
      else if (join === 'miter-clip' || join === 'arcs') s.join = 'miter';
      s.miter = num(style['stroke-miterlimit'], 4);
      const dash = style['stroke-dasharray'];
      if (dash && dash !== 'none') {
        const d = dash
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((x) => parseLength(x, this.diag));
        if (d.length && d.some((x) => x > 0)) s.dash = d.length % 2 ? [...d, ...d] : d;
      }
      s.dashOffset = parseLength(style['stroke-dashoffset'], this.diag, 0);
      items.push(s);
    }
    for (const k of ['marker', 'marker-start', 'marker-mid', 'marker-end'])
      if (style[k] && style[k] !== 'none') this.counters.markers++;
    return { items };
  }

  base<T extends SceneNode>(
    node: T,
    el: Element,
    style: Style,
    T_el: Matrix,
    fallbackName?: string,
  ): SceneNode {
    const label = el.getAttribute('inkscape:label') ?? el.getAttribute('id');
    node.name = label ?? fallbackName ?? node.name;
    node.opacity = Math.max(0, Math.min(1, num(style.opacity, 1)));
    const blend = style['mix-blend-mode'];
    if (blend && BLENDS.has(blend)) node.blend = blend as BlendMode;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') node.visible = false;
    if (node.type === 'group' && style.isolation === 'isolate') node.isolated = true;
    if (style.mask && style.mask !== 'none') this.counters.masks++;
    if (style.filter && style.filter !== 'none') this.counters.filters++;
    // Bounds in the element's user space (before its transform), for objectBoundingBox clip paths.
    const userBox = nodeBounds(node, this.doc);
    node.transform = multiply(T_el, node.transform);
    const clip = style['clip-path'];
    if (clip && clip !== 'none') {
      const c = this.clipNode(clip, userBox, T_el);
      if (c) {
        const { children: _c, type: _t, ...props } = makeGroup([], node.name);
        const cg: ClipGroupNode = { ...props, type: 'clipGroup', clip: c, children: [node] };
        return cg;
      }
    }
    return node;
  }

  clipNode(v: string, userBox: Rect | null, T_el: Matrix): PathShape | null {
    const el = this.ref(v);
    if (!el || el.localName !== 'clipPath') return null;
    const subpaths: Subpath[] = [];
    let evenOdd = false;
    const collect = (parent: Element, m: Matrix, depth: number) => {
      for (const c of Array.from(parent.children)) {
        if (depth > 8) return;
        const style = this.computeStyle(c, {});
        if (style.display === 'none') continue;
        const tag = c.localName;
        const tm = multiply(m, parseTransform(c.getAttribute('transform')));
        if (tag === 'use') {
          const target = this.ref(this.href(c));
          if (target) {
            const off = translate(
              parseLength(c.getAttribute('x'), this.vw),
              parseLength(c.getAttribute('y'), this.vh),
            );
            const wrap = target.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrap.appendChild(target.cloneNode(true));
            collect(wrap, multiply(tm, off), depth + 1);
          }
          continue;
        }
        if (tag === 'text') {
          this.counters.clips++;
          continue;
        }
        const geom = this.geometry(c);
        if (!geom) continue;
        if ((style['clip-rule'] ?? '') === 'evenodd') evenOdd = true;
        for (const sp of geomSubpaths(geom)) subpaths.push(transformSubpath(sp, multiply(tm, geom.offset)));
      }
    };
    collect(el, parseTransform(el.getAttribute('transform')), 0);
    if (!subpaths.length) return null;
    let m = T_el;
    if (el.getAttribute('clipPathUnits') === 'objectBoundingBox') {
      if (!userBox) return null;
      m = multiply(T_el, [userBox.width, 0, 0, userBox.height, userBox.x, userBox.y]);
    }
    const p = makePath(subpaths, { items: [] }, 'Clip');
    p.fillRule = evenOdd ? 'evenodd' : 'nonzero';
    p.transform = m;
    return p;
  }

  /** Geometry of a basic shape element in its user space: local subpaths plus the offset moved into the transform. */
  geometry(el: Element): Geom | null {
    const L = (n: string, ref: number, def = 0) => parseLength(el.getAttribute(n), ref, def);
    switch (el.localName) {
      case 'path': {
        const d = el.getAttribute('d');
        if (!d) return null;
        const sp = parsePathData(d).filter((s) => s.nodes.length > 0);
        return sp.length ? { subpaths: sp, offset: [...IDENTITY], kind: 'path' } : null;
      }
      case 'rect': {
        const w = L('width', this.vw);
        const h = L('height', this.vh);
        if (!(w > 0 && h > 0)) return null;
        const rxA = el.getAttribute('rx');
        const ryA = el.getAttribute('ry');
        let rx = rxA !== null && rxA !== 'auto' ? L('rx', this.vw) : NaN;
        let ry = ryA !== null && ryA !== 'auto' ? L('ry', this.vh) : NaN;
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(Math.max(0, rx), w / 2);
        ry = Math.min(Math.max(0, ry), h / 2);
        const offset = translate(L('x', this.vw), L('y', this.vh));
        if (Math.abs(rx - ry) < 1e-9) return { kind: 'rect', w, h, r: rx, offset };
        const d = `M${rx} 0H${w - rx}A${rx} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${rx} ${ry} 0 0 1 ${w - rx} ${h}H${rx}A${rx} ${ry} 0 0 1 0 ${h - ry}V${ry}A${rx} ${ry} 0 0 1 ${rx} 0Z`;
        return { subpaths: parsePathData(d), offset, kind: 'path' };
      }
      case 'circle':
      case 'ellipse': {
        const isCircle = el.localName === 'circle';
        const rx = isCircle ? L('r', this.diag) : L('rx', this.vw, NaN);
        const ry = isCircle ? rx : L('ry', this.vh, NaN);
        const rxx = Number.isNaN(rx) ? ry : rx;
        const ryy = Number.isNaN(ry) ? rx : ry;
        if (!(rxx > 0 && ryy > 0)) return null;
        return { kind: 'ellipse', rx: rxx, ry: ryy, offset: translate(L('cx', this.vw), L('cy', this.vh)) };
      }
      case 'line': {
        const p = (x: number, y: number) => ({ x, y, in: null, out: null, kind: 'sharp' as const });
        return {
          subpaths: [
            {
              closed: false,
              nodes: [p(L('x1', this.vw), L('y1', this.vh)), p(L('x2', this.vw), L('y2', this.vh))],
            },
          ],
          offset: [...IDENTITY],
          kind: 'path',
        };
      }
      case 'polyline':
      case 'polygon': {
        const pts = numberList(el.getAttribute('points'));
        if (pts.length < 4) return null;
        const nodes = [];
        for (let i = 0; i + 1 < pts.length; i += 2)
          nodes.push({ x: pts[i], y: pts[i + 1], in: null, out: null, kind: 'sharp' as const });
        return {
          subpaths: [{ closed: el.localName === 'polygon', nodes }],
          offset: [...IDENTITY],
          kind: 'path',
        };
      }
    }
    return null;
  }

  shape(el: Element, style: Style, T_el: Matrix): SceneNode | null {
    const g = this.geometry(el);
    if (!g) return null;
    let node: SceneNode;
    const defaultNames: Record<string, string> = {
      rect: 'Rectangle',
      circle: 'Ellipse',
      ellipse: 'Ellipse',
      line: 'Line',
      polyline: 'Polyline',
      polygon: 'Polygon',
      path: 'Path',
    };
    if (g.kind === 'rect') {
      node = makeRect(0, 0, g.w, g.h, { items: [] });
      node.corners = uniformCorners(g.r);
    } else if (g.kind === 'ellipse') {
      node = makeEllipse(0, 0, g.rx, g.ry, { items: [] });
    } else {
      const p = makePath(g.subpaths);
      p.fillRule = style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero';
      node = p;
    }
    node.name = defaultNames[el.localName] ?? 'Path';
    node.transform = g.offset;
    const userBox = nodeBounds(node, this.doc);
    node.appearance = this.appearance(style, userBox, invert(g.offset));
    return this.base(node, el, style, T_el);
  }

  children(el: Element, style: Style, depth: number): SceneNode[] {
    const out: SceneNode[] = [];
    for (const c of Array.from(el.children)) {
      const n = this.convert(c, style, depth + 1);
      if (n) out.push(n);
    }
    return out;
  }

  group(el: Element, style: Style, T_el: Matrix, depth: number, name = 'Group'): SceneNode | null {
    const kids = this.children(el, style, depth);
    if (!kids.length) return null;
    const g: GroupNode = makeGroup(kids, name);
    return this.base(g, el, style, T_el);
  }

  convert(el: Element, parentStyle: Style, depth: number): SceneNode | null {
    if (depth > 48) return null;
    const tag = el.localName;
    if (SKIP_TAGS.has(tag.toLowerCase()) || el.namespaceURI !== 'http://www.w3.org/2000/svg') return null;
    const style = this.computeStyle(el, parentStyle);
    if (style.display === 'none') return null;
    const T_el = parseTransform(el.getAttribute('transform'));
    switch (tag) {
      case 'g':
      case 'a':
        return this.group(
          el,
          style,
          T_el,
          depth,
          el.getAttribute('inkscape:groupmode') === 'layer' ? 'Layer' : 'Group',
        );
      case 'switch': {
        // Renders its first child that can be drawn.
        for (const c of Array.from(el.children)) {
          const n = this.convert(c, style, depth + 1);
          if (n) return this.base(makeGroup([n], 'Group'), el, style, T_el);
        }
        return null;
      }
      case 'svg': {
        const w = parseLength(el.getAttribute('width'), this.vw, this.vw);
        const h = parseLength(el.getAttribute('height'), this.vh, this.vh);
        const vb = numberList(el.getAttribute('viewBox'));
        const inner =
          vb.length === 4 ? viewBoxMatrix(vb, w, h, el.getAttribute('preserveAspectRatio')) : [...IDENTITY];
        const off = translate(
          parseLength(el.getAttribute('x'), this.vw),
          parseLength(el.getAttribute('y'), this.vh),
        );
        return this.group(el, style, multiply(off, inner as Matrix), depth);
      }
      case 'path':
      case 'rect':
      case 'circle':
      case 'ellipse':
      case 'line':
      case 'polyline':
      case 'polygon':
        return this.shape(el, style, T_el);
      case 'text':
        return this.text(el, style, T_el);
      case 'image':
        return this.image(el, style, T_el);
      case 'use':
        return this.use(el, style, T_el, depth);
      default:
        this.counters.unsupported++;
        return null;
    }
  }

  use(el: Element, style: Style, T_el: Matrix, depth: number): SceneNode | null {
    const target = this.ref(this.href(el));
    const id = target?.getAttribute('id') ?? '';
    if (!target || this.useStack.includes(id) || this.useStack.length > 16) return null;
    this.useStack.push(id);
    try {
      const off = translate(
        parseLength(el.getAttribute('x'), this.vw),
        parseLength(el.getAttribute('y'), this.vh),
      );
      let inner: SceneNode | null;
      if (target.localName === 'symbol' || target.localName === 'svg') {
        const kids = this.children(target, this.computeStyle(target, style), depth);
        if (!kids.length) return null;
        const g = makeGroup(kids, target.getAttribute('id') ?? 'Symbol');
        const vb = numberList(target.getAttribute('viewBox'));
        if (vb.length === 4) {
          const w = parseLength(el.getAttribute('width') ?? target.getAttribute('width'), this.vw, vb[2]);
          const h = parseLength(el.getAttribute('height') ?? target.getAttribute('height'), this.vh, vb[3]);
          g.transform = viewBoxMatrix(vb, w, h, target.getAttribute('preserveAspectRatio'));
        }
        inner = g;
      } else {
        inner = this.convert(target, style, depth + 1);
      }
      if (!inner) return null;
      const g = makeGroup([inner], el.getAttribute('id') ?? inner.name);
      g.transform = off;
      return this.base(g, el, style, T_el);
    } finally {
      this.useStack.pop();
    }
  }

  text(el: Element, style: Style, T_el: Matrix): SceneNode | null {
    const preserve = el.getAttribute('xml:space') === 'preserve';
    const lines: string[] = [];
    let current = '';
    let lineStep = 0;
    let firstX: number | null = null;
    let firstY: number | null = null;
    const startX = numberList(el.getAttribute('x'))[0];
    const startY = numberList(el.getAttribute('y'))[0];
    let sawFill = false;
    const walk = (node: Node, isRoot: boolean) => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 3) current += c.textContent ?? '';
        else if (c.nodeType === 1) {
          const e = c as Element;
          if (e.localName !== 'tspan' && e.localName !== 'textPath' && e.localName !== 'a') continue;
          const hasX = e.getAttribute('x') !== null;
          const hasY = e.getAttribute('y') !== null;
          const dy = parseLength(e.getAttribute('dy'), this.vh);
          const newLine =
            (hasY || (hasX && dy !== 0) || dy !== 0) && (current.trim() !== '' || lines.length > 0);
          if (newLine) {
            lines.push(current);
            current = '';
            if (!lineStep) {
              const y = numberList(e.getAttribute('y'))[0];
              lineStep = hasY && y !== undefined && firstY !== null ? y - firstY : dy;
            }
          }
          if (firstX === null && hasX) firstX = numberList(e.getAttribute('x'))[0] ?? null;
          if (firstY === null && hasY) firstY = numberList(e.getAttribute('y'))[0] ?? null;
          if (isRoot && (e.getAttribute('fill') || e.getAttribute('style') || e.getAttribute('class')))
            sawFill = true;
          walk(e, false);
        }
      }
    };
    if (startY !== undefined) firstY = startY;
    if (startX !== undefined) firstX = startX;
    walk(el, true);
    lines.push(current);
    const clean = lines.map((l) => (preserve ? l.replace(/[\r\n\t]/g, ' ') : l.replace(/\s+/g, ' ').trim()));
    while (clean.length > 1 && clean[clean.length - 1] === '') clean.pop();
    while (clean.length > 1 && clean[0] === '') clean.shift();
    const content = clean.join('\n');
    if (!content.trim()) return null;
    if (sawFill) this.counters.textStyles++;
    const size = parseLength(style['font-size'], 16, 16) || 16;
    const fam =
      (style['font-family'] ?? 'Geist')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '') || 'Geist';
    const wRaw = style['font-weight'] ?? '400';
    const weight =
      wRaw === 'bold' || wRaw === 'bolder'
        ? 700
        : wRaw === 'normal'
          ? 400
          : wRaw === 'lighter'
            ? 300
            : num(wRaw, 400);
    const italic = /italic|oblique/.test(style['font-style'] ?? '');
    const ls =
      style['letter-spacing'] && style['letter-spacing'] !== 'normal'
        ? parseLength(style['letter-spacing'], 0)
        : 0;
    const anchor = style['text-anchor'];
    const node: TextNode = makeText(0, 0, content);
    node.runs = [
      {
        text: content,
        font: { family: fam, weight, style: italic ? 'italic' : 'normal' },
        size,
        tracking: (ls / size) * 1000,
        leading: lineStep > 0 ? lineStep / size : 1.2,
        features: {},
      },
    ];
    node.paragraph = {
      align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      indent: 0,
    };
    node.name = content.slice(0, 24);
    const layout = layoutText(node);
    const shift = anchor === 'middle' ? layout.width / 2 : anchor === 'end' ? layout.width : 0;
    node.transform = translate((firstX ?? 0) - shift, (firstY ?? 0) - layout.ascent);
    const userBox = nodeBounds(node, this.doc);
    node.appearance = this.appearance(style, userBox, invert(node.transform));
    return this.base(node, el, style, T_el, node.name);
  }

  image(el: Element, style: Style, T_el: Matrix): SceneNode | null {
    const href = this.href(el);
    if (!href) return null;
    let w = parseLength(el.getAttribute('width'), this.vw, NaN);
    let h = parseLength(el.getAttribute('height'), this.vh, NaN);
    const x = parseLength(el.getAttribute('x'), this.vw);
    const y = parseLength(el.getAttribute('y'), this.vh);
    const { children: _c, type: _t, ...props } = makeGroup([], 'Image');
    const node: ImageNode = { ...props, type: 'image', asset: href, width: 0, height: 0 };
    const decoded = href.startsWith('data:') ? dataUrlToBytes(href) : null;
    const natural = decoded ? readImageSize(decoded.bytes) : null;
    if (Number.isNaN(w)) w = natural?.width ?? (Number.isNaN(h) ? 100 : h);
    if (Number.isNaN(h)) h = natural ? (w * natural.height) / natural.width : w;
    if (!(w > 0 && h > 0)) return null;
    let dx = 0;
    let dy = 0;
    const par = el.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';
    if (natural && !par.startsWith('none')) {
      const vb = viewBoxMatrix([0, 0, natural.width, natural.height], w, h, par);
      if (par.includes('slice')) {
        // Visible part of the source image, in its pixels.
        const s = vb[0];
        node.crop = { x: -vb[4] / s, y: -vb[5] / s, width: w / s, height: h / s };
      } else {
        dx = vb[4];
        dy = vb[5];
        w = natural.width * vb[0];
        h = natural.height * vb[3];
      }
    }
    node.width = w;
    node.height = h;
    node.transform = translate(x + dx, y + dy);
    if (decoded) {
      const mime = sniffImageMime(decoded.bytes) ?? decoded.mime;
      this.pendingAssets.push(
        sha256Hex(decoded.bytes).then((hash) => {
          const key = `assets/${hash}.${extForMime(mime)}`;
          node.asset = key;
          this.doc.assets[key] = bytesToDataUrl(decoded.bytes, mime);
        }),
      );
    } else this.counters.external++;
    node.name = el.getAttribute('id') ?? 'Image';
    return this.base(node, el, style, T_el);
  }

  report(report: ImportReport) {
    const c = this.counters;
    const w = report.warnings;
    if (c.masks) w.push(countMessage(c.masks, 'mask', 'masks', 'dropped'));
    if (c.filters) w.push(countMessage(c.filters, 'filter effect', 'filter effects', 'dropped'));
    if (c.patterns)
      w.push(countMessage(c.patterns, 'pattern fill', 'pattern fills', 'replaced with a flat color'));
    if (c.markers) w.push(countMessage(c.markers, 'marker', 'markers', 'dropped'));
    if (c.external) w.push(countMessage(c.external, 'linked image', 'linked images', 'left unembedded'));
    if (c.unsupported)
      w.push(countMessage(c.unsupported, 'unsupported element', 'unsupported elements', 'skipped'));
    if (c.clips) w.push(countMessage(c.clips, 'text clip shape', 'text clip shapes', 'dropped'));
    if (c.cssSkipped) w.push(countMessage(c.cssSkipped, 'CSS rule', 'CSS rules', 'skipped'));
    if (c.spread) w.push('Repeating gradients now pad at their ends.');
    if (c.focal) w.push('Radial gradient focal points were centered.');
    if (c.textStyles) w.push('Mixed text styles were merged into one style per text.');
    for (const [k, v] of Object.entries(c)) if (v) note(report, k, v);
  }
}

/** Parse SVG (or gzipped SVGZ) bytes into a new document. */
export async function importSvg(
  bytes: Uint8Array,
  opts: ImportOptions,
): Promise<{ doc: CurvsDocument; report: ImportReport }> {
  let data = bytes;
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
  const text = fromUtf8(data);
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length)
    throw new Error('This SVG file could not be read. It may be damaged.');
  const name = opts.fileName.replace(/\.(svgz?|xml)$/i, '') || 'Untitled';
  const r = new SvgReader(root, name);
  const report = emptyReport('svg');

  const vb = numberList(root.getAttribute('viewBox'));
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  const wAttr = root.getAttribute('width');
  const hAttr = root.getAttribute('height');
  const abs = (v: string | null) => v !== null && !/%\s*$/.test(v) && parseLength(v, 0, NaN) > 0;
  let W = abs(wAttr) ? parseLength(wAttr, 0) : NaN;
  let H = abs(hAttr) ? parseLength(hAttr, 0) : NaN;
  if (hasVb) {
    if (Number.isNaN(W) && Number.isNaN(H)) {
      W = vb[2];
      H = vb[3];
    } else if (Number.isNaN(W)) W = (H * vb[2]) / vb[3];
    else if (Number.isNaN(H)) H = (W * vb[3]) / vb[2];
  }
  r.vw = hasVb ? vb[2] : Number.isNaN(W) ? 300 : W;
  r.vh = hasVb ? vb[3] : Number.isNaN(H) ? 150 : H;
  const rootStyle = r.computeStyle(root, {});
  const rootM: Matrix =
    hasVb && !Number.isNaN(W)
      ? viewBoxMatrix(vb, W, H, root.getAttribute('preserveAspectRatio'))
      : [...IDENTITY];
  const nodes = r.children(root, rootStyle, 0);
  for (const n of nodes) n.transform = multiply(rootM, n.transform);
  if (rootStyle.opacity && num(rootStyle.opacity, 1) < 1)
    for (const n of nodes) n.opacity *= num(rootStyle.opacity, 1);
  await Promise.all(r.pendingAssets);

  const ab = r.doc.artboards[0];
  if (Number.isNaN(W) || Number.isNaN(H)) {
    let b: Rect | null = null;
    for (const n of nodes) b = unionRect(b, nodeBounds(n, r.doc));
    W = Number.isNaN(W) ? Math.max(1, b ? b.x + b.width : 300) : W;
    H = Number.isNaN(H) ? Math.max(1, b ? b.y + b.height : 150) : H;
  }
  ab.width = W;
  ab.height = H;
  ab.children = nodes;
  r.doc.view = { artboard: ab.id, zoom: 1, cx: W / 2, cy: H / 2 };
  r.report(report);
  let count = 0;
  const visit = (n: SceneNode) => {
    count++;
    if (n.type === 'group' || n.type === 'clipGroup') n.children.forEach(visit);
  };
  nodes.forEach(visit);
  note(report, 'objects', count);
  return { doc: r.doc, report };
}
