/* Stroke decorations shared by the canvas renderer and every exporter, so they look identical:
   - width profiles become a filled outline polygon (the base stroke is then not drawn);
   - arrowheads become filled subpaths at the open ends. */
import type { ArrowKind, StrokeItem, Subpath, Vec } from '../types';
import { flattenSubpath, normalize, sub } from './bezier';

const poly = (points: Vec[], closed = true): Subpath => ({
  closed,
  nodes: points.map(([x, y]) => ({ x, y, in: null, out: null, kind: 'sharp' })),
});

export function profileScale(profile: [number, number][], t: number): number {
  if (!profile.length) return 1;
  const pts = [...profile].sort((a, b) => a[0] - b[0]);
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, s0] = pts[i - 1];
      const [t1, s1] = pts[i];
      const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      // Smoothstep between profile points reads more naturally than linear.
      const k = u * u * (3 - 2 * u);
      return s0 + (s1 - s0) * k;
    }
  }
  return pts[pts.length - 1][1];
}

/** Variable-width outline for a stroke with a width profile (one filled subpath per input subpath). */
export function profileOutline(subpaths: Subpath[], width: number, profile: [number, number][]): Subpath[] {
  const out: Subpath[] = [];
  for (const sp of subpaths) {
    const pts = flattenSubpath(sp, 0.35);
    if (sp.closed && pts.length > 1) pts.push(pts[0]);
    if (pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const left: Vec[] = [];
    const right: Vec[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const d = normalize(sub(next, prev));
      const nrm: Vec = [-d[1], d[0]];
      const w = (width / 2) * profileScale(profile, cum[i] / total);
      left.push([pts[i][0] + nrm[0] * w, pts[i][1] + nrm[1] * w]);
      right.push([pts[i][0] - nrm[0] * w, pts[i][1] - nrm[1] * w]);
    }
    out.push(poly([...left, ...right.reverse()]));
  }
  return out;
}

function arrowAt(tip: Vec, dir: Vec, kind: ArrowKind, w: number): Subpath[] {
  const d = normalize(dir);
  const n: Vec = [-d[1], d[0]];
  const s = Math.max(w * 4, 4);
  const at = (along: number, across: number): Vec => [
    tip[0] + d[0] * along + n[0] * across,
    tip[1] + d[1] * along + n[1] * across,
  ];
  switch (kind) {
    case 'arrow':
      return [poly([at(0, 0), at(-s, s * 0.6), at(-s * 0.7, 0), at(-s, -s * 0.6)])];
    case 'triangle':
      return [poly([at(0, 0), at(-s, s * 0.55), at(-s, -s * 0.55)])];
    case 'square':
      return [
        poly([at(s * 0.4, s * 0.4), at(s * 0.4, -s * 0.4), at(-s * 0.4, -s * 0.4), at(-s * 0.4, s * 0.4)]),
      ];
    case 'bar':
      return [
        poly([at(w * 0.6, s * 0.6), at(w * 0.6, -s * 0.6), at(-w * 0.6, -s * 0.6), at(-w * 0.6, s * 0.6)]),
      ];
    case 'circle': {
      const r = s * 0.4;
      const k = 0.5523 * r;
      return [
        {
          closed: true,
          nodes: [
            {
              x: tip[0] + r,
              y: tip[1],
              in: [tip[0] + r, tip[1] - k],
              out: [tip[0] + r, tip[1] + k],
              kind: 'symmetric',
            },
            {
              x: tip[0],
              y: tip[1] + r,
              in: [tip[0] + k, tip[1] + r],
              out: [tip[0] - k, tip[1] + r],
              kind: 'symmetric',
            },
            {
              x: tip[0] - r,
              y: tip[1],
              in: [tip[0] - r, tip[1] + k],
              out: [tip[0] - r, tip[1] - k],
              kind: 'symmetric',
            },
            {
              x: tip[0],
              y: tip[1] - r,
              in: [tip[0] - k, tip[1] - r],
              out: [tip[0] + k, tip[1] - r],
              kind: 'symmetric',
            },
          ],
        },
      ];
    }
  }
}

/** Arrowhead shapes for the open ends of each subpath. */
export function arrowHeads(
  subpaths: Subpath[],
  stroke: Pick<StrokeItem, 'arrowStart' | 'arrowEnd' | 'width'>,
): Subpath[] {
  const out: Subpath[] = [];
  for (const sp of subpaths) {
    if (sp.closed || sp.nodes.length < 2) continue;
    const pts = flattenSubpath(sp, 0.25);
    if (stroke.arrowStart) {
      const tip = pts[0];
      const ref = pts.find((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1]) > 0.5) ?? pts[1];
      out.push(...arrowAt(tip, sub(tip, ref), stroke.arrowStart, stroke.width));
    }
    if (stroke.arrowEnd) {
      const tip = pts[pts.length - 1];
      const ref =
        [...pts].reverse().find((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1]) > 0.5) ?? pts[pts.length - 2];
      out.push(...arrowAt(tip, sub(tip, ref), stroke.arrowEnd, stroke.width));
    }
  }
  return out;
}

export const DASH_PRESETS: { label: string; dash: number[] }[] = [
  { label: 'Solid', dash: [] },
  { label: 'Dashed', dash: [6, 4] },
  { label: 'Dotted', dash: [0, 4] },
  { label: 'Long dash', dash: [12, 6] },
  { label: 'Dash dot', dash: [8, 4, 0, 4] },
];

export const PROFILE_PRESETS: { label: string; profile: [number, number][] | null }[] = [
  { label: 'Uniform', profile: null },
  {
    label: 'Taper both',
    profile: [
      [0, 0.1],
      [0.5, 1],
      [1, 0.1],
    ],
  },
  {
    label: 'Taper end',
    profile: [
      [0, 1],
      [1, 0.05],
    ],
  },
  {
    label: 'Taper start',
    profile: [
      [0, 0.05],
      [1, 1],
    ],
  },
  {
    label: 'Bulge',
    profile: [
      [0, 0.4],
      [0.5, 1.4],
      [1, 0.4],
    ],
  },
];
