import type { Artboard, CurvsDocument, Matrix, SceneNode, Subpath, Vec } from '../core/types';
import { apply, invert, multiply, translate } from '../core/matrix';
import {
  distToSegment,
  flattenSubpath,
  type Rect,
  rectContains,
  rectsIntersect,
} from '../core/geometry/bezier';
import { nodeBounds, nodeSubpaths } from '../core/geometry/node';
import { childrenOf, locate, isEvenOdd } from '../core/document';

const flatCache = new WeakMap<Subpath[], Vec[][]>();
function flatten(subpaths: Subpath[]): Vec[][] {
  let f = flatCache.get(subpaths);
  if (!f) {
    f = subpaths.map((sp) => flattenSubpath(sp, 0.5));
    flatCache.set(subpaths, f);
  }
  return f;
}

function winding(p: Vec, polys: Vec[][], evenOdd: boolean): boolean {
  let w = 0;
  let crossings = 0;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yj <= p[1]) {
        if (yi > p[1] && (xi - xj) * (p[1] - yj) - (p[0] - xj) * (yi - yj) > 0) {
          w++;
          crossings++;
        }
      } else if (yi <= p[1] && (xi - xj) * (p[1] - yj) - (p[0] - xj) * (yi - yj) < 0) {
        w--;
        crossings++;
      }
    }
  }
  return evenOdd ? crossings % 2 === 1 : w !== 0;
}

/** Does a leaf node's geometry contain the point (in the node's local space)? */
export function hitLeaf(n: SceneNode, local: Vec, tol: number, doc: CurvsDocument): boolean {
  if (n.type === 'text' || n.type === 'image') {
    const b = nodeBounds({ ...n, transform: [1, 0, 0, 1, 0, 0] } as SceneNode, doc);
    return (
      !!b &&
      rectContains(
        { x: b.x - tol, y: b.y - tol, width: b.width + tol * 2, height: b.height + tol * 2 },
        local,
      )
    );
  }
  const subpaths = nodeSubpaths(n, doc);
  const polys = flatten(subpaths);
  const items = n.appearance.items.filter((i) => i.visible);
  const filled = items.some((i) => i.kind === 'fill') || items.length === 0;
  const strokeW = Math.max(0, ...items.map((i) => (i.kind === 'stroke' ? i.width : 0)));
  if (filled) {
    const closedPolys = polys.filter((_, i) => subpaths[i].closed || items.some((x) => x.kind === 'fill'));
    if (winding(local, closedPolys, isEvenOdd(n))) return true;
  }
  const edgeTol = strokeW / 2 + tol;
  for (let k = 0; k < polys.length; k++) {
    const poly = polys[k];
    const closed = subpaths[k].closed;
    for (let i = 0; i < poly.length - 1 + (closed ? 1 : 0); i++) {
      if (distToSegment(local, poly[i], poly[(i + 1) % poly.length]) <= edgeTol) return true;
    }
  }
  return false;
}

/** Hit test a subtree; returns the deepest leaf hit and its ancestor chain (relative to `nodes`). */
function hitIn(
  nodes: SceneNode[],
  world: Vec,
  parent: Matrix,
  tol: number,
  doc: CurvsDocument,
  chain: SceneNode[],
): SceneNode[] | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n.visible) continue;
    const m = multiply(parent, n.transform);
    const kids = n.type === 'boolean' ? [] : childrenOf(n);
    if (kids.length && n.type !== 'clipGroup') {
      const r = hitIn(n.type === 'group' ? n.children : kids, world, m, tol, doc, [...chain, n]);
      if (r) return r;
      continue;
    }
    if (n.type === 'clipGroup') {
      const clipLocal = apply(invert(multiply(m, n.clip.transform)), world);
      if (!hitLeaf(n.clip, clipLocal, tol, doc)) continue;
      const r = hitIn(n.children, world, m, tol, doc, [...chain, n]);
      if (r) return r;
      continue;
    }
    const inv = invert(m);
    const local = apply(inv, world);
    const scale = Math.hypot(inv[0], inv[1]);
    if (hitLeaf(n, local, tol * scale, doc)) return [...chain, n];
  }
  return null;
}

export type HitOptions = {
  /** Return the deepest leaf hit. */
  deep?: boolean;
  /** Restrict hits to the children of this group (isolation mode). */
  isolation?: string | null;
  /** Ignore locked nodes. */
  includeLocked?: boolean;
};

export function hitTest(
  doc: CurvsDocument,
  world: Vec,
  tolWorld: number,
  opts: HitOptions = {},
): { node: SceneNode; artboard: Artboard } | null {
  for (let a = doc.artboards.length - 1; a >= 0; a--) {
    const ab = doc.artboards[a];
    let roots = ab.children;
    let base = translate(ab.x, ab.y);
    if (opts.isolation) {
      const loc = locate(doc, opts.isolation);
      if (!loc || loc.artboard.id !== ab.id) continue;
      roots = childrenOf(loc.node);
      for (const x of loc.ancestors) base = multiply(base, x.transform);
      base = multiply(base, loc.node.transform);
    }
    const chain = hitIn(roots, world, base, tolWorld, doc, []);
    if (!chain) continue;
    const pick = opts.deep ? chain[chain.length - 1] : chain[0];
    if (!opts.includeLocked && chain.some((n) => n.locked)) continue;
    return { node: pick, artboard: ab };
  }
  return null;
}

export function artboardAt(doc: CurvsDocument, world: Vec): Artboard | null {
  for (let i = doc.artboards.length - 1; i >= 0; i--) {
    const a = doc.artboards[i];
    if (rectContains({ x: a.x, y: a.y, width: a.width, height: a.height }, world)) return a;
  }
  return null;
}

/** Top-level (or isolated-level) nodes whose world bounds intersect the marquee. */
export function marqueeSelect(
  doc: CurvsDocument,
  r: Rect,
  isolation: string | null,
  contain = false,
): string[] {
  const out: string[] = [];
  for (const ab of doc.artboards) {
    let roots = ab.children;
    let base = translate(ab.x, ab.y);
    if (isolation) {
      const loc = locate(doc, isolation);
      if (!loc || loc.artboard.id !== ab.id) continue;
      roots = childrenOf(loc.node);
      for (const x of loc.ancestors) base = multiply(base, x.transform);
      base = multiply(base, loc.node.transform);
    }
    for (const n of roots) {
      if (!n.visible || n.locked) continue;
      const b = nodeBounds(n, doc, base);
      if (!b) continue;
      const inside =
        b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width && b.y + b.height <= r.y + r.height;
      if (contain ? inside : rectsIntersect(b, r)) out.push(n.id);
    }
  }
  return out;
}
