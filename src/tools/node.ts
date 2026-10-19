import type { Draft } from 'immer';
import type { CurvsDocument, Matrix, PathShape, SceneNode, Subpath, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, applyVector, invert, multiply } from '../core/matrix';
import { locate, worldMatrix, clone } from '../core/document';
import { nodeSubpaths } from '../core/geometry/node';
import { insertNodeAt, nearestOnSubpath, segmentBetween } from '../core/geometry/bezier';
import { applyAutoHandles } from '../core/geometry/shapes';
import { hitTest } from '../render/hittest';
import { drawAnchor, drawHandle, drawOutline, viewMatrix } from '../render/overlay';
import { snapPoint, type SnapCandidates } from '../core/snapping';
import {
  beginGesture,
  cancelGesture,
  endGesture,
  getState,
  mutate,
  type NodeSelection,
  select,
  setNodeSelection,
  updateGesture,
} from '../state/store';
import { artboardRelative, drawHover, fmt, hudXY } from './common';

const isShape = (n: SceneNode) =>
  n.type === 'path' || n.type === 'rect' || n.type === 'ellipse' || n.type === 'star' || n.type === 'shape';

type Target =
  | { kind: 'node'; id: string; sp: number; i: number }
  | { kind: 'handle'; id: string; sp: number; i: number; which: 'in' | 'out' }
  | { kind: 'segment'; id: string; sp: number; seg: number; t: number };

type Mode =
  | { kind: 'idle' }
  | { kind: 'nodes'; nodes: NodeSelection[]; ids: string[] }
  | { kind: 'handle'; target: Extract<Target, { kind: 'handle' }>; breakHandle: boolean }
  | { kind: 'segment'; target: Extract<Target, { kind: 'segment' }> }
  | { kind: 'marquee'; additive: boolean };

let mode: Mode = { kind: 'idle' };

/** Converts a parametric shape into a path in place (draft), keeping its look. */
function ensurePath(d: Draft<CurvsDocument>, id: string): Draft<PathShape> | null {
  const loc = locate(d as unknown as CurvsDocument, id);
  if (!loc) return null;
  const n = loc.node as Draft<SceneNode>;
  if (n.type === 'path') return n as Draft<PathShape>;
  if (n.type !== 'rect' && n.type !== 'ellipse' && n.type !== 'star' && n.type !== 'shape') return null;
  const subpaths = nodeSubpaths(n as SceneNode).map((sp) => clone(sp));

  const p = n as unknown as Record<string, unknown>;
  for (const k of [
    'kind',
    'params',
    'width',
    'height',
    'corners',
    'rx',
    'ry',
    'arcStart',
    'arcEnd',
    'pie',
    'points',
    'outerRadius',
    'innerRatio',
    'rounding',
    'polygon',
  ])
    delete p[k];
  const holes = n.type === 'shape';
  p.type = 'path';
  p.subpaths = subpaths;
  p.fillRule = holes ? 'evenodd' : 'nonzero';
  return n as unknown as Draft<PathShape>;
}

function editable(api: ToolApi): { id: string; m: Matrix; subpaths: Subpath[] }[] {
  const out: { id: string; m: Matrix; subpaths: Subpath[] }[] = [];
  for (const id of api.od.selection) {
    const loc = locate(api.doc, id);
    if (!loc || !isShape(loc.node)) continue;
    out.push({ id, m: worldMatrix(loc), subpaths: nodeSubpaths(loc.node, api.doc) });
  }
  return out;
}

function findTarget(api: ToolApi, screen: Vec): Target | null {
  const vm = viewMatrix(api.view);
  const sel = api.od.nodeSelection;
  const showAll = getState().ui.showAllHandles;
  let best: { t: Target; d: number } | null = null;
  const consider = (t: Target, p: Vec, r: number) => {
    const d = Math.hypot(p[0] - screen[0], p[1] - screen[1]);
    if (d <= r && (!best || d < best.d)) best = { t, d };
  };
  for (const e of editable(api)) {
    const m = multiply(vm, e.m);
    e.subpaths.forEach((sp, spi) =>
      sp.nodes.forEach((n, i) => {
        consider({ kind: 'node', id: e.id, sp: spi, i }, apply(m, [n.x, n.y]), 7);
        const visible = showAll || sel.some((s) => s.id === e.id && s.sp === spi && Math.abs(s.i - i) <= 1);
        if (visible && n.in)
          consider({ kind: 'handle', id: e.id, sp: spi, i, which: 'in' }, apply(m, n.in), 6);
        if (visible && n.out)
          consider({ kind: 'handle', id: e.id, sp: spi, i, which: 'out' }, apply(m, n.out), 6);
      }),
    );
  }
  if (best) return (best as { t: Target }).t;
  for (const e of editable(api)) {
    const inv = invert(e.m);
    const local = apply(inv, api.toWorld(screen));
    const scale = Math.hypot(inv[0], inv[1]);
    for (let spi = 0; spi < e.subpaths.length; spi++) {
      const hit = nearestOnSubpath(e.subpaths[spi], local);
      if (hit && hit.distance <= api.px(5) * scale)
        return { kind: 'segment', id: e.id, sp: spi, seg: hit.segment, t: hit.t };
    }
  }
  return null;
}

