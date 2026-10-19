import type { CurvsDocument, Matrix, SceneNode, Subpath } from './types';
import { apply, compose, decompose, invert, multiply, rotate } from './matrix';
import { locate, parentWorldMatrix, worldMatrix } from './document';
import { type Rect, transformSubpath, unionRect } from './geometry/bezier';
import { localBounds, worldBounds } from './geometry/node';

const EPS = 1e-6;

/** World-space bounds of a set of nodes. */
export function selectionBounds(doc: CurvsDocument, ids: string[]): Rect | null {
  let r: Rect | null = null;
  for (const id of ids) {
    const loc = locate(doc, id);
    if (loc) r = unionRect(r, worldBounds(loc, doc));
  }
  return r;
}

/**
 * Oriented selection box: for a single rotated node, its local bounds mapped through its world matrix;
 * otherwise the world-aligned bounds. `matrix` maps the unit square to the box.
 */
export function selectionBox(
  doc: CurvsDocument,
  ids: string[],
): { matrix: Matrix; rect: Rect; rotation: number } | null {
  if (ids.length === 1) {
    const loc = locate(doc, ids[0]);
    if (loc && loc.node.type !== 'group' && loc.node.type !== 'boolean') {
      const lb = localBounds(loc.node, doc);
      const wm = worldMatrix(loc);
      const d = decompose(wm);
      if (lb && Math.abs(d.rotation) > EPS) {
        // Box = world · translate(lb) · scale(lb size); keep orientation, drop skew for the handles.
        const m = multiply(wm, [Math.max(lb.width, EPS), 0, 0, Math.max(lb.height, EPS), lb.x, lb.y]);
        return { matrix: m, rect: worldBounds(loc, doc)!, rotation: d.rotation };
      }
    }
  }
  const r = selectionBounds(doc, ids);
  if (!r) return null;
  return { matrix: [Math.max(r.width, EPS), 0, 0, Math.max(r.height, EPS), r.x, r.y], rect: r, rotation: 0 };
}

/** Apply a world-space matrix to each node (pre-multiplied), then bake scale into geometry where possible. */
export function applyWorldDelta(
  doc: CurvsDocument,
  ids: string[],
  delta: Matrix,
  opts: { scaleStrokes?: boolean } = {},
) {
  for (const id of ids) {
    const loc = locate(doc, id);
    if (!loc) continue;
    const pw = parentWorldMatrix(loc);
    const local = multiply(invert(pw), multiply(delta, pw));
    const node = loc.node;
    node.transform = multiply(local, node.transform);
    normalizeNode(
      node,
      opts.scaleStrokes ? Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2])) : 1,
    );
  }
}

/**
 * Keep transforms as translate · rotate (· skew · mirror) and move scale into parametric geometry,
 * so rectangles keep their corner radii, ellipses stay ellipses and paths stay editable.
 */
export function normalizeNode(n: SceneNode, strokeScale = 1) {
  const d = decompose(n.transform);
  const sx = Math.abs(d.sx);
  const sy = Math.abs(d.sy);
  if (Math.abs(sx - 1) < EPS && Math.abs(sy - 1) < EPS) return;
  if (strokeScale !== 1)
    for (const it of n.appearance.items) if (it.kind === 'stroke') it.width *= strokeScale;
  const keep = (bakedSx: number, bakedSy: number) => {
    n.transform = compose({ ...d, sx: d.sx / bakedSx, sy: d.sy / bakedSy });
  };
  const scaleGradients = (fx: number, fy: number) => {
    for (const it of n.appearance.items) {
      if ((it.kind === 'fill' || it.kind === 'stroke') && it.paint.type !== 'solid') {
        it.paint.from = [it.paint.from[0] * fx, it.paint.from[1] * fy];
        it.paint.to = [it.paint.to[0] * fx, it.paint.to[1] * fy];
      }
    }
  };
  switch (n.type) {
    case 'shape':
    case 'rect':
      n.width *= sx;
      n.height *= sy;
      scaleGradients(sx, sy);
      keep(sx, sy);
      return;
    case 'image':
      n.width *= sx;
      n.height *= sy;
      keep(sx, sy);
      return;
    case 'ellipse':
      n.rx *= sx;
      n.ry *= sy;
      scaleGradients(sx, sy);
      keep(sx, sy);
      return;
    case 'star':
      if (Math.abs(sx - sy) < 1e-3 * Math.max(sx, sy)) {
        n.outerRadius *= sx;
        scaleGradients(sx, sx);
        keep(sx, sx);
      }
      return;
    case 'text':
      if (Math.abs(sx - sy) < 1e-3 * Math.max(sx, sy)) {
        for (const r of n.runs) r.size *= sx;
        if (n.box) n.box = { width: n.box.width * sx, height: n.box.height * sy };
        keep(sx, sx);
      } else if (n.mode === 'area' && n.box) {
        n.box = { width: n.box.width * sx, height: n.box.height * sy };
        keep(sx, sy);
      }
      return;
    case 'path': {
      // Bake skew and scale (with mirroring) into the nodes; keep translation and rotation.
      const linear: Matrix = compose({ tx: 0, ty: 0, rotation: 0, skew: d.skew, sx: d.sx, sy: d.sy });
      n.subpaths = n.subpaths.map((sp: Subpath) => transformSubpath(sp, linear));
      scaleGradients(d.sx, d.sy);
      n.transform = multiply([1, 0, 0, 1, d.tx, d.ty], rotate(d.rotation));
      return;
    }
    case 'group':
    case 'boolean': {
      const linear: Matrix = compose({ tx: 0, ty: 0, rotation: 0, skew: d.skew, sx: d.sx, sy: d.sy });
      for (const c of n.children) {
        c.transform = multiply(linear, c.transform);
        normalizeNode(c, strokeScale);
      }
      n.transform = multiply([1, 0, 0, 1, d.tx, d.ty], rotate(d.rotation));
      return;
    }
    default:
      return;
  }
}

/** Matrix that maps box A to box B (axis-aligned rects). */
export function rectToRect(a: Rect, b: Rect): Matrix {
  const sx = a.width ? b.width / a.width : 1;
  const sy = a.height ? b.height / a.height : 1;
  return [sx, 0, 0, sy, b.x - a.x * sx, b.y - a.y * sy];
}

/** Flip selection around its center. */
export function flipMatrix(r: Rect, axis: 'h' | 'v'): Matrix {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return axis === 'h' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy];
}

export function rotateAbout(rad: number, cx: number, cy: number): Matrix {
  const r = rotate(rad);
  const p = apply(r, [cx, cy]);
  return [r[0], r[1], r[2], r[3], cx - p[0], cy - p[1]];
}

/** The rotation (degrees) shown in the inspector for a selection. */
export function selectionRotation(doc: CurvsDocument, ids: string[]): number {
  if (ids.length !== 1) return 0;
  const loc = locate(doc, ids[0]);
  if (!loc) return 0;
  return (decompose(worldMatrix(loc)).rotation * 180) / Math.PI;
}
