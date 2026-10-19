/* Parametric shapes for the Shapes tool. Every shape is generated inside its box (0,0)–(w,h) from a small
   set of parameters, so it stays editable like a rectangle keeps its corner radius. Holes (donut, frame,
   cog) are separate subpaths painted with the even-odd rule. */
import type { PathNode, Subpath, Vec } from '../types';
import { applyAutoHandles } from './shapes';

export type ShapeKind =
  | 'triangle'
  | 'diamond'
  | 'trapezoid'
  | 'parallelogram'
  | 'gem'
  | 'doubleStar'
  | 'squareStar'
  | 'flower'
  | 'cog'
  | 'arrow'
  | 'chevron'
  | 'cross'
  | 'bolt'
  | 'donut'
  | 'frame'
  | 'pie'
  | 'arc'
  | 'segment'
  | 'crescent'
  | 'cloud'
  | 'calloutRect'
  | 'calloutEllipse'
  | 'tear'
  | 'heart'
  | 'shield'
  | 'spiral';

export type ShapeParams = Record<string, number | boolean>;

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (p: ShapeParams, k: string, d: number) =>
  typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : d;

/** Small path builder with elliptical arcs approximated by cubics (≤ 90° per segment). */
class PathBuilder {
  subpaths: Subpath[] = [];
  private cur: PathNode[] | null = null;

  private get last(): PathNode | null {
    return this.cur?.[this.cur.length - 1] ?? null;
  }

  move(x: number, y: number) {
    this.cur = [{ x, y, in: null, out: null, kind: 'sharp' }];
    this.subpaths.push({ closed: false, nodes: this.cur });
    return this;
  }

  line(x: number, y: number) {
    const l = this.last;
    if (!this.cur || !l) return this.move(x, y);
    if (Math.abs(l.x - x) < 1e-9 && Math.abs(l.y - y) < 1e-9) return this;
    this.cur.push({ x, y, in: null, out: null, kind: 'sharp' });
    return this;
  }

  cubic(c1: Vec, c2: Vec, x: number, y: number) {
    const l = this.last;
    if (!this.cur || !l) this.move(x, y);
    else {
      l.out = c1;
      this.cur.push({ x, y, in: c2, out: null, kind: 'sharp' });
    }
    return this;
  }

  /** Arc of the ellipse (cx, cy, rx, ry) from angle a0 to a1 (radians, y-down; a1 < a0 runs backwards). */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
    const pt = (a: number): Vec => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const start = pt(a0);
    if (!this.cur) this.move(start[0], start[1]);
    else this.line(start[0], start[1]);
    const sweep = a1 - a0;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const d = sweep / n;
    const k = (4 / 3) * Math.tan(d / 4);
    for (let i = 0; i < n; i++) {
      const s = a0 + d * i;
      const e = s + d;
      const p0 = pt(s);
      const p3 = pt(e);
      this.cubic(
        [p0[0] - k * rx * Math.sin(s), p0[1] + k * ry * Math.cos(s)],
        [p3[0] + k * rx * Math.sin(e), p3[1] - k * ry * Math.cos(e)],
        p3[0],
        p3[1],
      );
    }
    return this;
  }

  poly(points: Vec[]) {
    points.forEach(([x, y], i) => (i ? this.line(x, y) : this.move(x, y)));
    return this.close();
  }

  close() {
    const c = this.cur;
    if (c && c.length > 1) {
      const f = c[0];
      const l = c[c.length - 1];
      if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
        f.in = l.in;
        c.pop();
      }
    }
    if (c) this.subpaths[this.subpaths.length - 1].closed = true;
    this.cur = null;
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number) {
    this.cur = null;
    this.arc(cx, cy, rx, ry, 0, Math.PI * 2);
    return this.close();
  }
}

/** Points around an ellipse at the given radii, starting straight up. Radii are relative (1 = edge). */
function radial(w: number, h: number, count: number, radius: (i: number) => number, angleOffset = 0): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + angleOffset + (i * 2 * Math.PI) / count;
    const r = radius(i);
    out.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]);
  }
  return out;
}

