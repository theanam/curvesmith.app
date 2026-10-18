import type { PathNode, Subpath, Vec } from '../types';

const fmt = (n: number, digits: number) => {
  const f = Math.pow(10, digits);
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Serialize subpaths to SVG path data. Lines are written as L, curves as C. */
export function toPathData(subpaths: Subpath[], digits = 3): string {
  const parts: string[] = [];
  const p = (v: Vec | [number, number]) => `${fmt(v[0], digits)} ${fmt(v[1], digits)}`;
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    const first = sp.nodes[0];
    parts.push(`M${p([first.x, first.y])}`);
    const n = sp.nodes.length;
    const count = sp.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      if (!a.out && !b.in) {
        if (sp.closed && i === n - 1) break; // closing line is implied by Z
        parts.push(`L${p([b.x, b.y])}`);
      } else {
        const c1: Vec = a.out ?? [a.x, a.y];
        const c2: Vec = b.in ?? [b.x, b.y];
        parts.push(`C${p(c1)} ${p(c2)} ${p([b.x, b.y])}`);
      }
    }
    if (sp.closed) parts.push('Z');
  }
  return parts.join('');
}

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      out.push(ch);
      i++;
      continue;
    }
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) {
      i++;
      continue;
    }
    out.push(parseFloat(m[0]));
    i = NUM.lastIndex;
  }
  return out;
}

/** Arc flags may be written without separators ("a1 1 0 00 1 1"); read single digits for them. */
function tokenizeWithFlags(d: string): (string | number)[] {
  const raw = d.replace(/([Aa])/g, ' $1 ');
  const tokens: (string | number)[] = [];
  let mode = '';
  let argIndex = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      tokens.push(ch);
      mode = ch;
      argIndex = 0;
      i++;
      continue;
    }
    if (
      (mode === 'A' || mode === 'a') &&
      (argIndex % 7 === 3 || argIndex % 7 === 4) &&
      (ch === '0' || ch === '1')
    ) {
      tokens.push(ch === '1' ? 1 : 0);
      argIndex++;
      i++;
      continue;
    }
    NUM.lastIndex = i;
    const m = NUM.exec(raw);
    if (!m) {
      i++;
      continue;
    }
    tokens.push(parseFloat(m[0]));
    argIndex++;
    i = NUM.lastIndex;
  }
  return tokens;
}

