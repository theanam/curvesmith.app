import { describe, expect, it } from 'vitest';
import {
  addRectCandidates,
  constrain45,
  emptyCandidates,
  snapAngle,
  snapPoint,
  snapRect,
} from '../../src/core/snapping';
import {
  createDocument,
  makeEllipse,
  makeGroup,
  makePath,
  makeRect,
  makeText,
} from '../../src/core/document';
import { hitTest, marqueeSelect, artboardAt } from '../../src/render/hittest';
import { parsePathData } from '../../src/core/geometry/pathdata';

describe('snapping', () => {
  it('snaps rect edges and centers with labels', () => {
    const c = emptyCandidates();
    addRectCandidates(c, { x: 0, y: 0, width: 100, height: 100 }, 'artboard');
    const s = snapRect({ x: 47, y: 10, width: 10, height: 10 }, c, 5);
    expect(s.dx).toBe(-2);
    expect(s.guides[0].label).toBe('center');
  });
  it('labels aligned nodes', () => {
    const c = emptyCandidates();
    c.ys.push({ pos: 50, kind: 'node', span: [0, 0] }, { pos: 50, kind: 'node', span: [100, 100] });
    const s = snapPoint([40, 52], c, 4);
    expect(s.point[1]).toBe(50);
    expect(s.guides[0].label).toBe('3 nodes aligned');
  });
  it('prefers point candidates', () => {
    const c = emptyCandidates();
    c.points.push([10, 10]);
    expect(snapPoint([11, 12], c, 4).snappedTo).toBe('point');
  });
  it('snaps angles and constrains to 45°', () => {
    expect(snapAngle((44 * Math.PI) / 180)).toBeCloseTo(Math.PI / 4);
    expect(snapAngle((40 * Math.PI) / 180)).toBeCloseTo((40 * Math.PI) / 180);
    const p = constrain45([0, 0], [10, 1]);
    expect(p[1]).toBeCloseTo(0);
  });
});

describe('hit testing', () => {
  const doc = createDocument({ width: 400, height: 400, units: 'pt' });
  const back = makeRect(0, 0, 200, 200);
  const front = makeEllipse(100, 100, 50, 50);
  const line = makePath(parsePathData('M300 10L390 10'));
  const text = makeText(300, 300, 'Hello');
  const group = makeGroup([makeRect(250, 100, 40, 40)], 'G');
  doc.artboards[0].children.push(back, front, line, text, group);

  it('finds the front-most object', () => {
    expect(hitTest(doc, [100, 100], 1)?.node.id).toBe(front.id);
    expect(hitTest(doc, [10, 10], 1)?.node.id).toBe(back.id);
  });
  it('hits strokes within tolerance and misses empty space', () => {
    expect(hitTest(doc, [350, 12], 3)?.node.id).toBe(line.id);
    expect(hitTest(doc, [350, 40], 3)).toBeNull();
  });
  it('returns groups at top level and leaves when deep', () => {
    expect(hitTest(doc, [260, 110], 1)?.node.id).toBe(group.id);
    expect(hitTest(doc, [260, 110], 1, { deep: true })?.node.id).toBe(group.children[0].id);
    expect(hitTest(doc, [260, 110], 1, { isolation: group.id })?.node.id).toBe(group.children[0].id);
  });
  it('hits text by its box and skips locked or hidden nodes', () => {
    expect(hitTest(doc, [310, 310], 1)?.node.id).toBe(text.id);
    back.locked = true;
    expect(hitTest(doc, [10, 10], 1)).toBeNull();
    back.locked = false;
  });
  it('marquee selects intersecting objects', () => {
    expect(marqueeSelect(doc, { x: 280, y: 0, width: 120, height: 30 }, null)).toEqual([line.id]);
    expect(artboardAt(doc, [10, 10])?.id).toBe(doc.artboards[0].id);
  });
});
