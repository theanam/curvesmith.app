import type { Corner, EllipseNode, PathNode, RectNode, StarNode, Subpath, Vec } from '../types';

export const KAPPA = 0.5522847498307936;

const node = (x: number, y: number, inH: Vec | null = null, outH: Vec | null = null): PathNode => ({
  x,
  y,
  in: inH,
  out: outH,
  kind: inH || outH ? 'smooth' : 'sharp',
});

/** Rectangle in local space (0,0)–(w,h). Corners: top-left, top-right, bottom-right, bottom-left. */
export function rectSubpaths(r: Pick<RectNode, 'width' | 'height' | 'corners'>): Subpath[] {
  const w = r.width;
  const h = r.height;
  const max = Math.min(Math.abs(w), Math.abs(h)) / 2;
  const radii = r.corners.map((c) => Math.max(0, Math.min(c.radius, max)));
  if (radii.every((x) => x === 0)) {
    return [{ closed: true, nodes: [node(0, 0), node(w, 0), node(w, h), node(0, h)] }];
  }
  const nodes: PathNode[] = [];
  // Corner centers and the two directions leaving each corner along its edges.
  const corners: { p: Vec; a: Vec; b: Vec }[] = [
    { p: [0, 0], a: [0, 1], b: [1, 0] },
    { p: [w, 0], a: [-1, 0], b: [0, 1] },
    { p: [w, h], a: [0, -1], b: [-1, 0] },
    { p: [0, h], a: [1, 0], b: [0, -1] },
  ];
  corners.forEach((c, i) => {
    const rad = radii[i];
    const kind = r.corners[i].kind;
    if (rad === 0) {
      nodes.push(node(c.p[0], c.p[1]));
      return;
    }
    const start: Vec = [c.p[0] + c.a[0] * rad, c.p[1] + c.a[1] * rad];
    const end: Vec = [c.p[0] + c.b[0] * rad, c.p[1] + c.b[1] * rad];
    if (kind === 'chamfer') {
      nodes.push(node(start[0], start[1]), node(end[0], end[1]));
    } else if (kind === 'inset') {
      // Concave quarter circle centered on the corner point.
      const k = KAPPA * rad;
      nodes.push(
        { ...node(start[0], start[1]), out: [start[0] + c.b[0] * k, start[1] + c.b[1] * k], kind: 'sharp' },
        { ...node(end[0], end[1]), in: [end[0] + c.a[0] * k, end[1] + c.a[1] * k], kind: 'sharp' },
      );
    } else {
      const k = (1 - KAPPA) * rad;
      nodes.push(
        { ...node(start[0], start[1]), out: [c.p[0] + c.a[0] * k, c.p[1] + c.a[1] * k], kind: 'sharp' },
        { ...node(end[0], end[1]), in: [c.p[0] + c.b[0] * k, c.p[1] + c.b[1] * k], kind: 'sharp' },
      );
    }
  });
  return [{ closed: true, nodes }];
}

