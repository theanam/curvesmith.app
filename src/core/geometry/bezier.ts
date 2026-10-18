import type { Matrix, PathNode, Subpath, Vec } from '../types';
import { apply } from '../matrix';

export type Rect = { x: number; y: number; width: number; height: number };
export type Cubic = [Vec, Vec, Vec, Vec];

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Vec) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export function normalize(a: Vec): Vec {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
}

/** The segments of a subpath as cubics (lines become degenerate cubics with handles on the ends). */
export function segments(sp: Subpath): Cubic[] {
  const out: Cubic[] = [];
  const n = sp.nodes.length;
  const count = sp.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = sp.nodes[i];
    const b = sp.nodes[(i + 1) % n];
    out.push(segmentBetween(a, b));
  }
  return out;
}

export function segmentBetween(a: PathNode, b: PathNode): Cubic {
  const p0: Vec = [a.x, a.y];
  const p3: Vec = [b.x, b.y];
  return [p0, a.out ? [...a.out] : p0, b.in ? [...b.in] : p3, p3];
}

export const isLine = (c: Cubic) =>
  c[1][0] === c[0][0] && c[1][1] === c[0][1] && c[2][0] === c[3][0] && c[2][1] === c[3][1];

export function pointAt(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return [
    a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0],
    a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1],
  ];
}

export function derivativeAt(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const d = 3 * t * t;
  return [
    a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + d * (c[3][0] - c[2][0]),
    a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + d * (c[3][1] - c[2][1]),
  ];
}

/** De Casteljau split at t. */
export function split(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t);
  const p12 = lerp(c[1], c[2], t);
  const p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return [
    [c[0], p01, p012, p],
    [p, p123, p23, c[3]],
  ];
}

/** Parameter values in (0,1) where the derivative of one axis is zero. */
function extremaAxis(c: Cubic, axis: 0 | 1): number[] {
  const p0 = c[0][axis];
  const p1 = c[1][axis];
  const p2 = c[2][axis];
  const p3 = c[3][axis];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const cc = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-cc / b);
  } else {
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

export function cubicBounds(c: Cubic): Rect {
  const ts = [0, 1, ...extremaAxis(c, 0), ...extremaAxis(c, 1)];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of ts) {
    const p = pointAt(c, t);
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function rectFromPoints(points: Vec[]): Rect | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const rectCorners = (r: Rect): Vec[] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x + r.width, r.y + r.height],
  [r.x, r.y + r.height],
];

export function transformRect(r: Rect, m: Matrix): Rect {
  return rectFromPoints(rectCorners(r).map((p) => apply(m, p)))!;
}

export const rectContains = (r: Rect, p: Vec) =>
  p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height;

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** Tight bounds of subpaths after a transform. Transforming control points first keeps bounds tight. */
export function subpathsBounds(subpaths: Subpath[], m?: Matrix): Rect | null {
  let r: Rect | null = null;
  for (const sp of subpaths) {
    const tsp = m ? transformSubpath(sp, m) : sp;
    if (tsp.nodes.length === 1)
      r = unionRect(r, { x: tsp.nodes[0].x, y: tsp.nodes[0].y, width: 0, height: 0 });
    for (const seg of segments(tsp)) r = unionRect(r, cubicBounds(seg));
  }
  return r;
}

export function transformSubpath(sp: Subpath, m: Matrix): Subpath {
  return {
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const p = apply(m, [n.x, n.y]);
      return {
        x: p[0],
        y: p[1],
        in: n.in ? apply(m, n.in) : null,
        out: n.out ? apply(m, n.out) : null,
        kind: n.kind,
      };
    }),
  };
}

/** Approximate arc length by adaptive flattening. */
export function cubicLength(c: Cubic, steps = 24): number {
  let l = 0;
  let prev = c[0];
  for (let i = 1; i <= steps; i++) {
    const p = pointAt(c, i / steps);
    l += dist(prev, p);
    prev = p;
  }
  return l;
}

/** Flatten a cubic into a polyline within a tolerance (in the cubic's units). */
export function flattenCubic(c: Cubic, tolerance = 0.25, out: Vec[] = []): Vec[] {
  if (out.length === 0) out.push(c[0]);
  if (isLine(c)) {
    out.push(c[3]);
    return out;
  }
  const l = cubicLength(c, 8);
  const n = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(l / tolerance))));
  for (let i = 1; i <= n; i++) out.push(pointAt(c, i / n));
  return out;
}

export function flattenSubpath(sp: Subpath, tolerance = 0.25): Vec[] {
  const out: Vec[] = [];
  if (sp.nodes.length === 1) return [[sp.nodes[0].x, sp.nodes[0].y]];
  for (const seg of segments(sp)) flattenCubic(seg, tolerance, out);
  return out;
}

export type NearestHit = { segment: number; t: number; point: Vec; distance: number };

/** Nearest point on a subpath: coarse sampling then Newton refinement. */
export function nearestOnSubpath(sp: Subpath, p: Vec): NearestHit | null {
  let best: NearestHit | null = null;
  segments(sp).forEach((seg, i) => {
    const hit = nearestOnCubic(seg, p);
    if (!best || hit.distance < best.distance) best = { segment: i, ...hit };
  });
  return best;
}

export function nearestOnCubic(c: Cubic, p: Vec): { t: number; point: Vec; distance: number } {
  const SAMPLES = 32;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const d = dist(pointAt(c, t), p);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // Refine with a few bisection-style passes around the best sample.
  let step = 1 / SAMPLES;
  for (let k = 0; k < 12; k++) {
    step /= 2;
    for (const t of [bestT - step, bestT + step]) {
      if (t < 0 || t > 1) continue;
      const d = dist(pointAt(c, t), p);
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
  }
  return { t: bestT, point: pointAt(c, bestT), distance: bestD };
}

/** Insert a node into a subpath at (segment, t), keeping the curve shape. */
export function insertNodeAt(sp: Subpath, segment: number, t: number): Subpath {
  const nodes = sp.nodes.map((n) => ({ ...n }));
  const a = nodes[segment];
  const bi = (segment + 1) % nodes.length;
  const b = nodes[bi];
  const seg = segmentBetween(a, b);
  const line = isLine(seg);
  const [l, r] = split(seg, t);
  const mid: PathNode = {
    x: l[3][0],
    y: l[3][1],
    in: line ? null : l[2],
    out: line ? null : r[1],
    kind: line ? 'sharp' : 'smooth',
  };
  if (!line) {
    a.out = l[1];
    b.in = r[2];
  }
  nodes[segment] = a;
  nodes[bi] = b;
  nodes.splice(segment + 1, 0, mid);
  return { closed: sp.closed, nodes };
}

/** Signed area of a polygon (positive = clockwise in y-down space). */
export function polygonArea(points: Vec[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to a segment. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, mul(ab, t)));
}

/** Intersections of a line segment with a cubic, as cubic t parameters. */
export function intersectSegmentCubic(a: Vec, b: Vec, c: Cubic): number[] {
  const pts: number[] = [];
  const N = 64;
  let prev = pointAt(c, 0);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const cur = pointAt(c, t);
    const hit = segmentIntersection(a, b, prev, cur);
    if (hit) pts.push((i - 1 + hit[1]) / N);
    prev = cur;
  }
  return pts;
}

/** Intersection of segments ab and cd, returns [t on ab, u on cd] or null. */
export function segmentIntersection(a: Vec, b: Vec, c: Vec, d: Vec): [number, number] | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(c, a);
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}
