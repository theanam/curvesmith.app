import { isEvenOdd } from '../../core/document';
/* Flattens a page into a display list of simple drawing operations for the PDF, EPS and EMF writers.
   It mirrors src/render/paint.ts: items paint bottom-to-top, drop shadows first, width profiles and
   arrowheads become fills, inside/outside strokes carry their clip. Group opacity is pushed down to
   each object (the formats have no cheap isolated layers). */
import type {
  BlendMode,
  Color,
  CurvsDocument,
  ImageNode,
  Matrix,
  Paint,
  SceneNode,
  StrokeItem,
  Subpath,
  TextNode,
  Vec,
} from '../../core/types';
import { multiply, translate } from '../../core/matrix';
import { nodeSubpaths } from '../../core/geometry/node';
import { arrowHeads, profileOutline } from '../../core/geometry/strokes';
import { resolveCmyk, resolveColor, rgb } from '../../core/color';
import { rectSubpaths, uniformCorners } from '../../core/geometry/shapes';
import { fontKey, type LoadedFont, textOutlines } from './fonts';
import { imageLayers, imageRect } from '../../core/image';
import type { Page } from './pages';

type PaintProps = { paint: Paint; opacity: number; blend: BlendMode };

export type FillOp = PaintProps & { op: 'fill'; m: Matrix; subpaths: Subpath[]; evenOdd: boolean };
export type StrokeOp = PaintProps &
  Pick<StrokeItem, 'width' | 'cap' | 'join' | 'miter' | 'dash' | 'dashOffset' | 'align'> & {
    op: 'stroke';
    m: Matrix;
    subpaths: Subpath[];
    evenOdd: boolean;
  };
export type TextOp = PaintProps & {
  op: 'text';
  m: Matrix;
  node: TextNode;
  stroke: Pick<StrokeItem, 'width' | 'cap' | 'join'> | null;
};
export type ImageOp = {
  op: 'image';
  m: Matrix;
  node: ImageNode;
  src: string | undefined;
  opacity: number;
  blend: BlendMode;
};
export type ClipOp = { op: 'clip'; m: Matrix; subpaths: Subpath[]; evenOdd: boolean };
export type DrawOp =
  | FillOp
  | StrokeOp
  | TextOp
  | ImageOp
  | ClipOp
  | { op: 'unclip' }
  | { op: 'layer'; name: string }
  | { op: 'endLayer' };

export type FlattenOptions = {
  doc: CurvsDocument;
  fonts?: Map<string, LoadedFont>;
  /** Turn text into glyph outlines when its font is available. */
  textOutlines: boolean;
  warn: (message: string) => void;
};

/** Text nodes reachable from a page (including inside symbols). */
export function collectText(page: Page, doc: CurvsDocument): TextNode[] {
  const out: TextNode[] = [];
  const seen = new Set<string>();
  const visit = (n: SceneNode, depth: number) => {
    if (depth > 32) return;
    if (n.type === 'text') out.push(n);
    if (n.type === 'group' || n.type === 'clipGroup') n.children.forEach((c) => visit(c, depth + 1));
    if (n.type === 'instance' && !seen.has(n.symbol)) {
      const sym = doc.symbols.find((s) => s.id === n.symbol);
      if (sym) visit(sym.root, depth + 1);
    }
  };
  page.roots.forEach((r) => visit(r.node, 0));
  return out;
}

