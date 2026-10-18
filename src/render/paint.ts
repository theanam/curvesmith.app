/* Canvas2D document renderer. This file defines how an appearance stack is painted; the SVG/PDF writers mirror it:
   - items paint bottom-to-top in array order;
   - drop shadows paint beneath everything, inner shadows right after the fills that precede them;
   - stroke align: center = plain stroke; inside = clipped to the shape at 2x width; outside = clipped to the
     shape's exterior at 2x width;
   - a stroke with a width profile is drawn as a filled outline (core/geometry/strokes.ts);
   - arrowheads are filled with the stroke paint. */
import type {
  CurvsDocument,
  Effect,
  ImageNode,
  Matrix,
  Paint,
  SceneNode,
  StrokeItem,
  Subpath,
  Swatch,
  TextNode,
} from '../core/types';
import { cssColor } from '../core/color';
import { nodeSubpaths } from '../core/geometry/node';
import { arrowHeads, profileOutline } from '../core/geometry/strokes';
import { cssFont, layoutText, primaryRun } from '../core/text';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type RenderOptions = {
  /** Device pixels per point at the current transform (zoom × devicePixelRatio). Used for shadows and blur. */
  pixelScale: number;
  /** Ids to skip (e.g. the node being edited as live text). */
  hidden?: Set<string>;
  /** Called when an async resource (image) finishes loading so the caller can re-render. */
  onAsset?: () => void;
  /** Draw outlines only (View › Outline mode). */
  outline?: boolean;
  outlineColor?: string;
};

const pathCache = new WeakMap<Subpath[], Path2D>();

export function toPath2D(subpaths: Subpath[]): Path2D {
  const cached = pathCache.get(subpaths);
  if (cached) return cached;
  const p = new Path2D();
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    p.moveTo(sp.nodes[0].x, sp.nodes[0].y);
    const n = sp.nodes.length;
    const count = sp.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      if (!a.out && !b.in) p.lineTo(b.x, b.y);
      else {
        const c1 = a.out ?? [a.x, a.y];
        const c2 = b.in ?? [b.x, b.y];
        p.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b.x, b.y);
      }
    }
    if (sp.closed) p.closePath();
  }
  pathCache.set(subpaths, p);
  return p;
}

function paintStyle(ctx: Ctx, paint: Paint, swatches: Swatch[], opacity: number): string | CanvasGradient {
  if (paint.type === 'solid') return cssColor(paint.color, swatches, opacity);
  const [fx, fy] = paint.from;
  const [tx, ty] = paint.to;
  let g: CanvasGradient;
  if (paint.type === 'linear') g = ctx.createLinearGradient(fx, fy, tx, ty);
  else if (paint.type === 'radial')
    g = ctx.createRadialGradient(fx, fy, 0, fx, fy, Math.hypot(tx - fx, ty - fy) || 1);
  else if ('createConicGradient' in ctx) g = ctx.createConicGradient(Math.atan2(ty - fy, tx - fx), fx, fy);
  else g = (ctx as CanvasRenderingContext2D).createLinearGradient(fx, fy, tx, ty);
  for (const s of [...paint.stops].sort((a, b) => a.offset - b.offset)) {
    g.addColorStop(Math.max(0, Math.min(1, s.offset)), cssColor(s.color, swatches, opacity));
  }
  return g;
}

const IDENT = new DOMMatrix();

/** Paint a shadow of `path` only (the shape itself lands far away), in device space. */
function shadowOnly(
  ctx: Ctx,
  path: Path2D,
  fillRule: CanvasFillRule,
  e: Extract<Effect, { type: 'dropShadow' | 'innerShadow' }>,
  swatches: Swatch[],
  pixelScale: number,
  inner: boolean,
) {
  const t = ctx.getTransform();
  const FAR = 100000;
  const dx = t.a * e.x + t.c * e.y;
  const dy = t.b * e.x + t.d * e.y;
  ctx.save();
  if (inner) ctx.clip(path, fillRule);
  const shifted = new Path2D();
  const m = new DOMMatrix([t.a, t.b, t.c, t.d, t.e - FAR, t.f]);
  if (inner) {
    // A huge frame with the shape cut out: its shadow falls inside the shape.
    const frame = new Path2D();
    frame.rect(-FAR * 4, -FAR * 4, FAR * 8, FAR * 8);
    shifted.addPath(frame, new DOMMatrix([1, 0, 0, 1, -FAR, 0]));
  }
  shifted.addPath(path, m);
  ctx.setTransform(IDENT);
  ctx.shadowColor = cssColor(e.color, swatches);
  ctx.shadowBlur = e.blur * pixelScale;
  ctx.shadowOffsetX = FAR + dx;
  ctx.shadowOffsetY = dy;
  ctx.fillStyle = '#000';
  ctx.fill(shifted, inner ? 'evenodd' : fillRule);
  ctx.restore();
}