/** Scalloped outline (flower petals, cloud bumps): valleys at `valley`, arcs bulging out to the edge. */
function scallops(b: PathBuilder, w: number, h: number, spans: number[], valley: number) {
  const total = spans.reduce((s, x) => s + x, 0);
  const rx = w / 2;
  const ry = h / 2;
  let a = -Math.PI / 2;
  const at = (ang: number, r: number): Vec => [rx + Math.cos(ang) * r * rx, ry + Math.sin(ang) * r * ry];
  spans.forEach((sp, i) => {
    const span = (sp / total) * Math.PI * 2;
    const a1 = a + span;
    // Control radius so the bump peaks at the edge (cubic midpoint ≈ ¼·valley + ¾·Rc·cos(0.3·span)).
    const rc = (1 - 0.25 * valley) / (0.75 * Math.cos(0.3 * span));
    const p0 = at(a, valley);
    if (i === 0) b.move(p0[0], p0[1]);
    const p3 = at(a1, valley);
    b.cubic(at(a + span * 0.2, rc), at(a + span * 0.8, rc), p3[0], p3[1]);
    a = a1;
  });
  b.close();
}

export function shapeSubpaths(
  kind: ShapeKind,
  width: number,
  height: number,
  params: ShapeParams = {},
): Subpath[] {
  const w = Math.max(Math.abs(width), 1e-6);
  const h = Math.max(Math.abs(height), 1e-6);
  const cx = w / 2;
  const cy = h / 2;
  const m = Math.min(w, h);
  const b = new PathBuilder();
  const p = (k: string, d: number) => num(params, k, d);
  switch (kind) {
    case 'triangle': {
      const apex = clamp(p('apex', 0.5), 0, 1);
      b.poly([
        [apex * w, 0],
        [w, h],
        [0, h],
      ]);
      break;
    }
    case 'diamond': {
      const mid = clamp(p('middle', 0.5), 0.05, 0.95) * h;
      b.poly([
        [cx, 0],
        [w, mid],
        [cx, h],
        [0, mid],
      ]);
      break;
    }
    case 'trapezoid': {
      const inset = ((1 - clamp(p('top', 0.6), 0, 1)) * w) / 2;
      b.poly([
        [inset, 0],
        [w - inset, 0],
        [w, h],
        [0, h],
      ]);
      break;
    }
    case 'parallelogram': {
      const off = clamp(p('slant', 0.25), -0.95, 0.95) * w;
      b.poly(
        off >= 0
          ? [
              [off, 0],
              [w, 0],
              [w - off, h],
              [0, h],
            ]
          : [
              [0, 0],
              [w + off, 0],
              [w, h],
              [-off, h],
            ],
      );
      break;
    }
    case 'gem': {
      const girdle = clamp(p('crown', 0.35), 0.05, 0.9) * h;
      const table = ((1 - clamp(p('table', 0.5), 0, 1)) * w) / 2;
      b.poly([
        [table, 0],
        [w - table, 0],
        [w, girdle],
        [cx, h],
        [0, girdle],
      ]);
      break;
    }
    case 'doubleStar': {
      const n = Math.round(clamp(p('points', 8), 3, 64));
      const inner = 1 - clamp(p('depth', 0.5), 0, 0.98);
      const second = clamp(p('secondary', 0.7), 0.05, 1);
      b.poly(radial(w, h, n * 4, (i) => (i % 4 === 0 ? 1 : i % 4 === 2 ? second : inner)));
      break;
    }
    case 'squareStar': {
      const n = Math.round(clamp(p('points', 8), 3, 32));
      const inner = 1 - clamp(p('depth', 0.35), 0, 0.98);
      const tip = clamp(p('tip', 0.5), 0.05, 0.95);
      const step = (2 * Math.PI) / n;
      const pts: Vec[] = [];
      const at = (a: number, r: number): Vec => [
        cx + (Math.cos(a) * r * w) / 2,
        cy + (Math.sin(a) * r * h) / 2,
      ];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * step;
        const half = (step / 2) * tip;
        pts.push(at(a - half / 2, 1), at(a + half / 2, 1), at(a + step / 2, inner));
      }
      b.poly(pts);
      break;
    }
    case 'flower': {
      const n = Math.round(clamp(p('petals', 6), 3, 32));
      scallops(b, w, h, Array(n).fill(1), 1 - clamp(p('depth', 0.35), 0.02, 0.95));
      break;
    }
    case 'cloud': {
      const n = Math.round(clamp(p('bumps', 9), 5, 32));
      const vary = clamp(p('variety', 0.45), 0, 1);
      scallops(
        b,
        w,
        h,
        Array.from({ length: n }, (_, i) => 1 - vary * (i % 2 ? 0.45 : 0) - vary * (i % 3 === 2 ? 0.2 : 0)),
        1 - clamp(p('bulge', 0.18), 0.02, 0.6),
      );
      break;
    }
    case 'cog': {
      const n = Math.round(clamp(p('teeth', 10), 4, 64));
      const rv = 1 - clamp(p('depth', 0.18), 0.02, 0.6);
      const tw = clamp(p('toothWidth', 0.45), 0.1, 0.9);
      const span = (2 * Math.PI) / n;
      const at = (a: number, r: number): Vec => [
        cx + (Math.cos(a) * r * w) / 2,
        cy + (Math.sin(a) * r * h) / 2,
      ];
      const pts: Vec[] = [];
      for (let i = 0; i < n; i++) {
        const base = -Math.PI / 2 + i * span - (span * tw) / 2;
        const flank = span * 0.08;
        pts.push(
          at(base - flank, rv),
          at(base, 1),
          at(base + span * tw, 1),
          at(base + span * tw + flank, rv),
        );
      }
      b.poly(pts);
      const hole = clamp(p('hole', 0.3), 0, 0.9);
      if (hole > 0.01) b.ellipse(cx, cy, (w / 2) * hole * rv, (h / 2) * hole * rv);
      break;
    }
    case 'arrow': {
      const both = params.double === true;
      const hl = Math.min(clamp(p('head', 0.35), 0.02, 1) * w, both ? w / 2 : w);
      const st = ((1 - clamp(p('shaft', 0.4), 0.02, 1)) * h) / 2;
      const sb = h - st;
      b.poly(
        both
          ? [
              [0, cy],
              [hl, 0],
              [hl, st],
              [w - hl, st],
              [w - hl, 0],
              [w, cy],
              [w - hl, h],
              [w - hl, sb],
              [hl, sb],
              [hl, h],
            ]
          : [
              [0, st],
              [w - hl, st],
              [w - hl, 0],
              [w, cy],
              [w - hl, h],
              [w - hl, sb],
              [0, sb],
            ],
      );
      break;
    }
    case 'chevron': {
      const d = Math.min(clamp(p('depth', 0.35), 0, 1) * h, w * 0.95);
      b.poly([
        [0, 0],
        [w - d, 0],
        [w, cy],
        [w - d, h],
        [0, h],
        [d, cy],
      ]);
      break;
    }
    case 'cross': {
      const t = (clamp(p('thickness', 0.33), 0.02, 1) * m) / 2;
      b.poly([
        [cx - t, 0],
        [cx + t, 0],
        [cx + t, cy - t],
        [w, cy - t],
        [w, cy + t],
        [cx + t, cy + t],
        [cx + t, h],
        [cx - t, h],
        [cx - t, cy + t],
        [0, cy + t],
        [0, cy - t],
        [cx - t, cy - t],
      ]);
      break;
    }
    case 'bolt': {
      const s = clamp(p('slant', 0.5), 0, 1);
      const pts: Vec[] = [
        [0.62, 0],
        [0.12 + 0.1 * (1 - s), 0.56],
        [0.46, 0.56],
        [0.32 - 0.12 * s, 1],
        [0.88 - 0.1 * (1 - s), 0.42],
        [0.54, 0.42],
        [0.8, 0],
      ];
      b.poly(pts.map(([x, y]) => [x * w, y * h]));
      break;
    }
    case 'donut': {
      const hole = clamp(p('hole', 0.5), 0.02, 0.98);
      b.ellipse(cx, cy, w / 2, h / 2);
      b.ellipse(cx, cy, (w / 2) * hole, (h / 2) * hole);
      break;
    }
    case 'frame': {
      const t = clamp(p('thickness', 0.15), 0.01, 0.49) * m;
      b.poly([
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]);
      b.poly([
        [t, t],
        [w - t, t],
        [w - t, h - t],
        [t, h - t],
      ]);
      break;
    }
    case 'pie': {
      const start = p('start', -90) * DEG;
      const sweep = clamp(p('sweep', 270), 1, 359.9) * DEG;
      b.move(cx, cy);
      b.arc(cx, cy, w / 2, h / 2, start, start + sweep).close();
      break;
    }
    case 'arc': {
      const start = p('start', 180) * DEG;
      const sweep = clamp(p('sweep', 180), 1, 359.9) * DEG;
      const k = 1 - clamp(p('thickness', 0.3), 0.02, 0.98);
      b.arc(cx, cy, w / 2, h / 2, start, start + sweep);
      b.arc(cx, cy, (w / 2) * k, (h / 2) * k, start + sweep, start).close();
      break;
    }
    case 'segment': {
      // Keep `amount` of the ellipse's height, measured from the bottom, cut by a straight chord.
      const amount = clamp(p('amount', 0.5), 0.02, 0.98);
      const chordY = h * (1 - amount);
      const a = Math.asin(clamp((chordY - cy) / (h / 2), -1, 1));
      b.arc(cx, cy, w / 2, h / 2, a, Math.PI - a).close();
      break;
    }
    case 'crescent': {
      // Unit circle minus a circle of radius r centered at (d, 0); traced explicitly so no even-odd artifacts.
      const r = clamp(p('inner', 0.85), 0.2, 1.4);
      const d = clamp(p('offset', 0.45), 0.05, 1.9);
      const xi = (1 - r * r + d * d) / (2 * d);
      if (Math.abs(xi) >= 1) {
        b.ellipse(cx, cy, w / 2, h / 2);
        break;
      }
      const yi = Math.sqrt(1 - xi * xi);
      const top = Math.atan2(-yi, xi);
      const bottom = Math.atan2(yi, xi);
      b.arc(cx, cy, w / 2, h / 2, bottom, top + 2 * Math.PI);
      const icx = cx + (d * w) / 2;
      const i1 = Math.atan2(-yi, xi - d);
      const i2 = Math.atan2(yi, xi - d);
      b.arc(icx, cy, (r * w) / 2, (r * h) / 2, i1, i2 - 2 * Math.PI).close();
      break;
    }
    case 'calloutRect': {
      const tl = clamp(p('tailLength', 0.25), 0.02, 0.8) * h;
      const bh = h - tl;
      const r = Math.min(clamp(p('radius', 0.12), 0, 0.5) * m, bh / 2, w / 2);
      const tw = clamp(p('tailWidth', 0.18), 0.02, 0.9) * w;
      const bx = clamp(clamp(p('tailX', 0.3), 0, 1) * w, r + tw / 2, w - r - tw / 2);
      const tip = bx - tw / 2 + clamp(p('tailSkew', 0), -1, 1) * w * 0.25;
      b.move(r, 0).line(w - r, 0);
      if (r) b.arc(w - r, r, r, r, -Math.PI / 2, 0);
      b.line(w, bh - r);
      if (r) b.arc(w - r, bh - r, r, r, 0, Math.PI / 2);
      b.line(bx + tw / 2, bh)
        .line(tip, h)
        .line(bx - tw / 2, bh)
        .line(r, bh);
      if (r) b.arc(r, bh - r, r, r, Math.PI / 2, Math.PI);
      b.line(0, r);
      if (r) b.arc(r, r, r, r, Math.PI, Math.PI * 1.5);
      b.close();
      break;
    }
    case 'calloutEllipse': {
      const tl = clamp(p('tailLength', 0.25), 0.02, 0.8) * h;
      const bh = h - tl;
      const ery = bh / 2;
      const ecy = ery;
      const pos = clamp(p('tailX', 0.3), 0, 1);
      const a = Math.PI / 2 + (0.5 - pos) * (Math.PI / 1.6);
      const half = (clamp(p('tailWidth', 0.18), 0.02, 0.9) * Math.PI) / 2;
      b.arc(cx, ecy, w / 2, ery, a + half, a - half + 2 * Math.PI);
      b.line(clamp(pos, 0, 1) * w * 0.9 + w * 0.02, h).close();
      break;
    }
    case 'tear': {
      // Tip at the top, round bottom. `point` makes the tip longer.
      const rr = 0.85 - clamp(p('point', 0.5), 0, 1) * 0.45;
      const c = 1 - rr;
      const D = c + 1;
      const alpha = Math.asin(rr / D);
      const ux = (x: number) => cx + (x / rr) * (w / 2);
      const uy = (y: number) => ((y + 1) / 2) * h;
      const tr: Vec = [Math.cos(-alpha) * rr, c + Math.sin(-alpha) * rr];
      b.move(cx, 0).line(ux(tr[0]), uy(tr[1]));
      b.arc(cx, uy(c), w / 2, (rr * h) / 2, -alpha, Math.PI + alpha);
      b.close();
      break;
    }
    case 'heart': {
      const dip = 0.12 + clamp(p('cleft', 0.5), 0, 1) * 0.22;
      const P = (x: number, y: number): Vec => [x * w, y * h];
      const s = P(0.5, dip);
      b.move(s[0], s[1]);
      const c = (a: Vec, bb: Vec, e: Vec) => b.cubic(P(...a), P(...bb), ...P(...e));
      c([0.5, dip - 0.12], [0.38, 0], [0.26, 0]);
      c([0.1, 0], [0, 0.13], [0, 0.32]);
      c([0, 0.58], [0.3, 0.76], [0.5, 1]);
      c([0.7, 0.76], [1, 0.58], [1, 0.32]);
      c([1, 0.13], [0.9, 0], [0.74, 0]);
      c([0.62, 0], [0.5, dip - 0.12], [0.5, dip]);
      b.close();
      break;
    }
    case 'shield': {
      const k = clamp(1 - p('point', 0.55), 0.05, 0.95) * h;
      b.move(0, 0).line(w, 0).line(w, k);
      b.cubic([w, k + (h - k) * 0.55], [w * 0.78, h * 0.9], cx, h);
      b.cubic([w * 0.22, h * 0.9], [0, k + (h - k) * 0.55], 0, k);
      b.close();
      break;
    }
    case 'spiral': {
      const turns = clamp(p('turns', 3), 0.5, 12);
      const inner = clamp(p('inner', 0.08), 0, 0.9);
      const steps = Math.max(4, Math.round(turns * 8));
      const nodes: PathNode[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = -Math.PI / 2 + t * turns * 2 * Math.PI;
        const r = inner + (1 - inner) * t;
        nodes.push({
          x: cx + (Math.cos(a) * r * w) / 2,
          y: cy + (Math.sin(a) * r * h) / 2,
          in: null,
          out: null,
          kind: 'auto',
        });
      }
      const sp = applyAutoHandles({ closed: false, nodes });
      return [{ closed: false, nodes: sp.nodes.map((n) => ({ ...n, kind: 'smooth' })) }];
    }
  }
  return b.subpaths;
}
