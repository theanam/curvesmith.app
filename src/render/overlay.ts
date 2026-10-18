/* Screen-space overlay drawing. Values come from design/tokens.json → canvasOverlay. */
import type { Matrix, Subpath, Vec } from '../core/types';
import type { SmartGuide } from '../core/snapping';
import type { ViewState } from '../state/store';
import { apply, multiply } from '../core/matrix';
import type { Rect } from '../core/geometry/bezier';
import tokens from '../styles/tokens.json';

const O = tokens.canvasOverlay;
export const OVERLAY = {
  volt: O.selection,
  anchorFill: O.anchorFill,
  anchorSize: O.anchorSize,
  anchorSelectedSize: O.anchorSelectedSize,
  handleRadius: O.handleRadius,
  outlineWidth: O.pathOutlineWidth,
  dash: O.smartGuideDash,
  hudBg: O.hudBg,
  hudFg: O.hudFg,
  hudAccent: O.hudAccentFg,
  ink: tokens.brand.ink,
};

export const viewMatrix = (v: ViewState): Matrix => [v.zoom, 0, 0, v.zoom, v.panX, v.panY];

/** Trace subpaths transformed into screen space (keeps overlays crisp at any zoom). */
export function traceScreen(ctx: CanvasRenderingContext2D, subpaths: Subpath[], m: Matrix) {
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    const p0 = apply(m, [sp.nodes[0].x, sp.nodes[0].y]);
    ctx.moveTo(p0[0], p0[1]);
    const n = sp.nodes.length;
    const count = sp.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      const pb = apply(m, [b.x, b.y]);
      if (!a.out && !b.in) ctx.lineTo(pb[0], pb[1]);
      else {
        const c1 = apply(m, a.out ?? [a.x, a.y]);
        const c2 = apply(m, b.in ?? [b.x, b.y]);
        ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], pb[0], pb[1]);
      }
    }
    if (sp.closed) ctx.closePath();
  }
}

export function drawOutline(
  ctx: CanvasRenderingContext2D,
  subpaths: Subpath[],
  world: Matrix,
  view: ViewState,
  width = OVERLAY.outlineWidth,
) {
  ctx.save();
  ctx.beginPath();
  traceScreen(ctx, subpaths, multiply(viewMatrix(view), world));
  ctx.strokeStyle = OVERLAY.volt;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

export function drawAnchor(ctx: CanvasRenderingContext2D, p: Vec, selected: boolean, smooth = false) {
  const s = selected ? OVERLAY.anchorSelectedSize : OVERLAY.anchorSize;
  ctx.save();
  ctx.beginPath();
  if (smooth && !selected) ctx.arc(p[0], p[1], s / 2 + 0.5, 0, Math.PI * 2);
  else ctx.rect(Math.round(p[0] - s / 2) + 0.5, Math.round(p[1] - s / 2) + 0.5, s - 1, s - 1);
  ctx.fillStyle = selected ? OVERLAY.volt : OVERLAY.anchorFill;
  ctx.strokeStyle = selected ? OVERLAY.anchorFill : OVERLAY.volt;
  ctx.lineWidth = selected ? 1.5 : 1.25;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawHandle(ctx: CanvasRenderingContext2D, anchor: Vec, handle: Vec) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(anchor[0], anchor[1]);
  ctx.lineTo(handle[0], handle[1]);
  ctx.strokeStyle = OVERLAY.volt;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(handle[0], handle[1], OVERLAY.handleRadius, 0, Math.PI * 2);
  ctx.fillStyle = OVERLAY.anchorFill;
  ctx.fill();
  ctx.strokeStyle = OVERLAY.volt;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

/** Bounding box with 8 square handles (Move tool). `m` maps the unit square to screen. */
export function drawBox(ctx: CanvasRenderingContext2D, m: Matrix, handles = true) {
  const pts: Vec[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map((p) => apply(m, p as Vec));
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.strokeStyle = OVERLAY.volt;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (handles) for (const h of boxHandles(m)) drawAnchor(ctx, h.p, false);
  ctx.restore();
}

export type BoxHandle = { id: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'; u: Vec; p: Vec };

export function boxHandles(m: Matrix): BoxHandle[] {
  const H: [BoxHandle['id'], Vec][] = [
    ['nw', [0, 0]],
    ['n', [0.5, 0]],
    ['ne', [1, 0]],
    ['e', [1, 0.5]],
    ['se', [1, 1]],
    ['s', [0.5, 1]],
    ['sw', [0, 1]],
    ['w', [0, 0.5]],
  ];
  return H.map(([id, u]) => ({ id, u, p: apply(m, u) }));
}

export function drawGuides(ctx: CanvasRenderingContext2D, guides: SmartGuide[], view: ViewState) {
  ctx.save();
  ctx.strokeStyle = OVERLAY.volt;
  ctx.lineWidth = 1;
  ctx.setLineDash(OVERLAY.dash);
  for (const g of guides) {
    ctx.beginPath();
    if (g.axis === 'x') {
      const x = Math.round(g.pos * view.zoom + view.panX) + 0.5;
      ctx.moveTo(x, g.from * view.zoom + view.panY);
      ctx.lineTo(x, g.to * view.zoom + view.panY);
    } else {
      const y = Math.round(g.pos * view.zoom + view.panY) + 0.5;
      ctx.moveTo(g.from * view.zoom + view.panX, y);
      ctx.lineTo(g.to * view.zoom + view.panX, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const g of guides) {
    if (!g.label) continue;
    const at: Vec =
      g.axis === 'x'
        ? [g.pos * view.zoom + view.panX + 4, g.to * view.zoom + view.panY + 4]
        : [g.to * view.zoom + view.panX + 4, g.pos * view.zoom + view.panY - 8];
    drawPill(ctx, g.label, at);
  }
  ctx.restore();
}

export function drawPill(ctx: CanvasRenderingContext2D, label: string, at: Vec) {
  ctx.save();
  ctx.font = '600 10px Geist, system-ui, sans-serif';
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = OVERLAY.volt;
  roundRect(ctx, at[0], at[1], w, 15, 3);
  ctx.fill();
  ctx.fillStyle = OVERLAY.ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, at[0] + 5, at[1] + 7.5);
  ctx.restore();
}

export function drawHud(ctx: CanvasRenderingContext2D, at: Vec, lines: string[]) {
  if (!lines.length) return;
  ctx.save();
  ctx.font = '500 11px "Geist Mono", ui-monospace, monospace';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
  const h = lines.length * 16 + 10;
  let x = at[0] + 14;
  let y = at[1] + 14;
  const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  const ch = ctx.canvas.height / (window.devicePixelRatio || 1);
  if (x + w > cw - 4) x = at[0] - 14 - w;
  if (y + h > ch - 4) y = at[1] - 14 - h;
  ctx.fillStyle = OVERLAY.hudBg;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? OVERLAY.hudFg : OVERLAY.hudAccent;
    ctx.fillText(l, x + 9, y + 6 + i * 16);
  });
  ctx.restore();
}

export function drawMarquee(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.save();
  ctx.fillStyle = 'rgba(22, 199, 91, 0.08)';
  ctx.strokeStyle = OVERLAY.volt;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.width), Math.round(r.height));
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
