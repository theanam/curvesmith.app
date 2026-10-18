import { describe, expect, it } from 'vitest';
import { evaluateInput, formatLength, toPt } from '../../src/core/units';
import {
  colorToHex,
  hexToColor,
  hsbToRgb,
  oklchToRgb,
  parseCssColor,
  rgbToHsb,
  rgbToOklch,
  resolveColor,
} from '../../src/core/color';
import { multiply, invert, apply, decompose, compose, rotate, translate, scale } from '../../src/core/matrix';
import {
  createDocument,
  locate,
  makeRect,
  makeGroup,
  removeNodes,
  reId,
  worldMatrix,
} from '../../src/core/document';
import { record, push, undo, redo, emptyHistory, jumpTo } from '../../src/core/history';
import { combine, outlineStroke } from '../../src/core/booleans';
import { rectSubpaths, uniformCorners } from '../../src/core/geometry/shapes';
import { subpathsBounds } from '../../src/core/geometry/bezier';
import { ulid } from '../../src/core/id';

describe('units and math entry', () => {
  it('evaluates arithmetic', () => {
    expect(evaluateInput('120/3', { current: 0 })).toBe(40);
    expect(evaluateInput('(2+3)*4', { current: 0 })).toBe(20);
  });
  it('applies relative entries', () => {
    expect(evaluateInput('+12', { current: 10 })).toBe(22);
    expect(evaluateInput('*2', { current: 10 })).toBe(20);
    expect(evaluateInput('-5', { current: 10 })).toBe(-5);
  });
  it('handles percentages and units', () => {
    expect(evaluateInput('50%', { current: 200 })).toBe(100);
    expect(evaluateInput('1in', { current: 0, unit: 'pt' })).toBe(72);
    expect(evaluateInput('10mm', { current: 0, unit: 'mm' })).toBe(10);
    expect(evaluateInput('25.4mm', { current: 0, unit: 'in' })).toBeCloseTo(1);
  });
  it('rejects garbage', () => {
    expect(evaluateInput('abc', { current: 1 })).toBeNull();
    expect(evaluateInput('', { current: 1 })).toBeNull();
  });
  it('formats lengths', () => {
    expect(formatLength(toPt(210, 'mm'), 'mm')).toBe('210 mm');
  });
});

describe('color', () => {
  it('round-trips hex', () => {
    expect(colorToHex(hexToColor('#2B5F6B')!)).toBe('2B5F6B');
    expect(colorToHex(hexToColor('abc')!)).toBe('AABBCC');
  });
  it('round-trips hsb and oklch', () => {
    const c = hexToColor('#F0843A')!;
    const h = rgbToHsb(c);
    expect(colorToHex(hsbToRgb(h.h, h.s, h.b))).toBe('F0843A');
    const o = rgbToOklch(c);
    expect(colorToHex(oklchToRgb(o.l, o.c, o.h))).toBe('F0843A');
  });
  it('parses css colors', () => {
    expect(colorToHex(parseCssColor('rgb(255, 0, 0)')!)).toBe('FF0000');
    expect(colorToHex(parseCssColor('teal')!)).toBe('008080');
    expect(parseCssColor('none')).toBeNull();
  });
  it('follows swatch links', () => {
    const sw = [{ id: 'sw_1', name: 'Teal', color: hexToColor('#2B5F6B')!, global: true }];
    expect(colorToHex(resolveColor({ swatch: 'sw_1' }, sw))).toBe('2B5F6B');
  });
});

describe('matrix', () => {
  it('inverts', () => {
    const m = multiply(translate(10, 20), multiply(rotate(0.4), scale(2, 3)));
    const p = apply(multiply(m, invert(m)), [5, 7]);
    expect(p[0]).toBeCloseTo(5);
    expect(p[1]).toBeCloseTo(7);
  });
  it('decomposes and recomposes', () => {
    const m = multiply(translate(10, 20), multiply(rotate(0.4), scale(2, 3)));
    const r = compose(decompose(m));
    r.forEach((v, i) => expect(v).toBeCloseTo(m[i]));
  });
});

