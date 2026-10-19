import type { Draft } from 'immer';
import type { Appearance, CurvsDocument, SceneNode, Subpath, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, invert, multiply } from '../core/matrix';
import {
  locate,
  makePath,
  parentWorldMatrix,
  pruneEmpty,
  removeNodes,
  worldMatrix,
  clone,
  childrenOf,
  isEvenOdd,
} from '../core/document';
import { nodeSubpaths } from '../core/geometry/node';
import { combine, divide, loadPathKit, pathKitReady } from '../core/booleans';
import {
  flattenSubpath,
  pointInPolygon,
  rectsIntersect,
  subpathsBounds,
  distToSegment,
  transformSubpath,
} from '../core/geometry/bezier';
import { hitLeaf, hitTest } from '../render/hittest';
import { selectionBounds } from '../core/transform';
import { mutate } from '../state/store';
import { OVERLAY, traceScreen, viewMatrix } from '../render/overlay';
import { inDocOrder } from '../state/actions';

type Region = { subpaths: Subpath[]; polys: Vec[][]; appearance: Appearance };
type Cache = {
  key: string;
  doc: CurvsDocument;
  regions: Region[];
  space: [number, number, number, number, number, number];
} | null;

let cache: Cache = null;
let hover = -1;
let picked = new Set<number>();
/** merge: drag joins regions · erase: ⌥-drag removes regions · edges: ⌥-drag along lines removes them. */
let mode: 'merge' | 'erase' | 'edges' = 'merge';
/** ⌥ is held: the overlay previews what a press would erase. */
let altHeld = false;
let lastWorld: Vec | null = null;
/** A line shared by two regions, as region indices (a < b). */
type Edge = [number, number];
let hoverEdge: Edge | null = null;
let pickedEdges: Edge[] = [];

const buildable = (n: SceneNode | undefined) =>
  !!n &&
  n.visible &&
  !n.locked &&
  n.type !== 'group' &&
  n.type !== 'text' &&
  n.type !== 'image' &&
  n.type !== 'clipGroup' &&
  n.type !== 'instance';

/** Shapes picked up automatically under the pointer when fewer than two are selected. */
let autoIds: string[] = [];

/** Every buildable shape under `nodes`, looking inside groups (but not inside hidden or locked ones). */
function buildableLeaves(nodes: SceneNode[], out: SceneNode[] = []): SceneNode[] {
  for (const n of nodes) {
    if (!n.visible || n.locked) continue;
    if (n.type === 'group') buildableLeaves(n.children, out);
    else if (buildable(n)) out.push(n);
  }
  return out;
}

/**
 * The shape under the pointer plus every shape that overlaps it (and those overlapping them), anywhere on the
 * artboard or in the isolated group: shapes in different groups build together.
 */
export function overlappingCluster(
  doc: CurvsDocument,
  world: Vec,
  tol: number,
  isolation: string | null,
): string[] {
  const hit = hitTest(doc, world, tol, { isolation, deep: true });
  if (!hit || !buildable(hit.node)) return [];
  const loc = locate(doc, hit.node.id)!;
  const scope = isolation ? locate(doc, isolation)?.node : null;
  const candidates = buildableLeaves(scope ? childrenOf(scope) : loc.artboard.children).slice(0, 120);
  const boxes = new Map(candidates.map((n) => [n.id, selectionBounds(doc, [n.id])]));
  const cluster = new Set([hit.node.id]);
  for (let pass = 0; pass < 3; pass++) {
    for (const n of candidates) {
      if (cluster.has(n.id)) continue;
      const b = boxes.get(n.id);
      if (
        b &&
        [...cluster].some((id) => {
          const c = boxes.get(id);
          return c && rectsIntersect(b, c);
        })
      )
        cluster.add(n.id);
    }
  }
  return cluster.size > 1 ? inDocOrder(doc, [...cluster]) : [];
}

