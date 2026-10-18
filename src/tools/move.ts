import type { CurvsDocument, Matrix, SceneNode, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, invert, multiply, translate } from '../core/matrix';
import { applyWorldDelta, rotateAbout, selectionBounds, selectionBox } from '../core/transform';
import { hitTest, marqueeSelect } from '../render/hittest';
import { boxHandles, type BoxHandle, drawBox, viewMatrix } from '../render/overlay';
import { snapAngle, snapRect } from '../core/snapping';
import {
  beginGesture,
  cancelGesture,
  endGesture,
  getState,
  select,
  setState,
  setTool,
  updateDoc,
  updateGesture,
} from '../state/store';
import { locate, reId } from '../core/document';
import { newId } from '../core/id';
import type { Rect } from '../core/geometry/bezier';
import {
  drawHover,
  drawSelectionOutlines,
  fmt,
  hudXY,
  artboardRelative,
  resizeCursor,
  ROTATE_CURSOR,
} from './common';
import { enterGroup } from '../state/actions';
import {
  beginShapeWidget,
  dragShapeWidget,
  drawShapeWidgets,
  endShapeWidget,
  shapeWidgetAt,
} from './shapeHandles';
import type { Draft } from 'immer';

type Mode =
  | { kind: 'idle' }
  | { kind: 'move'; ids: string[]; base: Rect | null; originals: string[] | null }
  | { kind: 'scale'; ids: string[]; box: Matrix; handle: BoxHandle; rotation: number }
  | { kind: 'rotate'; ids: string[]; center: Vec; start: number }
  | { kind: 'marquee'; additive: boolean }
  | { kind: 'widget' };

let mode: Mode = { kind: 'idle' };

function findHandle(
  api: ToolApi,
  screen: Vec,
): { handle: BoxHandle; box: Matrix; rotation: number } | 'rotate' | null {
  const sel = api.od.selection;
  if (!sel.length) return null;
  const box = selectionBox(api.doc, sel);
  if (!box) return null;
  const sm = multiply(viewMatrix(api.view), box.matrix);
  const handles = boxHandles(sm);
  for (const h of handles)
    if (Math.hypot(h.p[0] - screen[0], h.p[1] - screen[1]) <= 7)
      return { handle: h, box: box.matrix, rotation: box.rotation };
  // Rotation zones just outside the corners (CorelDRAW/Affinity style).
  for (const h of handles) {
    if (h.id.length !== 2) continue;
    const d = Math.hypot(h.p[0] - screen[0], h.p[1] - screen[1]);
    if (d > 7 && d <= 22) {
      const inv = invert(sm);
      const u = apply(inv, screen);
      if (u[0] < -0.0001 || u[0] > 1.0001 || u[1] < -0.0001 || u[1] > 1.0001) return 'rotate';
    }
  }
  return null;
}