describe('document', () => {
  it('locates nested nodes and composes world matrices', () => {
    const doc = createDocument({ width: 100, height: 100, units: 'pt' });
    doc.artboards[0].x = 1000;
    const r = makeRect(10, 10, 5, 5);
    const g = makeGroup([r]);
    g.transform = translate(100, 0);
    doc.artboards[0].children.push(g);
    const loc = locate(doc, r.id)!;
    expect(loc.ancestors).toHaveLength(1);
    expect(apply(worldMatrix(loc), [0, 0])).toEqual([1110, 10]);
  });
  it('removes nodes and re-ids copies', () => {
    const doc = createDocument({ width: 100, height: 100, units: 'pt' });
    const a = makeRect(0, 0, 1, 1);
    const b = makeRect(0, 0, 1, 1);
    doc.artboards[0].children.push(a, b);
    expect(removeNodes(doc, new Set([a.id]))).toHaveLength(1);
    expect(doc.artboards[0].children).toHaveLength(1);
    expect(reId(b).id).not.toBe(b.id);
  });
  it('generates sortable unique ids', () => {
    const a = ulid(1000);
    const b = ulid(1000);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
    expect(a).toHaveLength(26);
  });
});

describe('history', () => {
  it('undoes and redoes with selection', () => {
    const doc = createDocument({ width: 100, height: 100, units: 'pt' });
    const r = makeRect(0, 0, 10, 10);
    const a = record(doc, (d) => void d.artboards[0].children.push(r), 'Add', [], [r.id]);
    let h = push(emptyHistory(), a.entry!);
    expect(a.doc.artboards[0].children).toHaveLength(1);
    const u = undo(a.doc, h)!;
    expect(u.doc.artboards[0].children).toHaveLength(0);
    expect(u.selection).toEqual([]);
    h = u.history;
    const re = redo(u.doc, h)!;
    expect(re.doc.artboards[0].children).toHaveLength(1);
    expect(re.selection).toEqual([r.id]);
  });
  it('coalesces repeated labels and jumps', () => {
    let doc = createDocument({ width: 100, height: 100, units: 'pt' });
    let h = emptyHistory();
    for (let i = 0; i < 3; i++) {
      const a = record(doc, (d) => void (d.artboards[0].width += 1), 'Nudge', [], []);
      doc = a.doc;
      h = push(h, a.entry!, 1000);
    }
    expect(h.past).toHaveLength(1);
    expect(doc.artboards[0].width).toBe(103);
    const j = jumpTo(doc, h, 0);
    expect(j.doc.artboards[0].width).toBe(100);
  });
});

describe('booleans', () => {
  const sq = (x: number, y: number) => ({
    subpaths: rectSubpaths({ width: 100, height: 100, corners: uniformCorners(0) }),
    transform: translate(x, y),
    evenOdd: false,
  });
  it('unions overlapping squares', () => {
    const r = combine('union', [sq(0, 0), sq(50, 50)])!;
    const b = subpathsBounds(r)!;
    expect(b.width).toBeCloseTo(150);
    expect(r[0].nodes).toHaveLength(8);
  });
  it('subtracts front from back', () => {
    const r = combine('subtract', [sq(0, 0), sq(50, 0)])!;
    expect(subpathsBounds(r)!.width).toBeCloseTo(50);
  });
  it('intersects', () => {
    const b = subpathsBounds(combine('intersect', [sq(0, 0), sq(50, 50)])!)!;
    expect(b.width).toBeCloseTo(50);
    expect(b.x).toBeCloseTo(50);
  });
  it('outlines a stroke', () => {
    const r = outlineStroke(
      [
        {
          closed: false,
          nodes: [
            { x: 0, y: 0, in: null, out: null, kind: 'sharp' },
            { x: 100, y: 0, in: null, out: null, kind: 'sharp' },
          ],
        },
      ],
      { width: 10, join: 'miter', cap: 'butt', miter: 4 },
    )!;
    const b = subpathsBounds(r)!;
    expect(b.height).toBeCloseTo(10);
    expect(b.width).toBeCloseTo(100);
  });
});