export function flattenPage(page: Page, opts: FlattenOptions): DrawOp[] {
  const ops: DrawOp[] = [];
  const { doc, warn } = opts;
  for (const bg of page.backgrounds) {
    ops.push({
      op: 'fill',
      m: translate(bg.rect.x, bg.rect.y),
      subpaths: rectSubpaths({ width: bg.rect.width, height: bg.rect.height, corners: uniformCorners(0) }),
      evenOdd: false,
      paint: { type: 'solid', color: bg.color },
      opacity: 1,
      blend: 'normal',
    });
  }

  const shapeOps = (
    n: SceneNode,
    subpaths: Subpath[],
    m: Matrix,
    opacity: number,
    blend: BlendMode,
    evenOdd: boolean,
  ) => {
    const items = n.appearance.items;
    const closedShape = subpaths.some((s) => s.closed);
    const itemBlend = (b: BlendMode) => (b !== 'normal' ? b : blend);
    for (const it of items) {
      if (it.kind !== 'effect' || !it.visible || it.effect.type !== 'dropShadow') continue;
      const e = it.effect;
      if (e.blur > 0) warn('Shadows were exported without blur.');
      ops.push({
        op: 'fill',
        m: multiply(m, translate(e.x, e.y)),
        subpaths,
        evenOdd,
        paint: { type: 'solid', color: e.color },
        opacity,
        blend,
      });
    }
    for (const it of items) {
      if (!it.visible) continue;
      if (it.kind === 'fill') {
        ops.push({
          op: 'fill',
          m,
          subpaths,
          evenOdd,
          paint: it.paint,
          opacity: opacity * it.opacity,
          blend: itemBlend(it.blend),
        });
      } else if (it.kind === 'stroke') {
        if (it.width <= 0) continue;
        const common = { paint: it.paint, opacity: opacity * it.opacity, blend: itemBlend(it.blend) };
        if (it.profile && it.profile.length) {
          ops.push({
            op: 'fill',
            m,
            subpaths: profileOutline(subpaths, it.width, it.profile),
            evenOdd: false,
            ...common,
          });
        } else {
          ops.push({
            op: 'stroke',
            m,
            subpaths,
            evenOdd,
            ...common,
            width: it.width,
            cap: it.cap,
            join: it.join,
            miter: it.miter,
            dash: it.dash,
            dashOffset: it.dashOffset,
            align: closedShape ? it.align : 'center',
          });
        }
        if (it.arrowStart || it.arrowEnd)
          ops.push({ op: 'fill', m, subpaths: arrowHeads(subpaths, it), evenOdd: false, ...common });
      } else if (it.effect.type === 'innerShadow') warn('Inner shadows were dropped.');
    }
  };

  const visit = (
    n: SceneNode,
    parent: Matrix,
    inheritedOpacity: number,
    inheritedBlend: BlendMode,
    depth: number,
  ) => {
    if (!n.visible || depth > 64) return;
    const m = multiply(parent, n.transform);
    const opacity = inheritedOpacity * n.opacity;
    const blend = n.blend !== 'normal' ? n.blend : inheritedBlend;
    if (n.appearance.items.some((i) => i.kind === 'effect' && i.visible && i.effect.type === 'blur'))
      warn('Blur effects were dropped.');
    switch (n.type) {
      case 'group':
        if (n.opacity < 1 && n.children.length > 1) warn('Group opacity was applied to each object.');
        for (const c of n.children) visit(c, m, opacity, blend, depth + 1);
        return;
      case 'clipGroup': {
        const c = n.clip;
        ops.push({
          op: 'clip',
          m: multiply(m, c.transform),
          subpaths: nodeSubpaths(c, doc),
          evenOdd: isEvenOdd(c),
        });
        for (const k of n.children) visit(k, m, opacity, blend, depth + 1);
        ops.push({ op: 'unclip' });
        return;
      }
      case 'instance': {
        const sym = doc.symbols.find((s) => s.id === n.symbol);
        if (sym) visit(sym.root, m, opacity, blend, depth + 1);
        return;
      }
      case 'image': {
        // Same stack as a rectangle with the bitmap between fills and strokes (see render/paint.ts).
        const { below, above } = imageLayers(n);
        const rect = imageRect(n);
        if (below.length) shapeOps({ ...n, appearance: { items: below } }, rect, m, opacity, blend, false);
        ops.push({ op: 'image', m, node: n, src: doc.assets[n.asset], opacity, blend });
        if (above.length) shapeOps({ ...n, appearance: { items: above } }, rect, m, opacity, blend, false);
        return;
      }
      case 'text': {
        const font = opts.fonts?.get(fontKey(n.runs[0].font))?.font;
        if (opts.textOutlines && font) {
          shapeOps(n, textOutlines(n, font), m, opacity, blend, false);
          return;
        }
        for (const it of n.appearance.items) {
          if (!it.visible) continue;
          if (it.kind === 'fill')
            ops.push({
              op: 'text',
              m,
              node: n,
              paint: it.paint,
              opacity: opacity * it.opacity,
              blend,
              stroke: null,
            });
          else if (it.kind === 'stroke' && it.width > 0)
            ops.push({
              op: 'text',
              m,
              node: n,
              paint: it.paint,
              opacity: opacity * it.opacity,
              blend,
              stroke: it,
            });
          else if (it.kind === 'effect' && it.effect.type !== 'blur') warn('Text shadows were dropped.');
        }
        return;
      }
      default:
        shapeOps(n, nodeSubpaths(n, doc), m, opacity, blend, isEvenOdd(n));
    }
  };

  let layer: string | null = null;
  for (const r of page.roots) {
    if (r.layer !== layer) {
      if (layer !== null) ops.push({ op: 'endLayer' });
      ops.push({ op: 'layer', name: r.layer });
      layer = r.layer;
    }
    visit(r.node, r.m, 1, 'normal', 0);
  }
  if (layer !== null) ops.push({ op: 'endLayer' });
  return ops;
}

