import type { Draft } from 'immer';
import type { CurvsDocument, PathNode, PathShape, Subpath, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, invert } from '../core/matrix';
import { locate, makePath, worldMatrix, clone } from '../core/document';
import { applyAutoHandles } from '../core/geometry/shapes';
import { insertNodeAt, nearestOnSubpath } from '../core/geometry/bezier';
import { drawAnchor, drawHandle, drawOutline, viewMatrix } from '../render/overlay';
import { constrain45, snapAngle } from '../core/snapping';
import {
  beginGesture,
  cancelGesture,
  endGesture,
  getState,
  mutate,
  select,
  updateGesture,
} from '../state/store';
import { targetContainer } from '../state/actions';
import { artboardRelative, fmt, hudXY, newShapeAppearance, PEN_CURSOR } from './common';
import { multiply } from '../core/matrix';

type Drawing = { id: string; sp: number } | null;
let drawing: Drawing = null;
let dragging: { anchorWorld: Vec; space: boolean; spaceOffset: Vec } | null = null;
let hoverClose = false;
let lastCursor: Vec | null = null;
let spaceDown = false;

const asDoc = (d: Draft<CurvsDocument>) => d as unknown as CurvsDocument;

function pathOf(doc: CurvsDocument, id: string) {
  const loc = locate(doc, id);
  return loc && loc.node.type === 'path' ? { node: loc.node as PathShape, m: worldMatrix(loc) } : null;
}

function finish(api: ToolApi) {
  if (drawing) {
    const p = pathOf(api.doc, drawing.id);
    if (p && p.node.subpaths[drawing.sp]?.nodes.length === 1) {
      // A lone anchor is not a useful path.
      mutate('Remove empty path', (d) => {
        const loc = locate(asDoc(d), drawing!.id);
        if (!loc) return;
        const n = loc.node as Draft<PathShape>;
        n.subpaths.splice(drawing!.sp, 1);
        if (!n.subpaths.length) (loc.siblings as unknown[]).splice(loc.index, 1);
      });
    }
  }
  drawing = null;
  dragging = null;
  api.render();
}

function snapWorld(api: ToolApi, p: Vec, from: Vec | null, shift: boolean): Vec {
  if (from && shift) return constrain45(from, p);
  const s = api.snap(p, drawing ? [drawing.id] : []);
  api.overlay.guides = s.guides;
  let q = s.point;
  if (from && getState().snapping.angles && !s.guides.length) {
    const a = Math.atan2(q[1] - from[1], q[0] - from[0]);
    const sa = snapAngle(a, Math.PI / 4, (2 * Math.PI) / 180);
    if (sa !== a) {
      const l = Math.hypot(q[0] - from[0], q[1] - from[1]);
      q = [from[0] + Math.cos(sa) * l, from[1] + Math.sin(sa) * l];
    }
  }
  return q;
}

function lastNodeWorld(api: ToolApi): Vec | null {
  if (!drawing) return null;
  const p = pathOf(api.doc, drawing.id);
  const sp = p?.node.subpaths[drawing.sp];
  if (!p || !sp?.nodes.length) return null;
  const n = sp.nodes[sp.nodes.length - 1];
  return apply(p.m, [n.x, n.y]);
}

function firstNodeScreen(api: ToolApi): Vec | null {
  if (!drawing) return null;
  const p = pathOf(api.doc, drawing.id);
  const sp = p?.node.subpaths[drawing.sp];
  if (!p || !sp || sp.nodes.length < 2) return null;
  return api.toScreen(apply(p.m, [sp.nodes[0].x, sp.nodes[0].y]));
}