/** Selected shapes when two or more are selected, otherwise the overlapping shapes under the pointer. */
function targetIds(api: ToolApi): string[] {
  const sel = inDocOrder(api.doc, api.od.selection).filter((id) => buildable(locate(api.doc, id)?.node));
  return sel.length >= 2 ? sel : autoIds.filter((id) => locate(api.doc, id));
}

/** Overlapping regions of the target shapes, in the parent space of the top-most shape. */
function regions(api: ToolApi): Cache {
  const ids = targetIds(api);
  const key = ids.join(',');
  if (cache && cache.key === key && cache.doc === api.doc) return cache;
  if (ids.length < 2) return (cache = null);
  if (!pathKitReady()) {
    void loadPathKit().then(() => api.render());
    return null;
  }
  const top = locate(api.doc, ids[ids.length - 1])!;
  const space = parentWorldMatrix(top);
  const inv = invert(space);
  const sources = ids.map((id) => {
    const loc = locate(api.doc, id)!;
    return { node: loc.node, m: multiply(inv, worldMatrix(loc)) };
  });
  const pieces =
    divide(
      sources.map((s) => ({
        subpaths: nodeSubpaths(s.node, api.doc),
        transform: s.m,
        evenOdd: isEvenOdd(s.node),
      })),
    ) ?? [];
  const out: Region[] = pieces.map((sp) => {
    const polys = sp.map((s) => flattenSubpath(s, 0.5));
    // The appearance comes from the front-most source that covers a point inside the region.
    const b = subpathsBounds(sp)!;
    let inside: Vec | null = null;
    for (let gy = 1; gy < 8 && !inside; gy++)
      for (let gx = 1; gx < 8 && !inside; gx++) {
        const p: Vec = [b.x + (b.width * gx) / 8, b.y + (b.height * gy) / 8];
        if (insideRegion(p, polys)) inside = p;
      }
    let appearance = sources[0].node.appearance;
    if (inside) {
      for (let i = sources.length - 1; i >= 0; i--) {
        if (hitLeaf(sources[i].node, apply(invert(sources[i].m), inside), 0, api.doc)) {
          appearance = sources[i].node.appearance;
          break;
        }
      }
    }
    return { subpaths: sp, polys, appearance };
  });
  cache = { key, doc: api.doc, regions: out, space };
  return cache;
}

function insideRegion(p: Vec, polys: Vec[][]) {
  let c = 0;
  for (const poly of polys) if (pointInPolygon(p, poly)) c++;
  return c % 2 === 1;
}

function regionAt(api: ToolApi, world: Vec): number {
  const c = regions(api);
  if (!c) return -1;
  const local = apply(invert(c.space), world);
  for (let i = c.regions.length - 1; i >= 0; i--) if (insideRegion(local, c.regions[i].polys)) return i;
  return -1;
}

/** Local-space distance from p to a region's outline. */
function outlineDistance(p: Vec, polys: Vec[][]) {
  let best = Infinity;
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++)
      best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** Pointer tolerance in the regions' local space. */
function localTol(api: ToolApi, c: NonNullable<Cache>, px: number) {
  const scale = Math.sqrt(Math.abs(c.space[0] * c.space[3] - c.space[1] * c.space[2])) || 1;
  return api.px(px) / scale;
}

/** The line under the pointer that two regions share, if any. Outer outlines are not lines between regions. */
export function edgeAt(api: ToolApi, world: Vec): Edge | null {
  const c = regions(api);
  if (!c) return null;
  const local = apply(invert(c.space), world);
  const tol = localTol(api, c, 5);
  const near = c.regions
    .map((r, i) => ({ i, d: outlineDistance(local, r.polys) }))
    .filter((x) => x.d <= tol)
    .sort((x, y) => x.d - y.d);
  if (near.length < 2) return null;
  const [a, b] = [near[0].i, near[1].i].sort((x, y) => x - y);
  return [a, b];
}