/** Convert an SVG elliptical arc to cubic segments (endpoint parameterization, SVG spec F.6). */
export function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): [Vec, Vec, Vec][] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2))
    return [
      [
        [x1, y1],
        [x2, y2],
        [x2, y2],
      ],
    ];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / n;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: [Vec, Vec, Vec][] = [];
  let a = theta1;
  const pt = (ang: number): Vec => {
    const ex = rx * Math.cos(ang);
    const ey = ry * Math.sin(ang);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
  };
  const deriv = (ang: number): Vec => {
    const ex = -rx * Math.sin(ang);
    const ey = ry * Math.cos(ang);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  for (let i = 0; i < n; i++) {
    const b = a + delta;
    const p0 = pt(a);
    const p3 = pt(b);
    const d0 = deriv(a);
    const d3 = deriv(b);
    out.push([[p0[0] + t * d0[0], p0[1] + t * d0[1]], [p3[0] - t * d3[0], p3[1] - t * d3[1]], p3]);
    a = b;
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Parse SVG path data into subpaths (absolute coordinates, cubic handles). */
export function parsePathData(d: string): Subpath[] {
  const tokens = /[Aa]/.test(d) ? tokenizeWithFlags(d) : tokenize(d);
  const subpaths: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrl: Vec | null = null;
  let lastQuad: Vec | null = null;
  let cmd = '';
  let i = 0;

  const num = () => {
    const v = tokens[i++];
    return typeof v === 'number' ? v : NaN;
  };
  const hasNum = () => typeof tokens[i] === 'number';

  const lastNode = (): PathNode => cur!.nodes[cur!.nodes.length - 1];
  const ensure = () => {
    if (!cur) {
      cur = { closed: false, nodes: [{ x, y, in: null, out: null, kind: 'sharp' }] };
      subpaths.push(cur);
    }
  };
  const lineTo = (nx: number, ny: number) => {
    ensure();
    cur!.nodes.push({ x: nx, y: ny, in: null, out: null, kind: 'sharp' });
    x = nx;
    y = ny;
  };
  const curveTo = (c1: Vec, c2: Vec, nx: number, ny: number) => {
    ensure();
    lastNode().out = c1;
    cur!.nodes.push({ x: nx, y: ny, in: c2, out: null, kind: 'sharp' });
    x = nx;
    y = ny;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'Z') {
      if (cur) {
        const c: Subpath = cur;
        // Merge a duplicated closing node into the first one.
        if (c.nodes.length > 1) {
          const f = c.nodes[0];
          const l = c.nodes[c.nodes.length - 1];
          if (close(f.x, l.x) && close(f.y, l.y)) {
            f.in = l.in;
            c.nodes.pop();
          }
        }
        c.closed = true;
      }
      x = startX;
      y = startY;
      cur = null;
      lastCtrl = lastQuad = null;
      if (typeof tokens[i] !== 'string') cmd = '';
      continue;
    }
    if (!hasNum()) {
      i++;
      continue;
    }
    switch (C) {
      case 'M': {
        const nx = num() + ox;
        const ny = num() + oy;
        cur = { closed: false, nodes: [{ x: nx, y: ny, in: null, out: null, kind: 'sharp' }] };
        subpaths.push(cur);
        x = startX = nx;
        y = startY = ny;
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQuad = null;
        break;
      }
      case 'L':
        lineTo(num() + ox, num() + oy);
        lastCtrl = lastQuad = null;
        break;
      case 'H':
        lineTo(num() + ox, y);
        lastCtrl = lastQuad = null;
        break;
      case 'V':
        lineTo(x, num() + oy);
        lastCtrl = lastQuad = null;
        break;
      case 'C': {
        const c1: Vec = [num() + ox, num() + oy];
        const c2: Vec = [num() + ox, num() + oy];
        const nx = num() + ox;
        const ny = num() + oy;
        curveTo(c1, c2, nx, ny);
        lastCtrl = c2;
        lastQuad = null;
        break;
      }
      case 'S': {
        const c1: Vec = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const c2: Vec = [num() + ox, num() + oy];
        const nx = num() + ox;
        const ny = num() + oy;
        curveTo(c1, c2, nx, ny);
        lastCtrl = c2;
        lastQuad = null;
        break;
      }
      case 'Q': {
        const q: Vec = [num() + ox, num() + oy];
        const nx = num() + ox;
        const ny = num() + oy;
        curveTo(
          [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)],
          [nx + (2 / 3) * (q[0] - nx), ny + (2 / 3) * (q[1] - ny)],
          nx,
          ny,
        );
        lastQuad = q;
        lastCtrl = null;
        break;
      }
      case 'T': {
        const q: Vec = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        const nx = num() + ox;
        const ny = num() + oy;
        curveTo(
          [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)],
          [nx + (2 / 3) * (q[0] - nx), ny + (2 / 3) * (q[1] - ny)],
          nx,
          ny,
        );
        lastQuad = q;
        lastCtrl = null;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const phi = num();
        const large = num() !== 0;
        const sw = num() !== 0;
        const nx = num() + ox;
        const ny = num() + oy;
        for (const [c1, c2, p] of arcToCubics(x, y, rx, ry, phi, large, sw, nx, ny)) {
          if (c1[0] === p[0] && c1[1] === p[1] && c2[0] === p[0] && c2[1] === p[1]) lineTo(p[0], p[1]);
          else curveTo(c1, c2, p[0], p[1]);
        }
        lastCtrl = lastQuad = null;
        break;
      }
      default:
        i++;
    }
  }
  // Classify node kinds from handle geometry.
  for (const sp of subpaths) for (const n of sp.nodes) n.kind = classifyNode(n);
  return subpaths.filter((sp) => sp.nodes.length > 0);
}

/** Infer a node kind from its handles: collinear handles are smooth, equal-length collinear are symmetric. */
export function classifyNode(n: PathNode): PathNode['kind'] {
  if (!n.in || !n.out) return 'sharp';
  const a: Vec = [n.in[0] - n.x, n.in[1] - n.y];
  const b: Vec = [n.out[0] - n.x, n.out[1] - n.y];
  const la = Math.hypot(a[0], a[1]);
  const lb = Math.hypot(b[0], b[1]);
  if (la < 1e-6 || lb < 1e-6) return 'sharp';
  const cross = (a[0] * b[1] - a[1] * b[0]) / (la * lb);
  const dotp = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
  if (Math.abs(cross) < 0.01 && dotp < 0)
    return Math.abs(la - lb) < 0.01 * Math.max(la, lb) ? 'symmetric' : 'smooth';
  return 'sharp';
}