export const uniformCorners = (radius = 0, kind: Corner['kind'] = 'round'): RectNode['corners'] => [
  { radius, kind },
  { radius, kind },
  { radius, kind },
  { radius, kind },
];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Ellipse centered on the local origin. Arc angles in degrees, clockwise from 3 o'clock. */
export function ellipseSubpaths(
  e: Pick<EllipseNode, 'rx' | 'ry' | 'arcStart' | 'arcEnd' | 'pie'>,
): Subpath[] {
  const { rx, ry } = e;
  const start = e.arcStart ?? 0;
  let end = e.arcEnd ?? 360;
  const isFull =
    e.arcStart === undefined || e.arcEnd === undefined || Math.abs(end - start) >= 360 || end === start;
  if (isFull) {
    const k = KAPPA;
    return [
      {
        closed: true,
        nodes: [
          { x: rx, y: 0, in: [rx, -ry * k], out: [rx, ry * k], kind: 'smooth' },
          { x: 0, y: ry, in: [rx * k, ry], out: [-rx * k, ry], kind: 'smooth' },
          { x: -rx, y: 0, in: [-rx, ry * k], out: [-rx, -ry * k], kind: 'smooth' },
          { x: 0, y: -ry, in: [-rx * k, -ry], out: [rx * k, -ry], kind: 'smooth' },
        ],
      },
    ];
  }
  while (end <= start) end += 360;
  const sweep = end - start;
  const n = Math.max(1, Math.ceil(sweep / 90));
  const step = sweep / n;
  const nodes: PathNode[] = [];
  const h = (4 / 3) * Math.tan(rad(step) / 4);
  for (let i = 0; i <= n; i++) {
    const a = rad(start + step * i);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const p: Vec = [rx * cos, ry * sin];
    const t: Vec = [-rx * sin * h, ry * cos * h];
    nodes.push({
      x: p[0],
      y: p[1],
      in: i > 0 ? [p[0] - t[0], p[1] - t[1]] : null,
      out: i < n ? [p[0] + t[0], p[1] + t[1]] : null,
      kind: 'smooth',
    });
  }
  if (e.pie) {
    nodes.push(node(0, 0));
    return [{ closed: true, nodes }];
  }
  return [{ closed: false, nodes }];
}

/** Star or polygon centered on the local origin; first point straight up. */
export function starSubpaths(
  s: Pick<StarNode, 'points' | 'outerRadius' | 'innerRatio' | 'rounding' | 'polygon'>,
): Subpath[] {
  const count = Math.max(3, Math.round(s.points));
  const verts: Vec[] = [];
  const total = s.polygon ? count : count * 2;
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    const r = s.polygon || i % 2 === 0 ? s.outerRadius : s.outerRadius * s.innerRatio;
    verts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const rounding = Math.max(0, Math.min(1, s.rounding));
  const nodes: PathNode[] = verts.map((v, i) => {
    if (rounding === 0) return node(v[0], v[1]);
    const prev = verts[(i - 1 + verts.length) % verts.length];
    const next = verts[(i + 1) % verts.length];
    const dir: Vec = [next[0] - prev[0], next[1] - prev[1]];
    const l = Math.hypot(dir[0], dir[1]) || 1;
    const edge = Math.hypot(next[0] - v[0], next[1] - v[1]);
    const k = (rounding * edge) / 2;
    const u: Vec = [(dir[0] / l) * k, (dir[1] / l) * k];
    return {
      x: v[0],
      y: v[1],
      in: [v[0] - u[0], v[1] - u[1]],
      out: [v[0] + u[0], v[1] + u[1]],
      kind: 'symmetric',
    };
  });
  return [{ closed: true, nodes }];
}

/** Recompute handles for nodes of kind 'auto' (Catmull-Rom style, one third of the neighbor span). */
export function applyAutoHandles(sp: Subpath): Subpath {
  const n = sp.nodes.length;
  if (!sp.nodes.some((x) => x.kind === 'auto')) return sp;
  const nodes = sp.nodes.map((cur, i) => {
    if (cur.kind !== 'auto') return cur;
    const hasPrev = sp.closed || i > 0;
    const hasNext = sp.closed || i < n - 1;
    const prev = sp.nodes[(i - 1 + n) % n];
    const next = sp.nodes[(i + 1) % n];
    if (!hasPrev || !hasNext) {
      const other = hasPrev ? prev : next;
      if (!other) return cur;
      const d: Vec = [(other.x - cur.x) / 3, (other.y - cur.y) / 3];
      return hasPrev
        ? { ...cur, in: [cur.x + d[0], cur.y + d[1]] as Vec, out: null }
        : { ...cur, out: [cur.x + d[0], cur.y + d[1]] as Vec, in: null };
    }
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    const dPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y) / 3;
    const dNext = Math.hypot(next.x - cur.x, next.y - cur.y) / 3;
    return {
      ...cur,
      in: [cur.x - (tx / tl) * dPrev, cur.y - (ty / tl) * dPrev] as Vec,
      out: [cur.x + (tx / tl) * dNext, cur.y + (ty / tl) * dNext] as Vec,
    };
  });
  return { closed: sp.closed, nodes };
}
