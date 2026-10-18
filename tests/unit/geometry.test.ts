import { describe, expect, it } from 'vitest';
import {
  cubicBounds,
  insertNodeAt,
  nearestOnSubpath,
  split,
  subpathsBounds,
  pointAt,
} from '../../src/core/geometry/bezier';
import { parsePathData, toPathData, arcToCubics } from '../../src/core/geometry/pathdata';
import { ellipseSubpaths, rectSubpaths, starSubpaths, uniformCorners } from '../../src/core/geometry/shapes';
import { fitCurve, simplifySubpath } from '../../src/core/geometry/fit';
import type { Cubic } from '../../src/core/geometry/bezier';
import type { Vec } from '../../src/core/types';

const near = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('bezier', () => {
  const c: Cubic = [
    [0, 0],
    [0, 100],
    [100, 100],
    [100, 0],
  ];
  it('computes tight bounds including extrema', () => {
    const b = cubicBounds(c);
    near(b.x, 0);
    near(b.width, 100);
    near(b.height, 75);
  });
  it('splits preserving the curve', () => {
    const [l, r] = split(c, 0.3);
    const p = pointAt(c, 0.3);
    near(l[3][0], p[0]);
    near(l[3][1], p[1]);
    expect(r[0]).toEqual(l[3]);
    const q = pointAt(l, 0.5);
    const expected = pointAt(c, 0.15);
    near(q[0], expected[0]);
    near(q[1], expected[1]);
  });
  it('finds the nearest point', () => {
    const sp = {
      closed: false,
      nodes: [
        { x: 0, y: 0, in: null, out: null, kind: 'sharp' as const },
        { x: 100, y: 0, in: null, out: null, kind: 'sharp' as const },
      ],
    };
    const hit = nearestOnSubpath(sp, [40, 10])!;
    near(hit.point[0], 40);
    near(hit.distance, 10);
  });
  it('inserts a node without changing the shape', () => {
    const sp = parsePathData('M0 0C0 100 100 100 100 0')[0];
    const out = insertNodeAt(sp, 0, 0.5);
    expect(out.nodes).toHaveLength(3);
    near(out.nodes[1].x, 50);
    near(out.nodes[1].y, 75);
    const before = subpathsBounds([sp])!;
    const after = subpathsBounds([out])!;
    near(before.height, after.height);
  });
});

describe('path data', () => {
  it('round-trips lines and curves', () => {
    const d = 'M0 0L100 0C150 0 150 100 100 100L0 100Z';
    const sps = parsePathData(d);
    expect(sps).toHaveLength(1);
    expect(sps[0].closed).toBe(true);
    expect(toPathData(sps)).toBe(d);
  });
  it('handles relative commands, H/V and implicit repeats', () => {
    const sps = parsePathData('m10 10 h20 v20 l-20 0 z m50 0 10 0');
    expect(sps).toHaveLength(2);
    expect(sps[0].nodes.map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);
    expect(sps[1].nodes.map((n) => [n.x, n.y])).toEqual([
      [60, 10],
      [70, 10],
    ]);
  });
  it('converts quadratic and smooth curves to cubics', () => {
    const [sp] = parsePathData('M0 0Q50 100 100 0T200 0');
    expect(sp.nodes).toHaveLength(3);
    near(sp.nodes[0].out![1], 66.6667);
    near(sp.nodes[2].in![1], -66.6667);
  });
  it('parses compact arc flags', () => {
    const [sp] = parsePathData('M0 0a50 50 0 1150 50');
    expect(sp.nodes[sp.nodes.length - 1].x).toBeCloseTo(50);
    expect(sp.nodes[sp.nodes.length - 1].y).toBeCloseTo(50);
  });
  it('arcs land on the ellipse', () => {
    const segs = arcToCubics(100, 0, 100, 100, 0, false, true, 0, 100);
    const end = segs[segs.length - 1][2];
    near(end[0], 0);
    near(end[1], 100);
  });
});

describe('shapes', () => {
  it('builds a plain rectangle with 4 nodes', () => {
    const [sp] = rectSubpaths({ width: 10, height: 20, corners: uniformCorners(0) });
    expect(sp.nodes).toHaveLength(4);
  });
  it('rounded corners keep the bounds', () => {
    const b = subpathsBounds(rectSubpaths({ width: 100, height: 50, corners: uniformCorners(10) }))!;
    near(b.width, 100);
    near(b.height, 50);
  });
  it('clamps radius to half the short side', () => {
    const [sp] = rectSubpaths({ width: 100, height: 20, corners: uniformCorners(50) });
    near(sp.nodes[0].y, 10);
  });
  it('ellipse bounds match radii', () => {
    const b = subpathsBounds(ellipseSubpaths({ rx: 30, ry: 20 }))!;
    near(b.x, -30);
    near(b.width, 60);
    near(b.height, 40);
  });
  it('pie adds a center node and closes', () => {
    const [sp] = ellipseSubpaths({ rx: 10, ry: 10, arcStart: 0, arcEnd: 90, pie: true });
    expect(sp.closed).toBe(true);
    expect(sp.nodes[sp.nodes.length - 1]).toMatchObject({ x: 0, y: 0 });
  });
  it('star has 2n points, polygon n', () => {
    expect(
      starSubpaths({ points: 5, outerRadius: 10, innerRatio: 0.5, rounding: 0, polygon: false })[0].nodes,
    ).toHaveLength(10);
    expect(
      starSubpaths({ points: 6, outerRadius: 10, innerRatio: 0.5, rounding: 0, polygon: true })[0].nodes,
    ).toHaveLength(6);
  });
});

describe('curve fitting', () => {
  it('fits a sampled arc with few nodes', () => {
    const pts: Vec[] = [];
    for (let i = 0; i <= 100; i++) {
      const a = (i / 100) * Math.PI;
      pts.push([Math.cos(a) * 100, Math.sin(a) * 100]);
    }
    const sp = fitCurve(pts, 1);
    expect(sp.nodes.length).toBeLessThanOrEqual(4);
    near(sp.nodes[0].x, 100);
    near(sp.nodes[sp.nodes.length - 1].x, -100);
  });
  it('simplify reduces nodes on an over-noded path', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({
      x: i * 5,
      y: Math.sin(i / 6) * 40,
      in: null,
      out: null,
      kind: 'sharp' as const,
    }));
    const out = simplifySubpath({ closed: false, nodes }, 1.5);
    expect(out.nodes.length).toBeLessThan(nodes.length);
  });
});