/** Open endpoint of a selected path under the cursor, to continue drawing from it. */
function endpointAt(api: ToolApi, screen: Vec): { id: string; sp: number; atStart: boolean } | null {
  for (const id of api.od.selection) {
    const p = pathOf(api.doc, id);
    if (!p) continue;
    for (let spi = 0; spi < p.node.subpaths.length; spi++) {
      const sp = p.node.subpaths[spi];
      if (sp.closed || !sp.nodes.length) continue;
      const ends: [PathNode, boolean][] = [
        [sp.nodes[0], true],
        [sp.nodes[sp.nodes.length - 1], false],
      ];
      for (const [n, atStart] of ends) {
        const s = api.toScreen(apply(p.m, [n.x, n.y]));
        if (Math.hypot(s[0] - screen[0], s[1] - screen[1]) <= 7) return { id, sp: spi, atStart };
      }
    }
  }
  return null;
}

function segmentAt(api: ToolApi, world: Vec) {
  for (const id of api.od.selection) {
    const p = pathOf(api.doc, id);
    if (!p) continue;
    const inv = invert(p.m);
    const local = apply(inv, world);
    for (let spi = 0; spi < p.node.subpaths.length; spi++) {
      const hit = nearestOnSubpath(p.node.subpaths[spi], local);
      if (hit && hit.distance <= api.px(5) * Math.hypot(inv[0], inv[1]))
        return { id, sp: spi, seg: hit.segment, t: hit.t };
    }
  }
  return null;
}

function nodeAt(api: ToolApi, screen: Vec) {
  for (const id of api.od.selection) {
    const p = pathOf(api.doc, id);
    if (!p) continue;
    for (let spi = 0; spi < p.node.subpaths.length; spi++) {
      const sp = p.node.subpaths[spi];
      for (let i = 0; i < sp.nodes.length; i++) {
        const s = api.toScreen(apply(p.m, [sp.nodes[i].x, sp.nodes[i].y]));
        if (Math.hypot(s[0] - screen[0], s[1] - screen[1]) <= 6) return { id, sp: spi, i };
      }
    }
  }
  return null;
}