/** Stretches of region a's outline that run along region b's: the line between them, for drawing. */
function sharedRuns(api: ToolApi, c: NonNullable<Cache>, [a, b]: Edge): Vec[][] {
  const eps = localTol(api, c, 1.5);
  const runs: Vec[][] = [];
  for (const poly of c.regions[a].polys) {
    const on = poly.map((p) => outlineDistance(p, c.regions[b].polys) <= eps);
    const start = on.indexOf(false);
    if (start < 0) {
      runs.push([...poly, poly[0]]);
      continue;
    }
    let run: Vec[] = [];
    for (let k = 1; k <= poly.length; k++) {
      const i = (start + k) % poly.length;
      if (on[i]) run.push(poly[i]);
      else if (run.length) {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (run.length > 1) runs.push(run);
  }
  return runs;
}

const sameEdge = (x: Edge, y: Edge) => x[0] === y[0] && x[1] === y[1];

/** Regions after removing lines: each set of regions joined by removed lines becomes one. */
function joinAcross(c: NonNullable<Cache>, edges: Edge[]): SceneNode[] {
  const parent = c.regions.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  c.regions.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const out: SceneNode[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      const r = c.regions[members[0]];
      out.push(makePath(r.subpaths, clone(r.appearance), 'Region'));
      continue;
    }
    const area = (i: number) => {
      const b = subpathsBounds(c.regions[i].subpaths);
      return b ? b.width * b.height : 0;
    };
    const look = c.regions[[...members].sort((x, y) => area(y) - area(x))[0]].appearance;
    const merged = combine(
      'union',
      members.map((i) => ({
        subpaths: c.regions[i].subpaths,
        transform: [1, 0, 0, 1, 0, 0],
        evenOdd: false,
      })),
    );
    if (merged) out.push(makePath(merged, clone(look), 'Merged shape'));
  }
  return out;
}

function commit(api: ToolApi) {
  const c = regions(api);
  if (!c) return;
  if (mode === 'edges' ? !pickedEdges.length : !picked.size) return;
  const ids = targetIds(api);
  const erasing = mode === 'erase';
  const keep = mode === 'edges' ? [] : c.regions.filter((_, i) => !picked.has(i));
  const chosen = c.regions.filter((_, i) => picked.has(i));
  const result: SceneNode[] = mode === 'edges' ? joinAcross(c, pickedEdges) : [];
  for (const r of keep) result.push(makePath(r.subpaths, clone(r.appearance), 'Region'));
  if (mode === 'merge') {
    const merged = combine(
      'union',
      chosen.map((r) => ({ subpaths: r.subpaths, transform: [1, 0, 0, 1, 0, 0], evenOdd: false })),
    );
    if (merged) result.push(makePath(merged, clone(chosen[0].appearance), 'Merged shape'));
  }
  mutate(
    mode === 'edges' ? 'Remove lines' : erasing ? 'Erase regions' : 'Merge regions',
    (d) => {
      const top = locate(d as unknown as CurvsDocument, ids[ids.length - 1]);
      if (!top) return;
      const list = top.siblings as Draft<SceneNode>[];
      const gone = new Set(ids);
      // Land where the top shape was, counting the sources removed before it in the same list.
      const at = top.index - list.slice(0, top.index).filter((n) => gone.has(n.id)).length;
      removeNodes(d as unknown as CurvsDocument, gone);
      list.splice(Math.min(at, list.length), 0, ...(result as Draft<SceneNode>[]));
      pruneEmpty(d as unknown as CurvsDocument);
    },
    result.map((n) => n.id),
  );
  cache = null;
}

function hint(api: ToolApi, at: Vec, line: string) {
  api.overlay.hud = { at, lines: [line] };
}

export const builderTool: Tool = {
  cursor: 'crosshair',
  down(e, api) {
    altHeld = e.alt;
    picked = new Set();
    pickedEdges = [];
    if (!regions(api)) {
      // No hover on touch screens: pick up the shapes under the finger when it lands.
      const next = overlappingCluster(api.doc, e.world, api.px(3), api.od.isolation);
      if (next.length) {
        autoIds = next;
        cache = null;
      }
    }
    const edge = e.alt ? edgeAt(api, e.world) : null;
    if (edge) {
      mode = 'edges';
      pickedEdges = [edge];
    } else {
      mode = e.alt ? 'erase' : 'merge';
      const i = regionAt(api, e.world);
      if (i >= 0) picked.add(i);
      else
        hint(
          api,
          e.screen,
          regions(api) ? 'Press inside a highlighted region' : 'Hover where two shapes overlap',
        );
    }
    api.render();
  },
  move(e, api) {
    lastWorld = e.world;
    altHeld = e.alt;
    if (!e.dragging && regionAt(api, e.world) < 0 && !edgeAt(api, e.world)) {
      // Pick up whatever overlaps under the pointer (no need to select first).
      const next = overlappingCluster(api.doc, e.world, api.px(3), api.od.isolation);
      if (next.join() !== autoIds.join()) {
        autoIds = next;
        cache = null;
      }
    }
    if (e.dragging && mode === 'edges') {
      const edge = edgeAt(api, e.world);
      if (edge && !pickedEdges.some((x) => sameEdge(x, edge))) pickedEdges.push(edge);
      hoverEdge = edge;
      api.render();
      return;
    }
    const i = regionAt(api, e.world);
    if (e.dragging && i >= 0) picked.add(i);
    const edge = !e.dragging && e.alt ? edgeAt(api, e.world) : null;
    if (i !== hover || e.dragging || !sameEdge(edge ?? [-1, -1], hoverEdge ?? [-1, -1])) {
      hover = i;
      hoverEdge = edge;
      api.render();
    }
  },
  up(_e, api) {
    api.overlay.hud = null;
    commit(api);
    picked = new Set();
    pickedEdges = [];
    hoverEdge = null;
    autoIds = [];
    mode = 'merge';
    api.render();
  },
  key(e, api) {
    if (e.key !== 'Alt' || altHeld) return false;
    altHeld = true;
    hoverEdge = lastWorld ? edgeAt(api, lastWorld) : null;
    api.render();
    return false;
  },
  keyUp(e, api) {
    if (e.key !== 'Alt') return false;
    altHeld = false;
    hoverEdge = null;
    api.render();
    return false;
  },
  leave(api) {
    hover = -1;
    hoverEdge = null;
    api.render();
  },
  overlay(ctx, api) {
    const c = regions(api);
    if (!c) return;
    const m = multiply(viewMatrix(api.view), c.space);
    const removing = mode === 'erase' || mode === 'edges' || altHeld;
    c.regions.forEach((r, i) => {
      ctx.save();
      ctx.beginPath();
      traceScreen(
        ctx,
        r.subpaths.map((s) => transformSubpath(s, [1, 0, 0, 1, 0, 0])),
        m,
      );
      const lit = picked.has(i) || (i === hover && !hoverEdge && mode !== 'edges');
      if (lit) {
        ctx.fillStyle = removing ? 'rgba(229, 72, 77, 0.28)' : 'rgba(22, 199, 91, 0.28)';
        ctx.fill('evenodd');
      }
      ctx.strokeStyle = OVERLAY.volt;
      ctx.setLineDash(i === hover && !removing ? [] : [3, 3]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
    // Lines about to go: the hovered one under ⌥, and every one crossed while dragging.
    const lines = [
      ...pickedEdges,
      ...(hoverEdge && !pickedEdges.some((x) => sameEdge(x, hoverEdge!)) ? [hoverEdge] : []),
    ];
    if (lines.length) {
      ctx.save();
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const edge of lines)
        for (const run of sharedRuns(api, c, edge)) {
          ctx.beginPath();
          run.forEach((p, k) => {
            const q = apply(m, p);
            if (k) ctx.lineTo(q[0], q[1]);
            else ctx.moveTo(q[0], q[1]);
          });
          ctx.stroke();
        }
      ctx.restore();
    }
  },
  cancel() {
    picked = new Set();
    pickedEdges = [];
    hover = -1;
    hoverEdge = null;
    autoIds = [];
    mode = 'merge';
  },
};
