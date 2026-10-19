import { beforeEach, describe, expect, it } from 'vitest';
import { shapeSubpaths, type ShapeKind } from '../../src/core/geometry/multishape';
import { SHAPES, defaultParams, isMultiShape, shapeDef } from '../../src/core/shapeCatalog';
import { subpathsBounds } from '../../src/core/geometry/bezier';
import { createDocument, isEvenOdd, locate, makeShape } from '../../src/core/document';
import { applyWorldDelta, selectionBounds } from '../../src/core/transform';
import { hitTest } from '../../src/render/hittest';
import { getState, select, setState, mutate } from '../../src/state/store';
import { convertToPath } from '../../src/state/actions';
import { TOOL_IMPLS } from '../../src/tools';
import { children, doc, drag, freshDoc } from './helpers';
import { exportDocument, importFile } from '../../src/formats/registry';

const MULTI = SHAPES.filter((s) => isMultiShape(s.kind)).map((s) => s.kind as ShapeKind);

describe('shape geometry', () => {
  it.each(MULTI)('%s builds finite geometry inside its box', (kind) => {
    const sp = shapeSubpaths(kind, 200, 120, defaultParams(kind));
    expect(sp.length).toBeGreaterThan(0);
    for (const s of sp)
      for (const n of s.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    const b = subpathsBounds(sp)!;
    expect(b.x).toBeGreaterThan(-1);
    expect(b.y).toBeGreaterThan(-1);
    expect(b.x + b.width).toBeLessThan(201);
    expect(b.y + b.height).toBeLessThan(121);
    // Shapes use most of their box.
    expect(b.width).toBeGreaterThan(100);
    expect(b.height).toBeGreaterThanOrEqual(59.9);
    expect(sp.every((s) => s.closed)).toBe(!shapeDef(kind).open);
  });

  it('survives extreme parameters', () => {
    for (const kind of MULTI) {
      for (const v of [-10, 0, 1e6, Number.NaN]) {
        const params = Object.fromEntries(
          shapeDef(kind).params.map((p) => [p.key, p.type === 'bool' ? true : v]),
        );
        const sp = shapeSubpaths(kind, 50, 50, params);
        for (const s of sp)
          for (const n of s.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      }
    }
  });

  it('donut, frame and cog have holes', () => {
    expect(shapeSubpaths('donut', 100, 100, defaultParams('donut'))).toHaveLength(2);
    expect(shapeSubpaths('frame', 100, 100, defaultParams('frame'))).toHaveLength(2);
    expect(shapeSubpaths('cog', 100, 100, defaultParams('cog'))).toHaveLength(2);
    expect(shapeSubpaths('cog', 100, 100, { ...defaultParams('cog'), hole: 0 })).toHaveLength(1);
  });

  it('parameters change the geometry', () => {
    const a = shapeSubpaths('doubleStar', 100, 100, { points: 5 })[0].nodes.length;
    const b = shapeSubpaths('doubleStar', 100, 100, { points: 9 })[0].nodes.length;
    expect(a).toBe(20);
    expect(b).toBe(36);
    const one = shapeSubpaths('arrow', 100, 50, { head: 0.3, shaft: 0.4, double: false })[0].nodes.length;
    const two = shapeSubpaths('arrow', 100, 50, { head: 0.3, shaft: 0.4, double: true })[0].nodes.length;
    expect(two).toBeGreaterThan(one);
  });

  it('the catalog has the requested shapes plus extras, with unique kinds', () => {
    const kinds = SHAPES.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const k of [
      'triangle',
      'diamond',
      'trapezoid',
      'polygon',
      'star',
      'doubleStar',
      'squareStar',
      'arrow',
      'donut',
      'pie',
      'segment',
      'crescent',
      'cog',
      'cloud',
      'calloutRect',
      'calloutEllipse',
      'tear',
      'heart',
    ])
      expect(kinds).toContain(k);
    for (const k of [
      'parallelogram',
      'gem',
      'flower',
      'chevron',
      'cross',
      'bolt',
      'shield',
      'frame',
      'arc',
      'spiral',
    ])
      expect(kinds).toContain(k);
  });
});

describe('shape nodes', () => {
  beforeEach(() => freshDoc());

  it('use even-odd so holes stay empty, and hit-test through the hole', () => {
    const d = createDocument({ width: 300, height: 300, units: 'pt' });
    const donut = makeShape('donut', 0, 0, 100, 100, defaultParams('donut'));
    d.artboards[0].children.push(donut);
    expect(isEvenOdd(donut)).toBe(true);
    expect(hitTest(d, [50, 50], 0.5)).toBeNull();
    expect(hitTest(d, [50, 10], 0.5)?.node.id).toBe(donut.id);
  });

  it('scale parametrically (box size changes, params stay)', () => {
    const d = createDocument({ width: 300, height: 300, units: 'pt' });
    const s = makeShape('cog', 0, 0, 100, 100, defaultParams('cog'));
    d.artboards[0].children.push(s);
    applyWorldDelta(d, [s.id], [2, 0, 0, 1.5, 0, 0]);
    const n = d.artboards[0].children[0];
    expect(n.type === 'shape' && [n.width, n.height]).toEqual([200, 150]);
    expect(n.transform[0]).toBeCloseTo(1);
    // Teeth fall between the box's side points, so the drawn width is a little under the box.
    expect(selectionBounds(d, [s.id])!.width).toBeGreaterThan(190);
  });

  it('convert to path keeps holes', async () => {
    const s = makeShape('frame', 10, 10, 100, 100, defaultParams('frame'));
    mutate('Add', (d) => void d.artboards[0].children.push(s as never), [s.id]);
    await convertToPath();
    const p = children()[0];
    expect(p.type === 'path' && p.fillRule).toBe('evenodd');
    expect(p.type === 'path' && p.subpaths).toHaveLength(2);
  });

  it('round-trip through .curvs', async () => {
    const s = makeShape('calloutRect', 0, 0, 120, 80, { ...defaultParams('calloutRect'), tailX: 0.7 });
    mutate('Add', (d) => void d.artboards[0].children.push(s as never));
    const blob = await exportDocument(
      'curvs',
      doc(),
      { kind: 'all' },
      {},
      { name: 'x', selection: [], activeArtboard: doc().artboards[0].id },
    );
    const { doc: back } = await importFile({
      name: 'x.curvs',
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
    const n = back.artboards[0].children[0];
    expect(n.type === 'shape' && n.kind).toBe('calloutRect');
    expect(n.type === 'shape' && n.params.tailX).toBe(0.7);
  });
});

describe('Shapes tool', () => {
  beforeEach(() => freshDoc());

  it('draws the chosen shape in a box with remembered parameters', () => {
    setState({ ui: { ...getState().ui, shapeKind: 'heart', shapeParams: { heart: { cleft: 0.9 } } } });
    drag(TOOL_IMPLS.star, [10, 10], [110, 90]);
    const n = children()[0];
    expect(n.type).toBe('shape');
    if (n.type !== 'shape') return;
    expect(n.kind).toBe('heart');
    expect(n.params.cleft).toBe(0.9);
    expect([n.width, n.height]).toEqual([100, 80]);
    expect(n.name).toBe('Heart');
  });

  it('⇧ draws a square box; spirals get a stroke and no fill', () => {
    setState({ ui: { ...getState().ui, shapeKind: 'spiral' } });
    drag(TOOL_IMPLS.star, [10, 10], [110, 50], { shift: true });
    const n = children()[0];
    expect(n.type === 'shape' && n.width === n.height).toBe(true);
    expect(n.appearance.items.some((i) => i.kind === 'fill')).toBe(false);
    expect(n.appearance.items.some((i) => i.kind === 'stroke')).toBe(true);
  });

  it('star and polygon still make star objects', () => {
    setState({ ui: { ...getState().ui, shapeKind: 'polygon' } });
    drag(TOOL_IMPLS.star, [100, 100], [140, 140]);
    const n = children()[0];
    expect(n.type === 'star' && n.polygon).toBe(true);
  });

  it('↑ changes the count parameter while drawing', () => {
    setState({ ui: { ...getState().ui, shapeKind: 'cog', shapeParams: {} } });
    TOOL_IMPLS.star.key!(new KeyboardEvent('keydown', { key: 'ArrowUp' }), {} as never);
    expect(getState().ui.shapeParams.cog?.teeth).toBe(11);
  });

  it('selection keeps working with locate', () => {
    const s = makeShape('gem', 0, 0, 50, 50, {});
    mutate('Add', (d) => void d.artboards[0].children.push(s as never));
    select([s.id]);
    expect(locate(doc(), s.id)?.node.type).toBe('shape');
  });
});
