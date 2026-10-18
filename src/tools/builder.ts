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
} from '../core/document';
import { nodeSubpaths } from '../core/geometry/node';
import { combine, divide, loadPathKit, pathKitReady } from '../core/booleans';
import { flattenSubpath, pointInPolygon, subpathsBounds, transformSubpath } from '../core/geometry/bezier';
import { hitLeaf } from '../render/hittest';
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
let erasing = false;

/** Overlapping regions of the selected shapes, in the parent space of the top-most shape. */
function regions(api: ToolApi): Cache {
  const ids = inDocOrder(api.doc, api.od.selection).filter((id) => {
    const n = locate(api.doc, id)?.node;
    return n && n.type !== 'group' && n.type !== 'text' && n.type !== 'image';
  });
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
      sources.map((s) => ({ subpaths: nodeSubpaths(s.node, api.doc), transform: s.m, evenOdd: false })),
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

function commit(api: ToolApi) {
  const c = regions(api);
  if (!c || !picked.size) return;
  const ids = inDocOrder(api.doc, api.od.selection);
  const keep = c.regions.filter((_, i) => !picked.has(i));
  const chosen = c.regions.filter((_, i) => picked.has(i));
  const result: SceneNode[] = [];
  for (const r of keep) result.push(makePath(r.subpaths, clone(r.appearance), 'Region'));
  if (!erasing) {
    const merged = combine(
      'union',
      chosen.map((r) => ({ subpaths: r.subpaths, transform: [1, 0, 0, 1, 0, 0], evenOdd: false })),
    );
    if (merged) result.push(makePath(merged, clone(chosen[0].appearance), 'Merged shape'));
  }
  mutate(
    erasing ? 'Erase regions' : 'Merge regions',
    (d) => {
      const top = locate(d as unknown as CurvsDocument, ids[ids.length - 1]);
      if (!top) return;
      const list = top.siblings as Draft<SceneNode>[];
      const at = top.index;
      removeNodes(d as unknown as CurvsDocument, new Set(ids));
      list.splice(Math.min(at, list.length), 0, ...(result as Draft<SceneNode>[]));
      pruneEmpty(d as unknown as CurvsDocument);
    },
    result.map((n) => n.id),
  );
  cache = null;
}

export const builderTool: Tool = {
  cursor: 'crosshair',
  down(e, api) {
    erasing = e.alt;
    picked = new Set();
    const i = regionAt(api, e.world);
    if (i >= 0) picked.add(i);
    api.render();
  },
  move(e, api) {
    const i = regionAt(api, e.world);
    if (e.dragging && i >= 0) picked.add(i);
    if (i !== hover || e.dragging) {
      hover = i;
      api.render();
    }
  },
  up(_e, api) {
    commit(api);
    picked = new Set();
    api.render();
  },
  overlay(ctx, api) {
    const c = regions(api);
    if (!c) return;
    const m = multiply(viewMatrix(api.view), c.space);
    c.regions.forEach((r, i) => {
      ctx.save();
      ctx.beginPath();
      traceScreen(
        ctx,
        r.subpaths.map((s) => transformSubpath(s, [1, 0, 0, 1, 0, 0])),
        m,
      );
      if (picked.has(i) || i === hover) {
        ctx.fillStyle = erasing ? 'rgba(26, 24, 32, 0.35)' : 'rgba(22, 199, 91, 0.28)';
        ctx.fill('evenodd');
      }
      ctx.strokeStyle = OVERLAY.volt;
      ctx.setLineDash(i === hover ? [] : [3, 3]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  },
  cancel() {
    picked = new Set();
    hover = -1;
  },
};