export type Segment =
  { t: 'M'; p: Vec } | { t: 'L'; p: Vec } | { t: 'C'; c1: Vec; c2: Vec; p: Vec } | { t: 'Z' };

/** Path segments in the same order as the canvas renderer (closing segment drawn explicitly, then Z). */
export function pathSegments(subpaths: Subpath[]): Segment[] {
  const out: Segment[] = [];
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    out.push({ t: 'M', p: [sp.nodes[0].x, sp.nodes[0].y] });
    const n = sp.nodes.length;
    const count = sp.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      if (!a.out && !b.in) {
        if (!(sp.closed && i === n - 1)) out.push({ t: 'L', p: [b.x, b.y] });
      } else out.push({ t: 'C', c1: a.out ?? [a.x, a.y], c2: b.in ?? [b.x, b.y], p: [b.x, b.y] });
    }
    if (sp.closed) out.push({ t: 'Z' });
  }
  return out;
}

/** A single representative color for writers without gradients (stop average). */
export function flatColor(paint: Paint, doc: CurvsDocument) {
  if (paint.type === 'solid') return resolveColor(paint.color, doc.swatches);
  if (!paint.stops.length) return rgb(0, 0, 0);
  const cs = paint.stops.map((s) => resolveColor(s.color, doc.swatches));
  const avg = (k: 'r' | 'g' | 'b' | 'a') => cs.reduce((s, c) => s + c[k], 0) / cs.length;
  return rgb(avg('r'), avg('g'), avg('b'), avg('a'));
}

/** Sorted gradient stops resolved to sRGB, padded to cover 0..1. */
export function resolvedStops(paint: Extract<Paint, { stops: unknown }>, doc: CurvsDocument) {
  const stops = [...paint.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => ({
      offset: Math.max(0, Math.min(1, s.offset)),
      color: resolveColor(s.color, doc.swatches),
      components: deviceComponents(s.color, doc),
    }));
  if (!stops.length)
    stops.push({ offset: 0, color: rgb(0, 0, 0), components: deviceComponents(rgb(0, 0, 0), doc) });
  if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 });
  if (stops[stops.length - 1].offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 });
  if (stops.length === 1) stops.push({ ...stops[0], offset: 1 });
  return stops;
}

/** Device color space for print formats: CMYK documents write inks, RGB documents write RGB. */
export const deviceSpace = (doc: CurvsDocument): 'DeviceCMYK' | 'DeviceRGB' =>
  doc.colorProfile === 'cmyk' ? 'DeviceCMYK' : 'DeviceRGB';

/** Color components in the document's device space (0–1 each). */
export function deviceComponents(c: Color, doc: CurvsDocument): number[] {
  if (doc.colorProfile === 'cmyk') {
    const k = resolveCmyk(c, doc.swatches);
    return [k.c, k.m, k.y, k.k];
  }
  const r = resolveColor(c, doc.swatches);
  return [r.r, r.g, r.b];
}

/** Uniform scale factor of a matrix (for stroke widths when points are pre-transformed). */
export const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