export const penTool: Tool = {
  cursor: PEN_CURSOR,

  down(e, api) {
    const ui = getState().ui;
    const penMode = ui.penMode;
    if (!drawing) {
      // Hover actions on the selected path: delete a node, add a node, or continue an endpoint.
      const end = endpointAt(api, e.screen);
      if (end) {
        if (end.atStart) {
          mutate('Reverse path', (d) => {
            const loc = locate(asDoc(d), end.id);
            if (!loc) return;
            const sp = (loc.node as Draft<PathShape>).subpaths[end.sp];
            sp.nodes = [...sp.nodes].reverse().map((n) => ({ ...n, in: n.out, out: n.in })) as never;
          });
        }
        drawing = { id: end.id, sp: end.sp };
        return;
      }
      const onNode = nodeAt(api, e.screen);
      if (onNode) {
        mutate('Delete node', (d) => {
          const loc = locate(asDoc(d), onNode.id);
          if (!loc) return;
          const sp = (loc.node as Draft<PathShape>).subpaths[onNode.sp];
          if (sp.nodes.length > 2) sp.nodes.splice(onNode.i, 1);
        });
        return;
      }
      const seg = segmentAt(api, e.world);
      if (seg) {
        mutate('Add node', (d) => {
          const loc = locate(asDoc(d), seg.id);
          if (!loc) return;
          const n = loc.node as Draft<PathShape>;
          n.subpaths[seg.sp] = insertNodeAt(n.subpaths[seg.sp] as Subpath, seg.seg, seg.t) as never;
        });
        return;
      }
    }
    const from = lastNodeWorld(api);
    const world = snapWorld(api, e.world, from, e.shift);
    // Close the path by clicking its first anchor.
    const first = firstNodeScreen(api);
    if (drawing && first && Math.hypot(first[0] - e.screen[0], first[1] - e.screen[1]) <= 7) {
      const dr = drawing;
      beginGesture();
      updateGesture((d) => {
        const loc = locate(asDoc(d), dr.id);
        if (!loc) return;
        (loc.node as Draft<PathShape>).subpaths[dr.sp].closed = true;
      }, true);
      dragging = { anchorWorld: api.toWorld(first), space: false, spaceOffset: [0, 0] };
      hoverClose = true;
      return;
    }
    const kind: PathNode['kind'] = penMode === 'smart' ? 'auto' : 'sharp';
    beginGesture();
    if (!drawing) {
      const path = makePath([], newShapeAppearance(true), 'Path');
      const od = api.od;
      updateGesture((d) => {
        const t = targetContainer(d, api.artboardAt(world), od.isolation);
        const local = apply(invert(t.world), world);
        path.subpaths = [{ closed: false, nodes: [{ x: local[0], y: local[1], in: null, out: null, kind }] }];
        t.list.push(clone(path) as never);
      }, true);
      drawing = { id: path.id, sp: 0 };
      select([path.id]);
    } else {
      const dr = drawing;
      const m = pathOf(api.doc, dr.id)!.m;
      const local = apply(invert(m), world);
      updateGesture((d) => {
        const loc = locate(asDoc(d), dr.id);
        if (!loc) return;
        const n = loc.node as Draft<PathShape>;
        n.subpaths[dr.sp].nodes.push({ x: local[0], y: local[1], in: null, out: null, kind } as never);
        n.subpaths[dr.sp] = applyAutoHandles(n.subpaths[dr.sp] as Subpath) as never;
      }, true);
    }
    dragging = { anchorWorld: world, space: false, spaceOffset: [0, 0] };
  },

  move(e, api) {
    lastCursor = e.world;
    const unit = api.doc.units;
    if (!e.dragging || !dragging) {
      const first = firstNodeScreen(api);
      hoverClose = !!first && Math.hypot(first[0] - e.screen[0], first[1] - e.screen[1]) <= 7;
      const from = lastNodeWorld(api);
      if (from) {
        const p = snapWorld(api, e.world, from, e.shift);
        lastCursor = p;
        const dx = p[0] - from[0];
        const dy = p[1] - from[1];
        api.overlay.hud = {
          at: e.screen,
          lines: [
            hudXY(artboardRelative(api, p), unit),
            `${fmt(Math.hypot(dx, dy), unit)} ${unit} · ${((Math.atan2(-dy, dx) * 180) / Math.PI).toFixed(1)}°`,
          ],
        };
      } else {
        api.overlay.hud = null;
        if (!drawing) {
          const s = api.snap(e.world, []);
          api.overlay.guides = s.guides;
        }
      }
      api.overlay.cursor =
        !drawing && nodeAt(api, e.screen) ? PEN_CURSOR.replace('crosshair', 'not-allowed') : null;
      api.render();
      return;
    }
    if (!drawing) return;
    const penMode = getState().ui.penMode;
    if (penMode === 'polygon' || penMode === 'line') return;
    const dr = drawing;
    const p = pathOf(getState().docs.find((d) => d.key === api.od.key)!.doc, dr.id);
    if (!p) return;
    if (spaceDown) {
      // Space while dragging repositions the anchor.
      if (!dragging.space)
        dragging.spaceOffset = [e.world[0] - dragging.anchorWorld[0], e.world[1] - dragging.anchorWorld[1]];
      dragging.space = true;
      dragging.anchorWorld = [e.world[0] - dragging.spaceOffset[0], e.world[1] - dragging.spaceOffset[1]];
    } else dragging.space = false;
    const inv = invert(p.m);
    const anchor = apply(inv, dragging.anchorWorld);
    let handleWorld = e.world;
    if (e.shift) handleWorld = constrain45(dragging.anchorWorld, e.world);
    const h = apply(inv, handleWorld);
    const closing = hoverClose;
    const breakHandle = e.alt;
    updateGesture((d) => {
      const loc = locate(asDoc(d), dr.id);
      if (!loc) return;
      const path = loc.node as Draft<PathShape>;
      if (!path.subpaths[dr.sp]) return;
      const sp = path.subpaths[dr.sp];
      const node = closing ? sp.nodes[0] : sp.nodes[sp.nodes.length - 1];
      if (!node) return;
      if (!closing) {
        node.x = anchor[0];
        node.y = anchor[1];
      }
      const out: Vec = [h[0], h[1]];
      const mirrored: Vec = [2 * node.x - h[0], 2 * node.y - h[1]];
      if (closing) node.in = mirrored;
      else {
        node.out = out;
        if (!breakHandle) node.in = mirrored;
      }
      node.kind = breakHandle ? 'sharp' : 'symmetric';
    });
    const dx = handleWorld[0] - dragging.anchorWorld[0];
    const dy = handleWorld[1] - dragging.anchorWorld[1];
    api.overlay.hud = {
      at: e.screen,
      lines: [
        hudXY(artboardRelative(api, dragging.anchorWorld), unit),
        `Handle ${fmt(Math.hypot(dx, dy), unit)} ${unit} · ${((Math.atan2(-dy, dx) * 180) / Math.PI).toFixed(1)}°`,
      ],
    };
    api.render();
  },

  up(_e, api) {
    if (!dragging) return;
    dragging = null;
    api.overlay.guides = [];
    endGesture('Pen');
    const penMode = getState().ui.penMode;
    if (hoverClose) {
      hoverClose = false;
      drawing = null;
    } else if (penMode === 'line' && drawing) {
      const p = pathOf(api.doc, drawing.id);
      if (p && p.node.subpaths[drawing.sp]?.nodes.length >= 2) drawing = null;
    }
    api.render();
  },

  key(e, api) {
    if (e.key === ' ') {
      spaceDown = e.type === 'keydown';
      return !!dragging;
    }
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (dragging) {
        cancelGesture();
        dragging = null;
      }
      if (drawing) {
        finish(api);
        return true;
      }
      return false;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && drawing) {
      const dr = drawing;
      mutate('Remove last node', (d) => {
        const loc = locate(asDoc(d), dr.id);
        if (!loc) return;
        const sp = (loc.node as Draft<PathShape>).subpaths[dr.sp];
        sp.nodes.pop();
        if (sp.nodes.length) sp.nodes[sp.nodes.length - 1].out = null;
      });
      const p = pathOf(getState().docs.find((d) => d.key === api.od.key)!.doc, dr.id);
      if (!p || !p.node.subpaths[dr.sp]?.nodes.length) drawing = null;
      return true;
    }
    return false;
  },

  keyUp(e) {
    if (e.key === ' ') {
      spaceDown = false;
      return !!dragging;
    }
    return false;
  },

  overlay(ctx, api) {
    const vm = viewMatrix(api.view);
    for (const id of api.od.selection) {
      const p = pathOf(api.doc, id);
      if (!p) continue;
      drawOutline(ctx, p.node.subpaths, p.m, api.view);
      const m = multiply(vm, p.m);
      p.node.subpaths.forEach((sp, spi) => {
        const active = drawing?.id === id && drawing.sp === spi;
        if (active && sp.nodes.length) {
          const last = sp.nodes[sp.nodes.length - 1];
          const lp = apply(m, [last.x, last.y]);
          if (last.in) drawHandle(ctx, lp, apply(m, last.in));
          if (last.out) drawHandle(ctx, lp, apply(m, last.out));
        }
        sp.nodes.forEach((n, i) =>
          drawAnchor(
            ctx,
            apply(m, [n.x, n.y]),
            active && (i === sp.nodes.length - 1 || (hoverClose && i === 0)),
            n.kind !== 'sharp',
          ),
        );
      });
    }
    // Rubber band from the last node to the cursor.
    if (drawing && !dragging && lastCursor) {
      const p = pathOf(api.doc, drawing.id);
      const sp = p?.node.subpaths[drawing.sp];
      if (p && sp?.nodes.length) {
        const last = sp.nodes[sp.nodes.length - 1];
        const m = multiply(vm, p.m);
        const a = apply(m, [last.x, last.y]);
        const c1 = last.out ? apply(m, last.out) : a;
        const b = api.toScreen(lastCursor);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.bezierCurveTo(c1[0], c1[1], b[0], b[1], b[0], b[1]);
        ctx.strokeStyle = 'rgba(22, 199, 91, 0.85)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  },

  cancel(api) {
    if (dragging) cancelGesture();
    dragging = null;
    if (drawing) finish(api);
  },
};

export const penState = () => ({ drawing: !!drawing });
