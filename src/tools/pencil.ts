import type { Draft } from 'immer';
import type { CurvsDocument, PathShape, Subpath, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, invert } from '../core/matrix';
import { locate, makePath, worldMatrix, clone } from '../core/document';
import { fitCurve, smoothPoints } from '../core/geometry/fit';
import { getState, mutate } from '../state/store';
import { targetContainer } from '../state/actions';
import { newShapeAppearance } from './common';
import { OVERLAY } from '../render/overlay';

let points: Vec[] = [];
let continueFrom: { id: string; sp: number; atStart: boolean } | null = null;

function endpointNear(api: ToolApi, world: Vec) {
  for (const id of api.od.selection) {
    const loc = locate(api.doc, id);
    if (!loc || loc.node.type !== 'path') continue;
    const m = worldMatrix(loc);
    const subs = loc.node.subpaths;
    for (let sp = 0; sp < subs.length; sp++) {
      const s = subs[sp];
      if (s.closed || s.nodes.length < 2) continue;
      for (const atStart of [true, false]) {
        const n = atStart ? s.nodes[0] : s.nodes[s.nodes.length - 1];
        const p = apply(m, [n.x, n.y]);
        if (Math.hypot(p[0] - world[0], p[1] - world[1]) <= api.px(8)) return { id, sp, atStart };
      }
    }
  }
  return null;
}

export const pencilTool: Tool = {
  cursor: 'crosshair',
  down(e, api) {
    points = [e.world];
    continueFrom = endpointNear(api, e.world);
  },
  move(e, api) {
    if (!e.dragging) return;
    points.push(e.world);
    api.render();
  },
  up(_e, api) {
    const pts = points;
    points = [];
    if (pts.length < 2) return;
    const smoothing = getState().ui.pencilSmoothing;
    const closeIt =
      Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= api.px(8) &&
      pts.length > 8;
    const error = api.px(1 + smoothing * 6);
    const smoothed = smoothPoints(pts, smoothing);
    const cont = continueFrom;
    continueFrom = null;
    if (cont) {
      const loc = locate(api.doc, cont.id)!;
      const inv = invert(worldMatrix(loc));
      const fitted = fitCurve(
        smoothed.map((p) => apply(inv, p)),
        error / Math.max(1e-6, Math.hypot(worldMatrix(loc)[0], worldMatrix(loc)[1])),
      );
      mutate('Pencil', (d) => {
        const l = locate(d as unknown as CurvsDocument, cont.id);
        if (!l) return;
        const sp = (l.node as Draft<PathShape>).subpaths[cont.sp];
        const add = fitted.nodes.map((n) => ({ ...n }));
        if (cont.atStart) {
          const rev = add.reverse().map((n) => ({ ...n, in: n.out, out: n.in }));
          // The last reversed node sits on the old start point; keep its incoming handle there.
          const joint = rev.pop();
          if (joint) sp.nodes[0].in = joint.in as never;
          sp.nodes.unshift(...(rev as never[]));
        } else {
          const first = add.shift();
          if (first) sp.nodes[sp.nodes.length - 1].out = first.out as never;
          sp.nodes.push(...(add as never[]));
        }
      });
      return;
    }
    const od = api.od;
    const path = makePath([], newShapeAppearance(!closeIt), 'Pencil stroke');
    mutate(
      'Pencil',
      (d) => {
        const t = targetContainer(d, api.artboardAt(pts[0]), od.isolation);
        const inv = invert(t.world);
        const sp: Subpath = fitCurve(
          smoothed.map((p) => apply(inv, p)),
          error,
          closeIt,
        );
        const n = clone(path);
        n.subpaths = [sp];
        t.list.push(n as never);
      },
      [path.id],
    );
  },
  overlay(ctx, api) {
    if (points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = api.toScreen(p);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    });
    ctx.strokeStyle = OVERLAY.volt;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  },
  cancel() {
    points = [];
  },
};
