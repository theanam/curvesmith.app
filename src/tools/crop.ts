/* On-canvas crop for an image. Not a toolbar tool: the canvas routes input here while
   `croppingImage` is set (double-click an image, or Crop in the inspector). */
import type { CurvsDocument, ImageNode, Matrix, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, invert, multiply, translate } from '../core/matrix';
import { locate, worldMatrix } from '../core/document';
import { bitmapRect, panBitmap, reframe, resizeFrame, type ImageSize } from '../core/image';
import { naturalSize } from '../state/crop';
import { boxHandles, type BoxHandle, drawBox, OVERLAY, viewMatrix } from '../render/overlay';
import { getImage } from '../render/paint';
import { beginGesture, cancelGesture, endGesture, getState, setState, updateGesture } from '../state/store';
import { fmt, resizeCursor } from './common';
import { TOOL_IMPLS } from './index';

type Box = { x: number; y: number; width: number; height: number };
type Target = { node: ImageNode; world: Matrix; natural: ImageSize; frame: Box; bitmap: Box };
type Mode =
  | { kind: 'idle' }
  | { kind: 'resize'; t: Target; u: [number, number] }
  | { kind: 'pan'; t: Target; from: Vec };

let mode: Mode = { kind: 'idle' };

function target(api: ToolApi): Target | null {
  const id = getState().croppingImage;
  const loc = id ? locate(api.doc, id) : null;
  if (!loc || loc.node.type !== 'image') return null;
  const node = loc.node;
  const src = api.doc.assets[node.asset];
  const natural = src ? naturalSize(src) : null;
  if (!natural) return null;
  const frame = { x: 0, y: 0, width: node.width, height: node.height };
  return { node, world: worldMatrix(loc), natural, frame, bitmap: bitmapRect(node, natural) };
}

const toScreen = (api: ToolApi, t: Target) => multiply(viewMatrix(api.view), t.world);
const unitBox = (b: Box): Matrix => [b.width, 0, 0, b.height, b.x, b.y];
const inside = (b: Box, p: Vec) =>
  p[0] >= b.x && p[0] <= b.x + b.width && p[1] >= b.y && p[1] <= b.y + b.height;
const rotationOf = (m: Matrix) => Math.atan2(m[1], m[0]);

const EDGES: { id: BoxHandle['id']; u: [number, number]; from: Vec; to: Vec }[] = [
  { id: 'n', u: [0.5, 0], from: [0, 0], to: [1, 0] },
  { id: 'e', u: [1, 0.5], from: [1, 0], to: [1, 1] },
  { id: 's', u: [0.5, 1], from: [0, 1], to: [1, 1] },
  { id: 'w', u: [0, 0.5], from: [0, 0], to: [0, 1] },
];

function segmentDistance(p: Vec, a: Vec, b: Vec) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}

/** The frame handle, or else the frame edge, under a screen point. */
function handleAt(api: ToolApi, t: Target, screen: Vec): { id: BoxHandle['id']; u: [number, number] } | null {
  const m = multiply(toScreen(api, t), unitBox(t.frame));
  for (const h of boxHandles(m))
    if (Math.hypot(h.p[0] - screen[0], h.p[1] - screen[1]) <= 7)
      return { id: h.id, u: h.u as [number, number] };
  for (const e of EDGES) if (segmentDistance(screen, apply(m, e.from), apply(m, e.to)) <= 5) return e;
  return null;
}

/** Leave crop editing, keeping the crop. */
function finish() {
  if (mode.kind !== 'idle') cancelGesture();
  mode = { kind: 'idle' };
  setState({ croppingImage: null });
}

function commit(t: Target, frame: Box, bitmap: Box) {
  const r = reframe(frame, bitmap, t.natural);
  const id = t.node.id;
  updateGesture((d) => {
    const n = locate(d as unknown as CurvsDocument, id)?.node as ImageNode | undefined;
    if (!n) return;
    n.transform = multiply(t.node.transform, translate(r.offset[0], r.offset[1]));
    n.width = r.width;
    n.height = r.height;
    if (r.crop) n.crop = r.crop;
    else delete n.crop;
  });
}