/** Other nodes of the edited paths (world space) as snap lines, for "n nodes aligned" guides. */
function nodeCandidates(api: ToolApi, moving: NodeSelection[]): SnapCandidates {
  const c = api.snapCandidates([], false);
  const s = getState().snapping;
  if (!s.nodes) return c;
  for (const e of editable(api)) {
    e.subpaths.forEach((sp, spi) =>
      sp.nodes.forEach((n, i) => {
        if (moving.some((m) => m.id === e.id && m.sp === spi && m.i === i)) return;
        const p = apply(e.m, [n.x, n.y]);
        c.xs.push({ pos: p[0], kind: 'node', span: [p[1], p[1]] });
        c.ys.push({ pos: p[1], kind: 'node', span: [p[0], p[0]] });
      }),
    );
  }
  return c;
}

function moveNodesRecipe(nodes: NodeSelection[], worldDelta: Vec, base: CurvsDocument) {
  return (d: Draft<CurvsDocument>) => {
    const byId = new Map<string, NodeSelection[]>();
    for (const n of nodes) byId.set(n.id, [...(byId.get(n.id) ?? []), n]);
    for (const [id, list] of byId) {
      const loc = locate(base, id);
      if (!loc) continue;
      const local = applyVector(invert(worldMatrix(loc)), worldDelta);
      const p = ensurePath(d, id);
      if (!p) continue;
      for (const s of list) {
        const node = p.subpaths[s.sp]?.nodes[s.i];
        if (!node) continue;
        node.x += local[0];
        node.y += local[1];
        if (node.in) node.in = [node.in[0] + local[0], node.in[1] + local[1]];
        if (node.out) node.out = [node.out[0] + local[0], node.out[1] + local[1]];
      }
      p.subpaths = p.subpaths.map((sp) => applyAutoHandles(sp as Subpath)) as never;
    }
  };
}