function drawStroke(
  ctx: Ctx,
  s: StrokeItem,
  subpaths: Subpath[],
  path: Path2D,
  closedShape: boolean,
  swatches: Swatch[],
) {
  const style = paintStyle(ctx, s.paint, swatches, s.opacity);
  ctx.save();
  ctx.globalCompositeOperation = blendOp(s.blend);
  if (s.profile && s.profile.length) {
    ctx.fillStyle = style;
    ctx.fill(toPath2D(profileOutline(subpaths, s.width, s.profile)), 'nonzero');
  } else {
    let width = s.width;
    if (closedShape && s.align === 'inside') {
      ctx.clip(path);
      width *= 2;
    } else if (closedShape && s.align === 'outside') {
      const outside = new Path2D();
      outside.rect(-1e6, -1e6, 2e6, 2e6);
      outside.addPath(path);
      ctx.clip(outside, 'evenodd');
      width *= 2;
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = s.cap;
    ctx.lineJoin = s.join;
    ctx.miterLimit = s.miter;
    ctx.setLineDash(s.dash.map((d) => (d === 0 ? 0.001 : d)));
    ctx.lineDashOffset = s.dashOffset;
    ctx.stroke(path);
  }
  ctx.restore();
  if (s.arrowStart || s.arrowEnd) {
    ctx.save();
    ctx.fillStyle = style;
    ctx.fill(toPath2D(arrowHeads(subpaths, s)));
    ctx.restore();
  }
}

export const blendOp = (b: string): GlobalCompositeOperation =>
  b === 'normal' ? 'source-over' : (b as GlobalCompositeOperation);

function drawShape(ctx: Ctx, n: SceneNode, subpaths: Subpath[], doc: CurvsDocument, opts: RenderOptions) {
  const path = toPath2D(subpaths);
  const fillRule: CanvasFillRule = n.type === 'path' && n.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  if (opts.outline) {
    ctx.save();
    ctx.lineWidth = 1 / Math.max(opts.pixelScale, 1e-6);
    ctx.strokeStyle = opts.outlineColor ?? '#000';
    ctx.stroke(path);
    ctx.restore();
    return;
  }
  const items = n.appearance.items;
  const sw = doc.swatches;
  const closedShape = subpaths.some((s) => s.closed);
  for (const it of items) {
    if (it.kind === 'effect' && it.visible && it.effect.type === 'dropShadow')
      shadowOnly(ctx, path, fillRule, it.effect, sw, opts.pixelScale, false);
  }
  for (const it of items) {
    if (!it.visible) continue;
    if (it.kind === 'fill') {
      ctx.save();
      ctx.globalCompositeOperation = blendOp(it.blend);
      ctx.fillStyle = paintStyle(ctx, it.paint, sw, it.opacity);
      ctx.fill(path, fillRule);
      ctx.restore();
    } else if (it.kind === 'stroke') {
      if (it.width > 0) drawStroke(ctx, it, subpaths, path, closedShape, sw);
    } else if (it.effect.type === 'innerShadow') {
      shadowOnly(ctx, path, fillRule, it.effect, sw, opts.pixelScale, true);
    }
  }
}

function drawText(ctx: Ctx, n: TextNode, doc: CurvsDocument, opts: RenderOptions) {
  const run = primaryRun(n);
  const layout = layoutText(n);
  ctx.save();
  ctx.font = cssFont(run);
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx)
    (ctx as CanvasRenderingContext2D).letterSpacing = `${(run.tracking / 1000) * run.size}px`;
  if (opts.outline) {
    ctx.fillStyle = opts.outlineColor ?? '#000';
    for (const l of layout.lines) ctx.fillText(l.text, l.x, l.baseline);
    ctx.restore();
    return;
  }
  const sw = doc.swatches;
  const shadows = n.appearance.items.filter(
    (i) => i.kind === 'effect' && i.visible && i.effect.type === 'dropShadow',
  );
  for (const it of n.appearance.items) {
    if (!it.visible) continue;
    if (it.kind === 'fill') {
      ctx.save();
      ctx.globalCompositeOperation = blendOp(it.blend);
      ctx.fillStyle = paintStyle(ctx, it.paint, sw, it.opacity);
      const sh = shadows[0];
      if (sh && sh.kind === 'effect' && sh.effect.type === 'dropShadow') {
        const t = ctx.getTransform();
        ctx.shadowColor = cssColor(sh.effect.color, sw);
        ctx.shadowBlur = sh.effect.blur * opts.pixelScale;
        ctx.shadowOffsetX = t.a * sh.effect.x + t.c * sh.effect.y;
        ctx.shadowOffsetY = t.b * sh.effect.x + t.d * sh.effect.y;
      }
      for (const l of layout.lines) ctx.fillText(l.text, l.x, l.baseline);
      ctx.restore();
    } else if (it.kind === 'stroke' && it.width > 0) {
      ctx.save();
      ctx.strokeStyle = paintStyle(ctx, it.paint, sw, it.opacity);
      ctx.lineWidth = it.width;
      ctx.lineJoin = it.join;
      ctx.lineCap = it.cap;
      ctx.setLineDash(it.dash);
      for (const l of layout.lines) ctx.strokeText(l.text, l.x, l.baseline);
      ctx.restore();
    }
  }
  ctx.restore();
}

const imageCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();

export function getImage(src: string, onLoad?: () => void): HTMLImageElement | null {
  const c = imageCache.get(src);
  if (c && c !== 'loading' && c !== 'error') return c;
  if (!c && typeof Image !== 'undefined') {
    imageCache.set(src, 'loading');
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      onLoad?.();
    };
    img.onerror = () => imageCache.set(src, 'error');
    img.src = src;
  }
  return null;
}

function drawImage(ctx: Ctx, n: ImageNode, doc: CurvsDocument, opts: RenderOptions) {
  const src = doc.assets[n.asset];
  const img = src ? getImage(src, opts.onAsset) : null;
  if (opts.outline || !img) {
    ctx.save();
    ctx.strokeStyle = opts.outlineColor ?? 'rgba(128,128,128,.8)';
    ctx.lineWidth = 1 / opts.pixelScale;
    ctx.strokeRect(0, 0, n.width, n.height);
    ctx.restore();
    if (!img) return;
  }
  if (n.crop) ctx.drawImage(img, n.crop.x, n.crop.y, n.crop.width, n.crop.height, 0, 0, n.width, n.height);
  else ctx.drawImage(img, 0, 0, n.width, n.height);
}

function needsLayer(n: SceneNode) {
  return (
    (n.opacity < 1 || n.blend !== 'normal') &&
    (n.type === 'group' || n.type === 'clipGroup' || n.type === 'instance')
  );
}

function layerBlur(n: SceneNode): number {
  for (const it of n.appearance.items)
    if (it.kind === 'effect' && it.visible && it.effect.type === 'blur') return it.effect.radius;
  return 0;
}

export function drawNode(ctx: Ctx, n: SceneNode, doc: CurvsDocument, opts: RenderOptions) {
  if (!n.visible || opts.hidden?.has(n.id)) return;
  ctx.save();
  const t = n.transform;
  ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
  const blur = opts.outline ? 0 : layerBlur(n);
  const hasFilter = blur > 0 && 'filter' in ctx;
  if (!opts.outline) {
    ctx.globalAlpha *= n.opacity;
    ctx.globalCompositeOperation = blendOp(n.blend);
  }
  if (hasFilter) ctx.filter = `blur(${blur * opts.pixelScale}px)`;
  if (needsLayer(n) && !opts.outline) {
    drawLayered(ctx, n, doc, opts);
  } else {
    drawContent(ctx, n, doc, opts);
  }
  ctx.restore();
}

function drawContent(ctx: Ctx, n: SceneNode, doc: CurvsDocument, opts: RenderOptions) {
  switch (n.type) {
    case 'group':
      for (const c of n.children) drawNode(ctx, c, doc, opts);
      break;
    case 'clipGroup': {
      ctx.save();
      const c = n.clip;
      const cm: Matrix = c.transform;
      const clipPath = new Path2D();
      clipPath.addPath(toPath2D(nodeSubpaths(c, doc)), new DOMMatrix(cm));
      ctx.clip(clipPath);
      for (const k of n.children) drawNode(ctx, k, doc, opts);
      ctx.restore();
      break;
    }
    case 'instance': {
      const sym = doc.symbols.find((s) => s.id === n.symbol);
      if (sym) drawNode(ctx, sym.root, doc, opts);
      break;
    }
    case 'text':
      drawText(ctx, n, doc, opts);
      break;
    case 'image':
      drawImage(ctx, n, doc, opts);
      break;
    default:
      drawShape(ctx, n, nodeSubpaths(n, doc), doc, opts);
  }
}

/** Groups with opacity/blend composite as one layer so overlapping children don't show through each other. */
function drawLayered(ctx: Ctx, n: SceneNode, doc: CurvsDocument, opts: RenderOptions) {
  const canvas = ctx.canvas as HTMLCanvasElement | OffscreenCanvas;
  const W = canvas.width;
  const H = canvas.height;
  if (typeof OffscreenCanvas === 'undefined' || !W || !H) {
    drawContent(ctx, n, doc, opts);
    return;
  }
  const layer = new OffscreenCanvas(W, H);
  const lctx = layer.getContext('2d');
  if (!lctx) {
    drawContent(ctx, n, doc, opts);
    return;
  }
  lctx.setTransform(ctx.getTransform());
  drawContent(lctx, n, doc, opts);
  const alpha = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.save();
  ctx.setTransform(IDENT);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

export function drawArtboardContent(
  ctx: Ctx,
  doc: CurvsDocument,
  artboardId: string,
  opts: RenderOptions,
  background = true,
) {
  const ab = doc.artboards.find((a) => a.id === artboardId);
  if (!ab) return;
  ctx.save();
  ctx.translate(ab.x, ab.y);
  if (background && ab.background) {
    ctx.fillStyle = cssColor(ab.background, doc.swatches);
    ctx.fillRect(0, 0, ab.width, ab.height);
  }
  for (const c of ab.children) drawNode(ctx, c, doc, opts);
  ctx.restore();
}
