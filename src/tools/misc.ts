import type { Draft } from 'immer';
import type { CurvsDocument, FillItem, Paint, SceneNode, Vec } from '../core/types';
import type { Tool, ToolApi, ToolPointer } from './types';
import { apply, invert } from '../core/matrix';
import { INK, locate, makeText, worldMatrix, clone } from '../core/document';
import { hitTest } from '../render/hittest';
import {
  beginGesture,
  cancelGesture,
  endGesture,
  mutate,
  select,
  setState,
  setView,
  updateGesture,
} from '../state/store';
import { addNode } from '../state/actions';
import { drawAnchor, drawMarquee, OVERLAY } from '../render/overlay';
import { fitRect, stepZoom, zoomAt } from '../render/viewport';
import { drawHover, drawSelectionOutlines } from './common';
import { hexToColor, paintPrimaryColor, resolveColor, rgb } from '../core/color';
import { newId } from '../core/id';

// ---------------------------------------------------------------------------------------------
// Text

export const textTool: Tool = {
  cursor: 'text',
  down() {},
  move(e, api) {
    if (e.dragging && e.moved) {
      const a = api.toScreen(e.downWorld);
      api.overlay.marquee = {
        x: Math.min(a[0], e.screen[0]),
        y: Math.min(a[1], e.screen[1]),
        width: Math.abs(e.screen[0] - a[0]),
        height: Math.abs(e.screen[1] - a[1]),
      };
      api.render();
    } else if (!e.dragging) {
      const hit = hitTest(api.doc, e.world, api.px(3), { deep: true, isolation: api.od.isolation });
      const id = hit?.node.type === 'text' || hit?.node.type === 'path' ? hit.node.id : null;
      if (id !== api.overlay.hoverId) {
        api.overlay.hoverId = id;
        api.render();
      }
    }
  },
  up(e, api) {
    api.overlay.marquee = null;
    const hit = hitTest(api.doc, e.world, api.px(3), { deep: true, isolation: api.od.isolation });
    if (!e.moved && hit?.node.type === 'text') {
      select([hit.node.id]);
      setState({ editingText: hit.node.id });
      return;
    }
    // Text starts in Ink so it is readable on any default fill.
    const color = INK;
    let node;
    if (e.moved) {
      const x = Math.min(e.downWorld[0], e.world[0]);
      const y = Math.min(e.downWorld[1], e.world[1]);
      node = makeText(x, y, '', {
        mode: 'area',
        box: { width: Math.abs(e.world[0] - e.downWorld[0]), height: Math.abs(e.world[1] - e.downWorld[1]) },
      });
    } else if (hit && hit.node.type === 'path') {
      // Type along the clicked path.
      node = makeText(0, 0, '', { mode: 'onPath', pathRef: hit.node.id });
      const loc = locate(api.doc, hit.node.id)!;
      node.transform = worldMatrix(loc);
    } else {
      const size = 24;
      node = makeText(e.world[0], e.world[1] - size * 0.8, '');
    }
    node.name = 'Text';
    const fill: FillItem = {
      kind: 'fill',
      id: newId('ap'),
      visible: true,
      paint: { type: 'solid', color },
      opacity: 1,
      blend: 'normal',
    };
    node.appearance = { items: [fill] };
    addNode(node, 'Text');
    setState({ editingText: node.id });
  },
  overlay(ctx, api) {
    drawHover(ctx, api);
    if (api.overlay.marquee) drawMarquee(ctx, api.overlay.marquee);
  },
};

// ---------------------------------------------------------------------------------------------
// Gradient

type GradDrag = { id: string; which: 'from' | 'to' | 'new' | number; item: number } | null;
let grad: GradDrag = null;

function fillIndex(n: SceneNode): number {
  return n.appearance.items.findIndex((i) => i.kind === 'fill' && i.visible);
}

function gradientOf(api: ToolApi): {
  id: string;
  m: [number, number, number, number, number, number];
  paint: Extract<Paint, { stops: unknown }>;
  item: number;
} | null {
  if (api.od.selection.length !== 1) return null;
  const loc = locate(api.doc, api.od.selection[0]);
  if (!loc) return null;
  const idx = fillIndex(loc.node);
  const it = loc.node.appearance.items[idx] as FillItem | undefined;
  if (!it || it.paint.type === 'solid') return null;
  return { id: loc.node.id, m: worldMatrix(loc), paint: it.paint, item: idx };
}

