import { describe, expect, it } from 'vitest';
import {
  applyWorldDelta,
  normalizeNode,
  rectToRect,
  rotateAbout,
  selectionBounds,
  selectionBox,
  selectionRotation,
} from '../../src/core/transform';
import {
  createDocument,
  makeEllipse,
  makeGroup,
  makePath,
  makeRect,
  makeText,
} from '../../src/core/document';
import { parsePathData } from '../../src/core/geometry/pathdata';
import { uniformCorners } from '../../src/core/geometry/shapes';
import type { RectNode } from '../../src/core/types';

function docWith(...nodes: Parameters<typeof makeGroup>[0]) {
  const d = createDocument({ width: 500, height: 500, units: 'pt' });
  d.artboards[0].children.push(...nodes);
  return d;
}

describe('transforms', () => {
  it('scales rectangles parametrically and keeps corner radii', () => {
    const r = makeRect(0, 0, 100, 50);
    r.corners = uniformCorners(10);
    const d = docWith(r);
    applyWorldDelta(
      d,
      [r.id],
      rectToRect({ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 100 }),
    );
    const n = d.artboards[0].children[0] as RectNode;
    expect(n.width).toBeCloseTo(200);
    expect(n.height).toBeCloseTo(100);
    expect(n.corners[0].radius).toBe(10);
    expect(n.transform[0]).toBeCloseTo(1);
  });

  it('keeps mirroring in the transform', () => {
    const r = makeRect(0, 0, 100, 50);
    const d = docWith(r);
    applyWorldDelta(d, [r.id], [-1, 0, 0, 1, 100, 0]);
    const n = d.artboards[0].children[0] as RectNode;
    expect(n.width).toBe(100);
    expect(n.transform[0]).toBeCloseTo(-1);
    expect(selectionBounds(d, [r.id])).toMatchObject({ x: 0, width: 100 });
  });

  it('bakes scale into path nodes but keeps rotation', () => {
    const p = makePath(parsePathData('M0 0L10 0L10 10Z'));
    const d = docWith(p);
    applyWorldDelta(d, [p.id], [2, 0, 0, 2, 0, 0]);
    applyWorldDelta(d, [p.id], rotateAbout(Math.PI / 2, 0, 0));
    const n = d.artboards[0].children[0];
    expect(n.type === 'path' && n.subpaths[0].nodes[1].x).toBeCloseTo(20);
    expect(selectionRotation(d, [p.id])).toBeCloseTo(90);
  });

  it('scales text font size uniformly', () => {
    const t = makeText(0, 0, 'Hi');
    const d = docWith(t);
    applyWorldDelta(d, [t.id], [2, 0, 0, 2, 0, 0]);
    const n = d.artboards[0].children[0];
    expect(n.type === 'text' && n.runs[0].size).toBe(48);
  });

  it('pushes group scale down to children', () => {
    const e = makeEllipse(10, 10, 10, 10);
    const g = makeGroup([e]);
    const d = docWith(g);
    applyWorldDelta(d, [g.id], [3, 0, 0, 3, 0, 0]);
    const kid = (d.artboards[0].children[0] as { children: { rx: number }[] }).children[0];
    expect(kid.rx).toBeCloseTo(30);
    expect(selectionBounds(d, [g.id])).toMatchObject({ x: 0, width: 60 });
  });

  it('builds an oriented box for a single rotated object', () => {
    const r = makeRect(0, 0, 100, 50);
    const d = docWith(r);
    applyWorldDelta(d, [r.id], rotateAbout(0.5, 50, 25));
    const box = selectionBox(d, [r.id])!;
    expect(box.rotation).toBeCloseTo(0.5);
  });

  it('normalize is a no-op without scale', () => {
    const r = makeRect(5, 5, 10, 10);
    const before = structuredClone(r);
    normalizeNode(r);
    expect(r).toEqual(before);
  });
});
