import { isEvenOdd } from '../../core/document';
import type { BooleanNode, CurvsDocument, Matrix, SceneNode, Subpath } from '../types';
import { combine, pathKitReady } from '../booleans';
import { ellipseSubpaths, rectSubpaths, starSubpaths } from './shapes';
import { shapeSubpaths } from './multishape';
import { layoutText } from '../text';
import { multiply } from '../matrix';
import { type Rect, subpathsBounds, transformRect, transformSubpath, unionRect } from './bezier';
import { childrenOf, type NodeLocation, worldMatrix } from '../document';

/* Immutable nodes (immer) make the node object itself a perfect cache key. */
const booleanCache = new WeakMap<BooleanNode, Subpath[]>();

const rectPath = (w: number, h: number): Subpath[] => [
  {
    closed: true,
    nodes: [
      { x: 0, y: 0, in: null, out: null, kind: 'sharp' },
      { x: w, y: 0, in: null, out: null, kind: 'sharp' },
      { x: w, y: h, in: null, out: null, kind: 'sharp' },
      { x: 0, y: h, in: null, out: null, kind: 'sharp' },
    ],
  },
];

/** Subpaths of a leaf-like node in its own local space (without its transform). */
export function nodeSubpaths(n: SceneNode, doc?: CurvsDocument): Subpath[] {
  switch (n.type) {
    case 'path':
      return n.subpaths;
    case 'rect':
      return rectSubpaths(n);
    case 'ellipse':
      return ellipseSubpaths(n);
    case 'star':
      return starSubpaths(n);
    case 'shape':
      return shapeSubpaths(n.kind, n.width, n.height, n.params);
    case 'image':
      return rectPath(n.width, n.height);
    case 'text': {
      const l = layoutText(n);
      return rectPath(Math.max(l.width, 1), Math.max(l.height, 1));
    }
    case 'boolean':
      return booleanSubpaths(n, doc);
    case 'group':
    case 'clipGroup': {
      const out: Subpath[] = [];
      const kids = n.type === 'clipGroup' ? [n.clip] : n.children;
      for (const c of kids)
        for (const sp of nodeSubpaths(c, doc)) out.push(transformSubpath(sp, c.transform));
      return out;
    }
    case 'instance': {
      const sym = doc?.symbols.find((s) => s.id === n.symbol);
      if (!sym) return [];
      return nodeSubpaths(sym.root, doc).map((sp) => transformSubpath(sp, sym.root.transform));
    }
  }
}

export function booleanSubpaths(n: BooleanNode, doc?: CurvsDocument): Subpath[] {
  const cached = booleanCache.get(n);
  if (cached) return cached;
  const operands = n.children
    .filter((c) => c.visible)
    .map((c) => ({
      subpaths: nodeSubpaths(c, doc),
      transform: c.transform,
      evenOdd: isEvenOdd(c),
    }));
  const result = combine(n.op, operands);
  if (result) {
    booleanCache.set(n, result);
    return result;
  }
  // PathKit not ready: show the operands as one shape for now (not cached).
  return operands.flatMap((o) => o.subpaths.map((sp) => transformSubpath(sp, o.transform)));
}

export const booleansReady = pathKitReady;

/** Bounds in the node's parent space (after its transform). */
export function nodeBounds(n: SceneNode, doc?: CurvsDocument, outer: Matrix | null = null): Rect | null {
  const m = outer ? multiply(outer, n.transform) : n.transform;
  if (n.type === 'group') {
    let r: Rect | null = null;
    for (const c of n.children) if (c.visible) r = unionRect(r, nodeBounds(c, doc, m));
    return r;
  }
  if (n.type === 'clipGroup') return nodeBounds(n.clip, doc, m);
  if (n.type === 'text' || n.type === 'image') {
    const l = n.type === 'text' ? layoutText(n) : { width: n.width, height: n.height };
    return transformRect({ x: 0, y: 0, width: l.width, height: l.height }, m);
  }
  return subpathsBounds(nodeSubpaths(n, doc), m);
}

export function worldBounds(
  loc: Pick<NodeLocation, 'artboard' | 'ancestors' | 'node'>,
  doc?: CurvsDocument,
): Rect | null {
  const parent = worldMatrix({ ...loc, node: { ...loc.node, transform: [1, 0, 0, 1, 0, 0] } as SceneNode });
  return nodeBounds(loc.node, doc, parent);
}

/** Local-space bounds (no transform). Used for rotated selection boxes. */
export function localBounds(n: SceneNode, doc?: CurvsDocument): Rect | null {
  return nodeBounds({ ...n, transform: [1, 0, 0, 1, 0, 0] } as SceneNode, doc);
}

export function hasChildren(n: SceneNode) {
  return childrenOf(n).length > 0;
}

/** Visual extent of strokes, used to pad hit-test and dirty regions. */
export function strokePadding(n: SceneNode): number {
  let w = 0;
  for (const it of n.appearance.items)
    if (it.kind === 'stroke' && it.visible)
      w = Math.max(w, it.width * (it.align === 'outside' ? 1 : it.align === 'center' ? 0.5 : 0));
  return w;
}
