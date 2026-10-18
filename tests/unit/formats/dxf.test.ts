import { describe, expect, it, vi } from 'vitest';
import { exportDxfString, aciToRgb, rgbToAci } from '../../../src/formats/dxf/export';
import { importDxf, parseDxf, bulgePolyline, ellipseArc } from '../../../src/formats/dxf/import';
import { dxfAdapter } from '../../../src/formats/dxf';
import {
  createDocument,
  makeEllipse,
  makeGroup,
  makePath,
  makeRect,
  makeStar,
  makeText,
} from '../../../src/core/document';
import { parsePathData } from '../../../src/core/geometry/pathdata';
import { subpathsBounds } from '../../../src/core/geometry/bezier';
import type { GroupNode, TextNode } from '../../../src/core/types';
import { utf8 } from '../../../src/formats/shared/bytes';
import { ctxFor, expectBoundsClose, fixture, summarize } from './helpers';

vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () => null,
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

const MM = 72 / 25.4;

function cutDoc() {
  const doc = createDocument({ name: 'Plate', width: 200 * MM, height: 100 * MM, units: 'mm' });
  const rect = makeRect(10 * MM, 10 * MM, 50 * MM, 30 * MM);
  const circle = makeEllipse(100 * MM, 50 * MM, 20 * MM, 20 * MM);
  const wave = makePath(parsePathData('M20 200 C 60 150 100 250 140 200 L 160 260 Z'));
  const star = makeStar(400, 150, 40);
  const g = makeGroup([star, makeRect(450, 20, 30, 30)], 'Holes');
  doc.artboards[0].children = [rect, circle, wave, g];
  return doc;
}

describe('DXF export', () => {
  it('writes R12 sections, layers, polylines and circles', async () => {
    const doc = cutDoc();
    const dxf = await exportDxfString(doc, { kind: 'all' }, { units: 'mm' }, ctxFor(doc));
    expect(dxf).toContain('$ACADVER\r\n  1\r\nAC1009');
    expect(dxf).toMatch(/\$INSUNITS\r\n 70\r\n\s+4/);
    expect(dxf).toContain('LAYER\r\n  2\r\nPLATE');
    expect(dxf).toContain('LAYER\r\n  2\r\nHOLES');
    expect(dxf).toContain('POLYLINE');
    expect(dxf).toContain('VERTEX');
    expect(dxf).toContain('SEQEND');
    // The circle stays a circle: center (100, 100 - 50) mm, radius 20 mm.
    expect(dxf).toMatch(
      /CIRCLE\r\n {2}8\r\nPLATE\r\n 62\r\n\s+\d+\r\n 10\r\n100\.0\r\n 20\r\n50\.0\r\n 30\r\n0\.0\r\n 40\r\n20\.0/,
    );
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    // Pairs are well formed.
    const parsed = parseDxf(dxf);
    expect(parsed.entities.length).toBeGreaterThan(4);
  });

  it('flips y and scales by units (inches)', async () => {
    const doc = createDocument({ width: 144, height: 72, units: 'in' });
    doc.artboards[0].children = [makeRect(0, 0, 72, 36)];
    const dxf = await exportDxfString(doc, { kind: 'all' }, { units: 'in' }, ctxFor(doc));
    const parsed = parseDxf(dxf);
    const poly = parsed.entities.find((e) => e.type === 'POLYLINE')!;
    const pts = poly.vertices!.map((v) => [
      Number(v.pairs.find((p) => p[0] === 10)![1]),
      Number(v.pairs.find((p) => p[0] === 20)![1]),
    ]);
    expect(pts).toEqual([
      [0, 1],
      [1, 1],
      [1, 0.5],
      [0, 0.5],
    ]);
  });

  it('writes TEXT when the font is unavailable and notes images', async () => {
    const doc = createDocument({ width: 100, height: 100, units: 'mm' });
    doc.artboards[0].children = [makeText(10, 10, 'Label')];
    const warnings: string[] = [];
    const dxf = await exportDxfString(doc, { kind: 'all' }, {}, ctxFor(doc, warnings));
    expect(dxf).toContain('TEXT\r\n');
    expect(dxf).toContain('\r\nLabel\r\n');
    expect(warnings).toContain('Text without an available font was written as DXF text.');
  });

  it('maps colors to the AutoCAD color index', () => {
    expect(rgbToAci(255, 0, 0)).toBe(1);
    expect(rgbToAci(0, 0, 255)).toBe(5);
    expect(rgbToAci(10, 10, 10)).toBe(7);
    expect(aciToRgb(3)).toEqual([0, 255, 0]);
    expect(aciToRgb(10)).toEqual([255, 0, 0]);
  });
});