export const nodeTool: Tool = {
  down(e, api) {
    const t = findTarget(api, e.screen);
    const sel = api.od.nodeSelection;
    if (t?.kind === 'node') {
      const already = sel.some((s) => s.id === t.id && s.sp === t.sp && s.i === t.i);
      let next = sel;
      if (e.shift)
        next = already
          ? sel.filter((s) => !(s.id === t.id && s.sp === t.sp && s.i === t.i))
          : [...sel, { id: t.id, sp: t.sp, i: t.i }];
      else if (!already) next = [{ id: t.id, sp: t.sp, i: t.i }];
      setNodeSelection(next);
      mode = { kind: 'nodes', nodes: next, ids: [...new Set(next.map((n) => n.id))] };
      beginGesture();
      return;
    }
    if (t?.kind === 'handle') {
      mode = { kind: 'handle', target: t, breakHandle: e.alt };
      beginGesture();
      return;
    }
    if (t?.kind === 'segment') {
      mode = { kind: 'segment', target: t };
      beginGesture();
      return;
    }
    const hit = hitTest(api.doc, e.world, api.px(4), { deep: true, isolation: api.od.isolation });
    if (hit && isShape(hit.node)) {
      select(e.shift ? [...new Set([...api.od.selection, hit.node.id])] : [hit.node.id]);
      mode = { kind: 'idle' };
      return;
    }
    if (!e.shift) setNodeSelection([]);
    mode = { kind: 'marquee', additive: e.shift };
  },

  move(e, api) {
    if (!e.dragging) {
      const t = findTarget(api, e.screen);
      api.overlay.cursor = t ? (t.kind === 'segment' ? 'copy' : 'default') : null;
      const hit = t
        ? null
        : hitTest(api.doc, e.world, api.px(4), { deep: true, isolation: api.od.isolation });
      if ((hit?.node.id ?? null) !== api.overlay.hoverId) {
        api.overlay.hoverId = hit?.node.id ?? null;
        api.render();
      }
      return;
    }
    if (!e.moved) return;
    const unit = api.doc.units;
    const base = getState().docs.find((d) => d.key === api.od.key)!;
    if (mode.kind === 'nodes') {
      const first = mode.nodes[0];
      const loc = first ? locate(api.doc, first.id) : null;
      let delta: Vec = [e.world[0] - e.downWorld[0], e.world[1] - e.downWorld[1]];
      if (loc && first) {
        // Snap the grabbed node.
        const baseNode = nodeSubpaths(loc.node, api.doc)[first.sp]?.nodes[first.i];
        if (baseNode) {
          const startWorld = apply(worldMatrix(loc), [baseNode.x, baseNode.y]);
          const wanted: Vec = [startWorld[0] + delta[0], startWorld[1] + delta[1]];
          if (e.shift) {
            if (Math.abs(delta[0]) > Math.abs(delta[1])) wanted[1] = startWorld[1];
            else wanted[0] = startWorld[0];
          }
          const snapped = snapPoint(wanted, nodeCandidates(api, mode.nodes), api.px(6));
          delta = [snapped.point[0] - startWorld[0], snapped.point[1] - startWorld[1]];
          api.overlay.guides = snapped.guides;
          api.overlay.hud = { at: e.screen, lines: [hudXY(artboardRelative(api, snapped.point), unit)] };
        }
      }
      updateGesture(moveNodesRecipe(mode.nodes, delta, base.doc));
    } else if (mode.kind === 'handle') {
      const t = mode.target;
      const loc = locate(api.doc, t.id);
      if (!loc) return;
      const inv = invert(worldMatrix(loc));
      const p = apply(inv, e.world);
      const breakHandle = mode.breakHandle || e.alt;
      let info = '';
      updateGesture((d) => {
        const path = ensurePath(d, t.id);
        const node = path?.subpaths[t.sp]?.nodes[t.i];
        if (!path || !node) return;
        let hp: Vec = p;
        if (e.shift) {
          // Constrain the handle angle to 45° steps.
          const a = Math.round(Math.atan2(p[1] - node.y, p[0] - node.x) / (Math.PI / 4)) * (Math.PI / 4);
          const l = Math.hypot(p[0] - node.x, p[1] - node.y);
          hp = [node.x + Math.cos(a) * l, node.y + Math.sin(a) * l];
        }
        node[t.which] = hp;
        const other = t.which === 'in' ? 'out' : 'in';
        if (breakHandle) node.kind = 'sharp';
        else if (node.kind === 'auto') node.kind = 'smooth';
        if (!breakHandle && (node.kind === 'smooth' || node.kind === 'symmetric') && node[other]) {
          const dx = hp[0] - node.x;
          const dy = hp[1] - node.y;
          const l = Math.hypot(dx, dy) || 1;
          const o = node[other]!;
          const ol = node.kind === 'symmetric' ? l : Math.hypot(o[0] - node.x, o[1] - node.y);
          node[other] = [node.x - (dx / l) * ol, node.y - (dy / l) * ol];
        }
        const w = apply(worldMatrix(loc), hp);
        const wn = apply(worldMatrix(loc), [node.x, node.y]);
        const len = Math.hypot(w[0] - wn[0], w[1] - wn[1]);
        const ang = (Math.atan2(-(w[1] - wn[1]), w[0] - wn[0]) * 180) / Math.PI;
        info = `Handle ${fmt(len, unit)} ${unit} · ${ang.toFixed(1)}°`;
      });
      api.overlay.hud = { at: e.screen, lines: [hudXY(artboardRelative(api, e.world), unit), info] };
    } else if (mode.kind === 'segment') {
      // Bend the curve: move both control points so the grabbed point follows the cursor.
      const t = mode.target;
      const loc = locate(api.doc, t.id);
      if (!loc) return;
      const inv = invert(worldMatrix(loc));
      const startLocal = apply(inv, e.downWorld);
      const curLocal = apply(inv, e.world);
      const d0: Vec = [curLocal[0] - startLocal[0], curLocal[1] - startLocal[1]];
      updateGesture((d) => {
        const path = ensurePath(d, t.id);
        const sp = path?.subpaths[t.sp];
        if (!path || !sp) return;
        const a = sp.nodes[t.seg];
        const b = sp.nodes[(t.seg + 1) % sp.nodes.length];
        const seg = segmentBetween(a as never, b as never);
        const u = t.t;
        const w1 = 3 * (1 - u) * (1 - u) * u;
        const w2 = 3 * (1 - u) * u * u;
        const k = 1 / (w1 * w1 + w2 * w2 || 1);
        a.out = [seg[1][0] + d0[0] * w1 * k, seg[1][1] + d0[1] * w1 * k];
        b.in = [seg[2][0] + d0[0] * w2 * k, seg[2][1] + d0[1] * w2 * k];
        if (a.kind === 'sharp' && a.in) a.kind = 'smooth';
        if (b.kind === 'sharp' && b.out) b.kind = 'smooth';
      });
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
    if (m.kind === 'nodes') {
      if (e.moved) endGesture('Move nodes');
      else cancelGesture();
    } else if (m.kind === 'handle') {
      if (e.moved) endGesture('Move handle');
      else cancelGesture();
    } else if (m.kind === 'segment') {
      if (e.moved) endGesture('Bend segment');
      else {
        cancelGesture();
        if (e.clickCount < 2) setNodeSelection([]);
      }
    } else if (m.kind === 'marquee') {
      const r = api.overlay.marquee;
      api.overlay.marquee = null;
      if (r && r.width > 2 && r.height > 2) {
        const vm = viewMatrix(api.view);
        const picked: NodeSelection[] = [];
        for (const ed of editable(api)) {
          const mm = multiply(vm, ed.m);
          ed.subpaths.forEach((sp, spi) =>
            sp.nodes.forEach((n, i) => {
              const p = apply(mm, [n.x, n.y]);
              if (p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height)
                picked.push({ id: ed.id, sp: spi, i });
            }),
          );
        }
        setNodeSelection(m.additive ? [...api.od.nodeSelection, ...picked] : picked);
      }
    }
    api.render();
  },

  dblclick(e, api) {
    const t = findTarget(api, e.screen);
    if (t?.kind === 'segment') {
      mutate('Add node', (d) => {
        const path = ensurePath(d, t.id);
        if (!path) return;
        path.subpaths[t.sp] = insertNodeAt(path.subpaths[t.sp] as Subpath, t.seg, t.t) as never;
      });
      setNodeSelection([{ id: t.id, sp: t.sp, i: t.seg + 1 }]);
    } else if (t?.kind === 'node') {
      // Double-click a node toggles between sharp and smooth.
      const loc = locate(api.doc, t.id);
      const n = loc ? nodeSubpaths(loc.node, api.doc)[t.sp]?.nodes[t.i] : null;
      if (!n) return;
      import('../state/actions').then((a) => a.convertNodes(n.kind === 'sharp' ? 'smooth' : 'sharp'));
    }
  },

  key(e, api) {
    if (e.key === 'Escape') {
      // Only consume Escape when there is something to cancel; an idle tool lets it fall through to Move.
      const busy = mode.kind !== 'idle' || api.od.nodeSelection.length > 0;
      if (mode.kind !== 'idle') cancelGesture();
      mode = { kind: 'idle' };
      if (api.od.nodeSelection.length) setNodeSelection([]);
      return busy;
    }
    return false;
  },

  overlay(ctx, api) {
    drawHover(ctx, api);
    const vm = viewMatrix(api.view);
    const sel = api.od.nodeSelection;
    const showAll = getState().ui.showAllHandles;
    for (const e of editable(api)) {
      drawOutline(ctx, e.subpaths, e.m, api.view);
      const m = multiply(vm, e.m);
      e.subpaths.forEach((sp, spi) => {
        sp.nodes.forEach((n, i) => {
          const near = sel.some((s) => s.id === e.id && s.sp === spi && Math.abs(s.i - i) <= 1);
          if (!showAll && !near) return;
          const p = apply(m, [n.x, n.y]);
          if (n.in) drawHandle(ctx, p, apply(m, n.in));
          if (n.out) drawHandle(ctx, p, apply(m, n.out));
        });
        sp.nodes.forEach((n, i) => {
          const selected = sel.some((s) => s.id === e.id && s.sp === spi && s.i === i);
          drawAnchor(ctx, apply(m, [n.x, n.y]), selected, n.kind !== 'sharp');
        });
      });
    }
  },

  cancel() {
    if (mode.kind !== 'idle') cancelGesture();
    mode = { kind: 'idle' };
  },
};

/** Nudge selected nodes in world units (arrow keys). Returns false when no nodes are selected. */
export function nudgeNodes(dx: number, dy: number): boolean {
  const od = getState().docs.find((d) => d.key === getState().activeKey);
  if (!od || !od.nodeSelection.length) return false;
  mutate('Nudge nodes', moveNodesRecipe(od.nodeSelection, [dx, dy], od.doc), undefined, { coalesce: 800 });
  return true;
}