export const cropTool: Tool = {
  down(e, api) {
    const t = target(api);
    if (!t) return finish();
    const h = handleAt(api, t, e.screen);
    const local = apply(invert(t.world), e.world);
    if (h) {
      mode = { kind: 'resize', t, u: h.u };
      beginGesture();
    } else if (inside(t.bitmap, local)) {
      mode = { kind: 'pan', t, from: local };
      beginGesture();
    } else {
      // A click away from the image finishes the crop and goes to the current tool.
      finish();
      TOOL_IMPLS[getState().tool].down?.(e, api);
    }
  },

  move(e, api) {
    if (!e.dragging || mode.kind === 'idle') {
      const t = target(api);
      if (!t) return;
      const h = handleAt(api, t, e.screen);
      const local = apply(invert(t.world), e.world);
      api.overlay.cursor = h
        ? resizeCursor(h.id, rotationOf(t.world))
        : inside(t.bitmap, local)
          ? 'move'
          : null;
      return;
    }
    if (!e.moved) return;
    const { t } = mode;
    const local = apply(invert(t.world), e.world);
    if (mode.kind === 'resize') {
      const scale = Math.sqrt(Math.abs(t.world[0] * t.world[3] - t.world[1] * t.world[2])) || 1;
      const frame = resizeFrame(t.frame, t.bitmap, mode.u, local, api.px(8) / scale, e.shift);
      commit(t, frame, t.bitmap);
      const unit = api.doc.units;
      api.overlay.hud = {
        at: e.screen,
        lines: [`${fmt(frame.width, unit)} × ${fmt(frame.height, unit)} ${unit}`],
      };
    } else {
      const bitmap = panBitmap(t.frame, t.bitmap, local[0] - mode.from[0], local[1] - mode.from[1]);
      commit(t, t.frame, bitmap);
    }
    api.render();
  },

  up(e, api) {
    const m = mode;
    mode = { kind: 'idle' };
    api.overlay.hud = null;
    if (m.kind === 'idle') return;
    if (e.moved) endGesture('Crop image');
    else cancelGesture();
    api.render();
  },

  dblclick() {
    finish();
  },

  key(e, api) {
    if (e.key === 'Escape' && mode.kind !== 'idle') {
      cancelGesture();
      mode = { kind: 'idle' };
      api.overlay.hud = null;
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Escape') {
      finish();
      return true;
    }
    return false;
  },

  overlay(ctx, api) {
    const t = target(api);
    if (!t) return;
    const m = toScreen(api, t);
    const { frame, bitmap } = t;
    // The cropped-away part of the bitmap, dimmed, around the frame.
    const src = api.doc.assets[t.node.asset];
    const img = src ? getImage(src, () => api.render()) : null;
    if (img) {
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.beginPath();
      ctx.rect(bitmap.x, bitmap.y, bitmap.width, bitmap.height);
      ctx.rect(frame.x, frame.y, frame.width, frame.height);
      ctx.clip('evenodd');
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, bitmap.x, bitmap.y, bitmap.width, bitmap.height);
      ctx.restore();
    }
    const corners = (b: Box) =>
      (
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as Vec[]
      ).map((p) => apply(multiply(m, unitBox(b)), p));
    ctx.save();
    ctx.beginPath();
    corners(bitmap).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.setLineDash(OVERLAY.dash);
    ctx.strokeStyle = OVERLAY.volt;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (mode.kind !== 'idle') {
      // Rule-of-thirds lines while adjusting.
      const fm = multiply(m, unitBox(frame));
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (const k of [1 / 3, 2 / 3]) {
        const [a, b, c, d] = [apply(fm, [k, 0]), apply(fm, [k, 1]), apply(fm, [0, k]), apply(fm, [1, k])];
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
      }
      ctx.stroke();
    }
    ctx.restore();
    drawBox(ctx, multiply(m, unitBox(frame)));
  },

  cancel() {
    if (mode.kind !== 'idle') cancelGesture();
    mode = { kind: 'idle' };
  },
};