export const gradientTool: Tool = {
  cursor: 'crosshair',
  down(e, api) {
    const g = gradientOf(api);
    if (g) {
      const from = api.toScreen(apply(g.m, g.paint.from));
      const to = api.toScreen(apply(g.m, g.paint.to));
      const near = (p: Vec) => Math.hypot(p[0] - e.screen[0], p[1] - e.screen[1]) <= 7;
      for (let i = 0; i < g.paint.stops.length; i++) {
        const s = g.paint.stops[i];
        const p: Vec = [from[0] + (to[0] - from[0]) * s.offset, from[1] + (to[1] - from[1]) * s.offset];
        if (near(p) && s.offset > 0.001 && s.offset < 0.999) {
          grad = { id: g.id, which: i, item: g.item };
          beginGesture();
          return;
        }
      }
      if (near(from)) grad = { id: g.id, which: 'from', item: g.item };
      else if (near(to)) grad = { id: g.id, which: 'to', item: g.item };
      if (grad) {
        beginGesture();
        return;
      }
    }
    const hit = hitTest(api.doc, e.world, api.px(3), { isolation: api.od.isolation });
    if (!hit) {
      select([]);
      return;
    }
    select([hit.node.id]);
    grad = { id: hit.node.id, which: 'new', item: Math.max(0, fillIndex(hit.node)) };
    beginGesture();
  },
  move(e, api) {
    if (!grad || !e.dragging || !e.moved) return;
    const g = grad;
    const loc = locate(api.doc, g.id);
    if (!loc) return;
    const inv = invert(worldMatrix(loc));
    const p = apply(inv, e.world);
    const a = apply(inv, e.downWorld);
    updateGesture((d) => {
      const l = locate(d as unknown as CurvsDocument, g.id);
      if (!l) return;
      const n = l.node as Draft<SceneNode>;
      let it = n.appearance.items[g.item] as Draft<FillItem> | undefined;
      if (!it || it.kind !== 'fill') {
        it = {
          kind: 'fill',
          id: newId('ap'),
          visible: true,
          paint: { type: 'solid', color: rgb(0.5, 0.5, 0.5) },
          opacity: 1,
          blend: 'normal',
        } as Draft<FillItem>;
        n.appearance.items.unshift(it);
      }
      if (g.which === 'new') {
        const base = it.paint.type === 'solid' ? it.paint.color : paintPrimaryColor(it.paint as Paint);
        const end =
          it.paint.type !== 'solid'
            ? it.paint.stops[it.paint.stops.length - 1].color
            : resolveColor(base).r + resolveColor(base).g + resolveColor(base).b > 1.5
              ? INK
              : hexToColor('#FFFFFF')!;
        const type = it.paint.type === 'solid' ? 'linear' : it.paint.type;
        it.paint = {
          type,
          from: a,
          to: e.shift ? constrain(a, p) : p,
          stops:
            it.paint.type !== 'solid'
              ? it.paint.stops
              : [
                  { offset: 0, color: base },
                  { offset: 1, color: end },
                ],
        } as never;
      } else if (it.paint.type !== 'solid') {
        if (g.which === 'from') it.paint.from = p;
        else if (g.which === 'to') it.paint.to = e.shift ? constrain(it.paint.from as Vec, p) : p;
        else {
          const f = it.paint.from as Vec;
          const t = it.paint.to as Vec;
          const dx = t[0] - f[0];
          const dy = t[1] - f[1];
          const u = ((p[0] - f[0]) * dx + (p[1] - f[1]) * dy) / (dx * dx + dy * dy || 1);
          it.paint.stops[g.which].offset = Math.max(0, Math.min(1, u));
        }
      }
    });
    api.render();
  },
  up(e) {
    if (!grad) return;
    grad = null;
    if (e.moved) endGesture('Gradient');
    else cancelGesture();
  },
  dblclick(e, api) {
    const g = gradientOf(api);
    if (!g) return;
    const inv = invert(g.m);
    const p = apply(inv, e.world);
    const f = g.paint.from;
    const t = g.paint.to;
    const dx = t[0] - f[0];
    const dy = t[1] - f[1];
    const u = ((p[0] - f[0]) * dx + (p[1] - f[1]) * dy) / (dx * dx + dy * dy || 1);
    if (u <= 0 || u >= 1) return;
    const sorted = [...g.paint.stops].sort((a, b) => a.offset - b.offset);
    const before = [...sorted].reverse().find((s) => s.offset <= u) ?? sorted[0];
    mutate('Add gradient stop', (d) => {
      const l = locate(d as unknown as CurvsDocument, g.id);
      const it = l?.node.appearance.items[g.item] as Draft<FillItem> | undefined;
      if (it && it.paint.type !== 'solid')
        it.paint.stops.push({ offset: u, color: clone(before.color) } as never);
    });
  },
  overlay(ctx, api) {
    drawSelectionOutlines(ctx, api, api.od.selection, 1);
    const g = gradientOf(api);
    if (!g) return;
    const from = api.toScreen(apply(g.m, g.paint.from));
    const to = api.toScreen(apply(g.m, g.paint.to));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.strokeStyle = OVERLAY.anchorFill;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = OVERLAY.volt;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const s of g.paint.stops) {
      const p: Vec = [from[0] + (to[0] - from[0]) * s.offset, from[1] + (to[1] - from[1]) * s.offset];
      const c = resolveColor(s.color, api.doc.swatches);
      ctx.beginPath();
      ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${c.r * 255}, ${c.g * 255}, ${c.b * 255})`;
      ctx.fill();
      ctx.strokeStyle = OVERLAY.anchorFill;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = OVERLAY.volt;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawAnchor(ctx, from, false);
    drawAnchor(ctx, to, false);
    ctx.restore();
  },
  cancel() {
    if (grad) cancelGesture();
    grad = null;
  },
};

function constrain(a: Vec, p: Vec): Vec {
  const ang = Math.round(Math.atan2(p[1] - a[1], p[0] - a[0]) / (Math.PI / 4)) * (Math.PI / 4);
  const l = Math.hypot(p[0] - a[0], p[1] - a[1]);
  return [a[0] + Math.cos(ang) * l, a[1] + Math.sin(ang) * l];
}

// ---------------------------------------------------------------------------------------------
// Hand and Zoom

let panStart: { panX: number; panY: number } | null = null;

export const handTool: Tool = {
  cursor: 'grab',
  down(_e, api) {
    panStart = { panX: api.view.panX, panY: api.view.panY };
    api.overlay.cursor = 'grabbing';
  },
  move(e, api) {
    if (!e.dragging || !panStart) return;
    setView({
      zoom: api.view.zoom,
      panX: panStart.panX + e.screen[0] - e.downScreen[0],
      panY: panStart.panY + e.screen[1] - e.downScreen[1],
    });
  },
  up(_e, api) {
    panStart = null;
    api.overlay.cursor = null;
  },
};

export const zoomTool: Tool = {
  cursor: 'zoom-in',
  move(e: ToolPointer, api: ToolApi) {
    if (!e.dragging) {
      api.overlay.cursor = e.alt ? 'zoom-out' : null;
      return;
    }
    if (!e.moved) return;
    api.overlay.marquee = {
      x: Math.min(e.downScreen[0], e.screen[0]),
      y: Math.min(e.downScreen[1], e.screen[1]),
      width: Math.abs(e.screen[0] - e.downScreen[0]),
      height: Math.abs(e.screen[1] - e.downScreen[1]),
    };
    api.render();
  },
  up(e, api) {
    const r = api.overlay.marquee;
    api.overlay.marquee = null;
    if (r && r.width > 4 && r.height > 4) {
      const a = api.toWorld([r.x, r.y]);
      const b = api.toWorld([r.x + r.width, r.y + r.height]);
      const rect = api.canvas.getBoundingClientRect();
      setView(
        fitRect({ x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1] }, rect.width, rect.height, 16),
      );
      return;
    }
    setView(zoomAt(api.view, stepZoom(api.view.zoom, e.alt ? -1 : 1), e.screen));
  },
  overlay(ctx, api) {
    if (api.overlay.marquee) drawMarquee(ctx, api.overlay.marquee);
  },
};
