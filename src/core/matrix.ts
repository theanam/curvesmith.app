import type { Matrix, Vec } from './types';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  // m ∘ n : apply n first, then m.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Matrix, p: Vec): Vec {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function applyVector(m: Matrix, v: Vec): Vec {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];
export function rotate(rad: number): Matrix {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

/** Matrix that applies `m` around a pivot point. */
export function about(m: Matrix, px: number, py: number): Matrix {
  return multiply(translate(px, py), multiply(m, translate(-px, -py)));
}

export function isIdentity(m: Matrix, eps = 1e-9): boolean {
  return IDENTITY.every((v, i) => Math.abs(m[i] - v) < eps);
}

export type Decomposed = { tx: number; ty: number; rotation: number; sx: number; sy: number; skew: number };

/** Decompose into translate · rotate · skewX · scale. Rotation in radians. */
export function decompose(m: Matrix): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const det = a * d - b * c;
  const sy = sx === 0 ? 0 : det / sx;
  const skew = sx === 0 ? 0 : Math.atan2(a * c + b * d, sx * sx);
  return { tx: e, ty: f, rotation, sx, sy, skew };
}

export function compose(d: Decomposed): Matrix {
  const r = rotate(d.rotation);
  const k: Matrix = [1, 0, Math.tan(d.skew), 1, 0, 0];
  const s = scale(d.sx, d.sy);
  return multiply(translate(d.tx, d.ty), multiply(r, multiply(k, s)));
}

export const rotationOf = (m: Matrix) => Math.atan2(m[1], m[0]);
export const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
