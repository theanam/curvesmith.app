import type { Vec } from './types';
import type { Rect } from './geometry/bezier';

export type SnapKind = 'edge' | 'center' | 'guide' | 'grid' | 'node' | 'artboard' | 'artboardCenter';
export type SnapLine = { pos: number; kind: SnapKind; span: [number, number] };
export type SnapCandidates = { xs: SnapLine[]; ys: SnapLine[]; points: Vec[] };
/** A smart guide to draw: a line at `pos` on `axis` spanning `from`→`to` (other axis), with an optional label. */
export type SmartGuide = { axis: 'x' | 'y'; pos: number; from: number; to: number; label?: string };

export type SnapSettings = { objects: boolean; guides: boolean; nodes: boolean; pixel: boolean };

export const emptyCandidates = (): SnapCandidates => ({ xs: [], ys: [], points: [] });

export function addRectCandidates(c: SnapCandidates, r: Rect, kind: 'edge' | 'artboard') {
  const ys: [number, number] = [r.y, r.y + r.height];
  const xs: [number, number] = [r.x, r.x + r.width];
  const centerKind: SnapKind = kind === 'artboard' ? 'artboardCenter' : 'center';
  c.xs.push(
    { pos: r.x, kind, span: ys },
    { pos: r.x + r.width, kind, span: ys },
    { pos: r.x + r.width / 2, kind: centerKind, span: ys },
  );
  c.ys.push(
    { pos: r.y, kind, span: xs },
    { pos: r.y + r.height, kind, span: xs },
    { pos: r.y + r.height / 2, kind: centerKind, span: xs },
  );
}

function best(
  values: number[],
  lines: SnapLine[],
  threshold: number,
): { delta: number; matches: SnapLine[]; value: number } | null {
  let bestD = Infinity;
  let res: { delta: number; matches: SnapLine[]; value: number } | null = null;
  for (const v of values) {
    for (const l of lines) {
      const d = l.pos - v;
      const ad = Math.abs(d);
      if (ad > threshold) continue;
      if (ad < bestD - 1e-9) {
        bestD = ad;
        res = { delta: d, matches: [l], value: v };
      } else if (Math.abs(ad - bestD) < 1e-9 && res && Math.abs(res.delta - d) < 1e-9) res.matches.push(l);
    }
  }
  return res;
}

const labelFor = (matches: SnapLine[]): string | undefined => {
  if (matches.some((m) => m.kind === 'artboardCenter' || m.kind === 'center')) return 'center';
  const nodes = matches.filter((m) => m.kind === 'node').length;
  if (nodes >= 2) return `${nodes + 1} nodes aligned`;
  if (matches.some((m) => m.kind === 'guide')) return 'guide';
  return undefined;
};

/** Snap a moving rectangle (edges + center). Returns the delta to add and guides to draw. */
export function snapRect(
  r: Rect,
  c: SnapCandidates,
  threshold: number,
): { dx: number; dy: number; guides: SmartGuide[] } {
  const bx = best([r.x, r.x + r.width / 2, r.x + r.width], c.xs, threshold);
  const by = best([r.y, r.y + r.height / 2, r.y + r.height], c.ys, threshold);
  const dx = bx?.delta ?? 0;
  const dy = by?.delta ?? 0;
  const guides: SmartGuide[] = [];
  if (bx) {
    const pos = bx.value + dx;
    const spans = bx.matches.flatMap((m) => m.span);
    guides.push({
      axis: 'x',
      pos,
      from: Math.min(r.y + dy, ...spans),
      to: Math.max(r.y + r.height + dy, ...spans),
      label: labelFor(bx.matches),
    });
  }
  if (by) {
    const pos = by.value + dy;
    const spans = by.matches.flatMap((m) => m.span);
    guides.push({
      axis: 'y',
      pos,
      from: Math.min(r.x + dx, ...spans),
      to: Math.max(r.x + r.width + dx, ...spans),
      label: labelFor(by.matches),
    });
  }
  return { dx, dy, guides };
}

/** Snap a single point (node editing, pen, drawing shapes). Point candidates win over lines. */
export function snapPoint(
  p: Vec,
  c: SnapCandidates,
  threshold: number,
): { point: Vec; guides: SmartGuide[]; snappedTo: 'point' | 'line' | null } {
  let bestPt: Vec | null = null;
  let bestD = threshold;
  for (const q of c.points) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= bestD) {
      bestD = d;
      bestPt = q;
    }
  }
  if (bestPt) return { point: [bestPt[0], bestPt[1]], guides: [], snappedTo: 'point' };
  const bx = best([p[0]], c.xs, threshold);
  const by = best([p[1]], c.ys, threshold);
  const point: Vec = [p[0] + (bx?.delta ?? 0), p[1] + (by?.delta ?? 0)];
  const guides: SmartGuide[] = [];
  if (bx) {
    const spans = bx.matches.flatMap((m) => m.span);
    guides.push({
      axis: 'x',
      pos: point[0],
      from: Math.min(point[1], ...spans),
      to: Math.max(point[1], ...spans),
      label: labelFor(bx.matches),
    });
  }
  if (by) {
    const spans = by.matches.flatMap((m) => m.span);
    guides.push({
      axis: 'y',
      pos: point[1],
      from: Math.min(point[0], ...spans),
      to: Math.max(point[0], ...spans),
      label: labelFor(by.matches),
    });
  }
  return { point, guides, snappedTo: bx || by ? 'line' : null };
}

/** Snap an angle (radians) to multiples of `step` when within `tolerance`. */
export function snapAngle(a: number, step = Math.PI / 12, tolerance = (3 * Math.PI) / 180): number {
  const k = Math.round(a / step) * step;
  return Math.abs(k - a) <= tolerance ? k : a;
}

/** Constrain a vector to the nearest 45° direction (Shift while drawing). */
export function constrain45(from: Vec, to: Vec): Vec {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const l = Math.hypot(dx, dy);
  return [from[0] + Math.cos(a) * l, from[1] + Math.sin(a) * l];
}

export const roundToPixel = (v: number) => Math.round(v);
