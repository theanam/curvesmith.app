/* On-canvas parametric widgets: rectangle corner radius, ellipse arc (pie), star inner depth. */
import type { Draft } from 'immer';
import type { CurvsDocument, EllipseNode, RectNode, SceneNode, StarNode, Vec } from '../core/types';
import type { ToolApi, ToolPointer } from './types';
import { apply, invert } from '../core/matrix';
import { locate, worldMatrix } from '../core/document';
import { beginGesture, endGesture, updateGesture } from '../state/store';
import { OVERLAY } from '../render/overlay';
import { fmt } from './common';

type Widget = { id: string; kind: 'radius' | 'arcStart' | 'arcEnd' | 'depth'; corner?: number; screen: Vec };

function widgetsFor(api: ToolApi): Widget[] {
  if (api.od.selection.length !== 1) return [];
  const loc = locate(api.doc, api.od.selection[0]);
  if (!loc || loc.node.locked) return [];
  const n = loc.node;
  const m = worldMatrix(loc);
  const S = (p: Vec) => api.toScreen(apply(m, p));
  if (n.type === 'rect') {
    const inset = Math.min(Math.abs(n.width), Math.abs(n.height)) / 2;
    const off = (r: number) =>
      Math.min(Math.max(r, api.px(12) / Math.max(1e-6, Math.hypot(m[0], m[1]))), inset);
    const c = n.corners;
    return [
      { id: n.id, kind: 'radius', corner: 0, screen: S([off(c[0].radius), off(c[0].radius)]) },
      { id: n.id, kind: 'radius', corner: 1, screen: S([n.width - off(c[1].radius), off(c[1].radius)]) },
      {
        id: n.id,
        kind: 'radius',
        corner: 2,
        screen: S([n.width - off(c[2].radius), n.height - off(c[2].radius)]),
      },
      { id: n.id, kind: 'radius', corner: 3, screen: S([off(c[3].radius), n.height - off(c[3].radius)]) },
    ];
  }
  if (n.type === 'ellipse') {
    const a0 = ((n.arcStart ?? 0) * Math.PI) / 180;
    const a1 = ((n.arcEnd ?? 360) * Math.PI) / 180;
    return [
      { id: n.id, kind: 'arcStart', screen: S([Math.cos(a0) * n.rx, Math.sin(a0) * n.ry]) },
      ...(n.arcStart !== undefined && n.arcEnd !== undefined && n.arcEnd - n.arcStart < 360
        ? [{ id: n.id, kind: 'arcEnd' as const, screen: S([Math.cos(a1) * n.rx, Math.sin(a1) * n.ry]) }]
        : []),
    ];
  }
  if (n.type === 'star' && !n.polygon) {
    const a = -Math.PI / 2 + Math.PI / n.points;
    const r = n.outerRadius * n.innerRatio;
    return [{ id: n.id, kind: 'depth', screen: S([Math.cos(a) * r, Math.sin(a) * r]) }];
  }
  return [];
}

let active: (Widget & { node: SceneNode }) | null = null;

export function shapeWidgetAt(api: ToolApi, screen: Vec): Widget | null {
  for (const w of widgetsFor(api))
    if (Math.hypot(w.screen[0] - screen[0], w.screen[1] - screen[1]) <= 6) return w;
  return null;
}

export function beginShapeWidget(api: ToolApi, w: Widget) {
  const loc = locate(api.doc, w.id);
  if (!loc) return;
  active = { ...w, node: loc.node };
  beginGesture();
}

export const shapeWidgetActive = () => active !== null;

export function dragShapeWidget(e: ToolPointer, api: ToolApi) {
  if (!active) return;
  const loc = locate(api.doc, active.id);
  if (!loc) return;
  const local = apply(invert(worldMatrix(loc)), e.world);
  const w = active;
  const unit = api.doc.units;
  let label = '';
  updateGesture((d) => {
    const l = locate(d as unknown as CurvsDocument, w.id);
    if (!l) return;
    const n = l.node as Draft<SceneNode>;
    if (n.type === 'rect' && w.corner !== undefined) {
      const r = n as Draft<RectNode>;
      const cx = w.corner === 0 || w.corner === 3 ? local[0] : r.width - local[0];
      const cy = w.corner === 0 || w.corner === 1 ? local[1] : r.height - local[1];
      const radius = Math.max(
        0,
        Math.min((cx + cy) / 2, Math.min(Math.abs(r.width), Math.abs(r.height)) / 2),
      );
      // Without ⌥ all corners change together (the common case).
      if (e.alt) r.corners[w.corner].radius = radius;
      else for (const c of r.corners) c.radius = radius;
      label = `Radius ${fmt(radius, unit)} ${unit}`;
    } else if (n.type === 'ellipse') {
      const el = n as Draft<EllipseNode>;
      let deg = (Math.atan2(local[1] / (el.ry || 1), local[0] / (el.rx || 1)) * 180) / Math.PI;
      if (e.shift) deg = Math.round(deg / 15) * 15;
      if (deg < 0) deg += 360;
      if (w.kind === 'arcStart') {
        if (el.arcEnd === undefined) el.arcEnd = 360;
        el.arcStart = deg;
        if (el.arcEnd <= el.arcStart) el.arcEnd += 360;
      } else {
        el.arcEnd = deg <= (el.arcStart ?? 0) ? deg + 360 : deg;
      }
      el.pie = true;
      label = `${((el.arcEnd ?? 360) - (el.arcStart ?? 0)).toFixed(0)}°`;
    } else if (n.type === 'star') {
      const s = n as Draft<StarNode>;
      s.innerRatio = Math.max(0.02, Math.min(1, Math.hypot(local[0], local[1]) / (s.outerRadius || 1)));
      label = `Depth ${Math.round((1 - s.innerRatio) * 100)}%`;
    }
  });
  api.overlay.hud = { at: e.screen, lines: [label] };
}

export function endShapeWidget(api: ToolApi) {
  if (!active) return;
  const k = active.kind;
  active = null;
  api.overlay.hud = null;
  endGesture(k === 'radius' ? 'Corner radius' : k === 'depth' ? 'Star depth' : 'Arc');
}

export function drawShapeWidgets(ctx: CanvasRenderingContext2D, api: ToolApi) {
  for (const w of widgetsFor(api)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(w.screen[0], w.screen[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = OVERLAY.volt;
    ctx.strokeStyle = OVERLAY.anchorFill;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