describe('DXF import', () => {
  it('reads the parts fixture: entities, layers, units, report', async () => {
    const { doc, report } = await importDxf(fixture('dxf/parts.dxf'), { fileName: 'parts.dxf' });
    expect(doc.units).toBe('mm');
    const ab = doc.artboards[0];
    expect(ab.width).toBeCloseTo(100 * MM, 6);
    expect(ab.height).toBeCloseTo(50 * MM, 6);
    const layers = ab.children as GroupNode[];
    expect(layers.map((l) => l.name)).toEqual(['Cut', 'Engrave', 'Hidden']);
    expect(layers[2].visible).toBe(false);
    const cut = layers[0];
    const stroke = cut.children[0].appearance.items[0];
    expect(stroke.kind === 'stroke' && stroke.paint.type === 'solid' && stroke.paint.color).toMatchObject({
      r: 1,
      g: 0,
      b: 0,
    });

    const s = summarize(doc);
    const mm = (b: number[] | null) => b && b.map((v) => v / MM);
    // LINE (0,0)-(10,10) → y flipped against the 50 mm extents.
    expect(expectBoundsClose(mm(s[0].bounds) as never, [0, 40, 10, 10], 1e-6)).toBe(true);
    // Slot with two bulge semicircles.
    expect(expectBoundsClose(mm(s[1].bounds) as never, [15, 30, 30, 10], 1e-3)).toBe(true);
    // ELLIPSE, full, major 10 ratio 0.5.
    expect(expectBoundsClose(mm(s[2].bounds) as never, [75, 5, 20, 10], 1e-3)).toBe(true);
    // SPLINE (clamped cubic = one Bézier): peak at 41.25.
    expect(expectBoundsClose(mm(s[3].bounds) as never, [5, 50 - 41.25, 20, 11.25], 0.05)).toBe(true);
    const engrave = summarize({ ...doc, artboards: [{ ...ab, children: [layers[1]] }] });
    const circle = engrave.find((x) => x.type === 'ellipse')!;
    expect(expectBoundsClose(mm(circle.bounds) as never, [60, 15, 20, 20], 1e-6)).toBe(true);
    // ARC quarter (r 5 at 50,40, 0°..90°) → x 50..55, y 40..45 → flipped 5..10.
    const arc = engrave[1];
    expect(expectBoundsClose(mm(arc.bounds) as never, [50, 5, 5, 5], 1e-3)).toBe(true);
    // Block insert: 5 mm line scaled 2× and rotated 90° at (90, 5) → vertical from y 5 to 15.
    const ins = engrave[3];
    expect(expectBoundsClose(mm(ins.bounds) as never, [90, 35, 0, 10], 1e-6)).toBe(true);
    const text = layers[1].children.find((c) => c.type === 'text') as TextNode;
    expect(text.runs[0].text).toBe('PART ⌀10');
    expect(report.warnings).toContain('2 HATCH entities were skipped.');
    expect(report.notes.layers).toBe(3);
  });

  it('round-trips geometry: export → import keeps shapes within tolerance', async () => {
    const doc = cutDoc();
    const dxf = await exportDxfString(doc, { kind: 'all' }, { units: 'mm', tolerance: 0.05 }, ctxFor(doc));
    const { doc: back, report } = await importDxf(utf8(dxf), { fileName: 'plate.dxf' });
    expect(report.warnings).toEqual([]);
    expect(back.artboards[0].width).toBeCloseTo(doc.artboards[0].width, 4);
    expect(back.artboards[0].height).toBeCloseTo(doc.artboards[0].height, 4);
    const a = summarize(doc);
    const b = summarize(back);
    expect(b).toHaveLength(a.length);
    a.forEach((x, i) =>
      expect(expectBoundsClose(x.bounds, b[i].bounds, 0.3), `${x.name}: ${x.bounds} vs ${b[i].bounds}`).toBe(
        true,
      ),
    );
    expect(b[1].type).toBe('ellipse');
    expect((back.artboards[0].children as GroupNode[]).map((g) => g.name)).toEqual(['PLATE', 'HOLES']);
  });

  it('reads files without units as millimeters and says so', async () => {
    const doc = createDocument({ width: 100, height: 100, units: 'px' });
    doc.artboards[0].children = [makeRect(0, 0, 10, 10)];
    const dxf = await exportDxfString(doc, { kind: 'all' }, { units: 'px' }, ctxFor(doc));
    const { report } = await importDxf(utf8(dxf), { fileName: 'a.dxf' });
    expect(report.warnings).toContain('The drawing has no units. It was read as millimeters.');
  });

  it('converts bulges and elliptical arcs exactly', () => {
    const half = bulgePolyline(
      [
        { x: 0, y: 0, bulge: 1 },
        { x: 10, y: 0, bulge: 0 },
      ],
      false,
    );
    const b = subpathsBounds([half])!;
    // CCW semicircle from (0,0) to (10,0) in y-up dips below the chord.
    expect(b.y).toBeCloseTo(-5, 3);
    expect(b.width).toBeCloseTo(10, 6);
    const e = ellipseArc([0, 0], [10, 0], [0, 5], 0, Math.PI / 2);
    expect(e.nodes).toHaveLength(2);
    expect(e.nodes[1].x).toBeCloseTo(0);
    expect(e.nodes[1].y).toBeCloseTo(5);
  });

  it('rejects garbage and binary DXF', async () => {
    await expect(importDxf(utf8('hello\nworld\n'), { fileName: 'x.dxf' })).rejects.toThrow(
      /could not be read/,
    );
    await expect(importDxf(utf8('AutoCAD Binary DXF\r\n'), { fileName: 'x.dxf' })).rejects.toThrow(
      /Binary DXF/,
    );
  });

  it('is wired into the adapter', async () => {
    expect(dxfAdapter.canImport).toBe(true);
    const doc = cutDoc();
    const blob = await dxfAdapter.export!(doc, { kind: 'all' }, dxfAdapter.defaults!, ctxFor(doc));
    expect(blob.type).toBe('image/vnd.dxf');
  });
});