export const moveTool: Tool = {
  down(e, api) {
    const widget = shapeWidgetAt(api, e.screen);
    if (widget) {
      beginShapeWidget(api, widget);
      mode = { kind: 'widget' };
      return;
    }
    const h = findHandle(api, e.screen);
    const sel = api.od.selection;
    if (h === 'rotate') {
      const b = selectionBounds(api.doc, sel)!;
      const center: Vec = [b.x + b.width / 2, b.y + b.height / 2];
      mode = {
        kind: 'rotate',
        ids: sel,
        center,
        start: Math.atan2(e.world[1] - center[1], e.world[0] - center[0]),
      };
      beginGesture();
      return;
    }
    if (h) {
      mode = { kind: 'scale', ids: sel, box: h.box, handle: h.handle, rotation: h.rotation };
      beginGesture();
      return;
    }
    const hit = hitTest(api.doc, e.world, api.px(4), { deep: e.mod, isolation: api.od.isolation });
    if (!hit) {
      if (!e.shift) select([]);
      mode = { kind: 'marquee', additive: e.shift };
      return;
    }
    if (e.shift) {
      const ids = sel.includes(hit.node.id) ? sel.filter((x) => x !== hit.node.id) : [...sel, hit.node.id];
      select(ids);
      if (!ids.includes(hit.node.id)) {
        mode = { kind: 'idle' };
        return;
      }
    } else if (!sel.includes(hit.node.id)) {
      select([hit.node.id]);
    }
    const od = getState().docs.find((d) => d.key === api.od.key)!;
    mode = { kind: 'move', ids: od.selection, base: selectionBounds(od.doc, od.selection), originals: null };
    beginGesture();
  },

  move(e, api) {
    if (!e.dragging) {
      const h = findHandle(api, e.screen);
      if (shapeWidgetAt(api, e.screen)) api.overlay.cursor = 'pointer';
      else if (h === 'rotate') api.overlay.cursor = ROTATE_CURSOR;
      else if (h) api.overlay.cursor = resizeCursor(h.handle.id, h.rotation);
      else api.overlay.cursor = null;
      const hit = hitTest(api.doc, e.world, api.px(4), { deep: e.mod, isolation: api.od.isolation });
      if ((hit?.node.id ?? null) !== api.overlay.hoverId) {
        api.overlay.hoverId = hit?.node.id ?? null;
        api.render();
      }
      return;
    }
    if (!e.moved) return;
    const unit = api.doc.units;
    if (mode.kind === 'widget') dragShapeWidget(e, api);
    else if (mode.kind === 'move') {
      if (e.alt && !mode.originals) {
        // ⌥-drag: the originals stay put and fresh copies move.
        mode = { ...mode, originals: mode.ids, ids: mode.ids.map(() => newId('nd')) };
      }
      let dx = e.world[0] - e.downWorld[0];
      let dy = e.world[1] - e.downWorld[1];
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      api.overlay.guides = [];
      if (mode.base) {
        const moved = { ...mode.base, x: mode.base.x + dx, y: mode.base.y + dy };
        const s = getState().snapping;
        if (s.objects || s.guides) {
          const snap = snapRect(moved, api.snapCandidates(mode.ids), api.px(6));
          if (!e.shift || dx !== 0) dx += snap.dx;
          if (!e.shift || dy !== 0) dy += snap.dy;
          api.overlay.guides = snap.guides;
        }
        if (s.pixel) {
          dx = Math.round(mode.base.x + dx) - mode.base.x;
          dy = Math.round(mode.base.y + dy) - mode.base.y;
        }
      }
      const ids = mode.ids;
      const originals = mode.originals;
      updateGesture((d) => {
        if (originals) {
          originals.forEach((id, i) => {
            const loc = locate(d as unknown as CurvsDocument, id);
            if (!loc) return;
            const copy = { ...reId(loc.node as SceneNode), id: ids[i] };
            (loc.siblings as Draft<SceneNode>[]).splice(loc.index + 1, 0, copy as Draft<SceneNode>);
          });
        }
        applyWorldDelta(d as unknown as CurvsDocument, ids, translate(dx, dy));
      });
      const p = mode.base ? artboardRelative(api, [mode.base.x + dx, mode.base.y + dy]) : e.world;
      api.overlay.hud = { at: e.screen, lines: [hudXY(p, unit), `Δ ${fmt(dx, unit)}, ${fmt(dy, unit)}`] };
      updateDoc(api.od.key, { lastTransform: translate(dx, dy) });
    } else if (mode.kind === 'scale') {
      const { box, handle } = mode;
      const inv = invert(box);
      const u = apply(inv, e.world);
      const fromCenter = e.alt;
      const anchor: Vec = fromCenter ? [0.5, 0.5] : [1 - handle.u[0], 1 - handle.u[1]];
      let sx = handle.u[0] === 0.5 ? 1 : (u[0] - anchor[0]) / (handle.u[0] - anchor[0]);
      let sy = handle.u[1] === 0.5 ? 1 : (u[1] - anchor[1]) / (handle.u[1] - anchor[1]);
      const corner = handle.u[0] !== 0.5 && handle.u[1] !== 0.5;
      if (e.shift) {
        if (corner) {
          const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
          sx = Math.sign(sx || 1) * Math.abs(s);
          sy = Math.sign(sy || 1) * Math.abs(s);
        } else if (handle.u[0] === 0.5) sx = Math.abs(sy);
        else sy = Math.abs(sx);
      }
      if (!Number.isFinite(sx) || Math.abs(sx) < 1e-4) sx = 1e-4;
      if (!Number.isFinite(sy) || Math.abs(sy) < 1e-4) sy = 1e-4;
      const inBox: Matrix = multiply(
        translate(anchor[0], anchor[1]),
        multiply([sx, 0, 0, sy, 0, 0], translate(-anchor[0], -anchor[1])),
      );
      const delta = multiply(box, multiply(inBox, inv));
      const ids = mode.ids;
      updateGesture((d) => applyWorldDelta(d as unknown as CurvsDocument, ids, delta));
      const w = Math.hypot(box[0], box[1]) * Math.abs(sx);
      const h = Math.hypot(box[2], box[3]) * Math.abs(sy);
      api.overlay.hud = {
        at: e.screen,
        lines: [hudXY(artboardRelative(api, e.world), unit), `${fmt(w, unit)} × ${fmt(h, unit)} ${unit}`],
      };
      updateDoc(api.od.key, { lastTransform: delta });
    } else if (mode.kind === 'rotate') {
      const { center } = mode;
      let a = Math.atan2(e.world[1] - center[1], e.world[0] - center[0]) - mode.start;
      if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      else if (getState().snapping.angles) a = snapAngle(a);
      const delta = rotateAbout(a, center[0], center[1]);
      const ids = mode.ids;
      updateGesture((d) => applyWorldDelta(d as unknown as CurvsDocument, ids, delta));
      let deg = ((a * 180) / Math.PI) % 360;
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      api.overlay.hud = {
        at: e.screen,
        lines: [hudXY(artboardRelative(api, e.world), unit), `∠ ${deg.toFixed(1)}°`],
      };
      updateDoc(api.od.key, { lastTransform: delta });
    } else if (mode.kind === 'marquee') {
      const x = Math.min(e.downScreen[0], e.screen[0]);
      const y = Math.min(e.downScreen[1], e.screen[1]);
      api.overlay.marquee = {
        x,
        y,
        width: Math.abs(e.screen[0] - e.downScreen[0]),
        height: Math.abs(e.screen[1] - e.downScreen[1]),
      };
    }
    api.render();
  },

  up(e, api) {
    const m = mode;
    mode = { kind: 'idle' };
    api.overlay.guides = [];
    api.overlay.hud = null;
    if (m.kind === 'widget') endShapeWidget(api);
    else if (m.kind === 'marquee') {
      const r = api.overlay.marquee;
      api.overlay.marquee = null;
      if (r && r.width > 2 && r.height > 2) {
        const a = api.toWorld([r.x, r.y]);
        const b = api.toWorld([r.x + r.width, r.y + r.height]);
        const ids = marqueeSelect(
          api.doc,
          { x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1] },
          api.od.isolation,
        );
        select(m.additive ? [...new Set([...api.od.selection, ...ids])] : ids);
      }
    } else if (m.kind === 'move') {
      if (e.moved) endGesture(m.originals ? 'Duplicate' : 'Move', m.ids);
      else cancelGesture();
    } else if (m.kind === 'scale') endGesture('Scale');
    else if (m.kind === 'rotate') endGesture('Rotate');
    api.render();
  },

  dblclick(e, api) {
    const hit = hitTest(api.doc, e.world, api.px(4), { isolation: api.od.isolation });
    if (!hit) {
      if (api.od.isolation) {
        updateDoc(api.od.key, { isolation: null });
      }
      return;
    }
    const n = hit.node;
    if (n.type === 'group' || n.type === 'boolean' || n.type === 'clipGroup') {
      enterGroup(n.id);
      const inner = hitTest(getState().docs.find((d) => d.key === api.od.key)!.doc, e.world, api.px(4), {
        isolation: n.id,
      });
      if (inner) select([inner.node.id]);
      return;
    }
    if (n.type === 'text') {
      select([n.id]);
      setState({ editingText: n.id });
      return;
    }
    if (n.type === 'path' || n.type === 'rect' || n.type === 'ellipse' || n.type === 'star') {
      select([n.id]);
      setTool('node');
    }
  },

  key(e, api) {
    if (e.key === 'Escape' && mode.kind !== 'idle') {
      cancelGesture();
      mode = { kind: 'idle' };
      api.overlay.marquee = null;
      api.overlay.hud = null;
      api.overlay.guides = [];
      api.render();
      return true;
    }
    return false;
  },

  overlay(ctx, api) {
    drawHover(ctx, api);
    const sel = api.od.selection;
    if (!sel.length) return;
    drawSelectionOutlines(ctx, api, sel, 1);
    const box = selectionBox(api.doc, sel);
    if (!box) return;
    const singleLocked = sel.length === 1 && locate(api.doc, sel[0])?.node.locked;
    drawBox(ctx, multiply(viewMatrix(api.view), box.matrix), !singleLocked && mode.kind !== 'move');
    if (mode.kind !== 'move') drawShapeWidgets(ctx, api);
  },

  cancel(api) {
    if (mode.kind !== 'idle') cancelGesture();
    mode = { kind: 'idle' };
    api.overlay.marquee = null;
  },
};
