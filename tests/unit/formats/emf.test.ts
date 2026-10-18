import { describe, expect, it, vi } from 'vitest';
import { exportEmfBytes, EMR, EMF_UNITS_PER_PT } from '../../../src/formats/emf/export';
import { emfAdapter } from '../../../src/formats/emf';
import { createDocument, makeRect, makeText } from '../../../src/core/document';
import { rgb } from '../../../src/core/color';
import { readEmf, u32, i32 } from './emfReader';
import { ctxFor, sampleDoc } from './helpers';

vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () => null,
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

describe('EMF export', () => {
  it('writes a structurally valid metafile', async () => {
    const doc = sampleDoc();
    const bytes = await exportEmfBytes(doc, { kind: 'all' }, {}, ctxFor(doc));
    const emf = readEmf(bytes);
    const h = emf.header;
    expect(h.signature).toBe(0x464d4520);
    expect(h.version).toBe(0x10000);
    expect(h.bytes).toBe(bytes.length);
    expect(h.nRecords).toBe(emf.records.length);
    expect(emf.records.every((r) => r.size % 4 === 0)).toBe(true);
    expect(emf.records[emf.records.length - 1].type).toBe(EMR.EOF);
    expect(h.description).toContain('Curvesmith');
    // 400 × 300 pt → 0.01 mm frame and 1/20 pt bounds.
    expect(h.frame[2]).toBe(Math.round((400 / 72) * 2540));
    expect(h.frame[3]).toBe(Math.round((300 / 72) * 2540));
    expect(h.bounds).toEqual([0, 0, 400 * EMF_UNITS_PER_PT - 1, 300 * EMF_UNITS_PER_PT - 1]);
    // 1440 dpi reference device.
    expect(h.device[0] / h.millimeters[0]).toBeCloseTo(1440 / 25.4, 0);
    expect(h.handles).toBeGreaterThanOrEqual(3);
  });

  it('uses anisotropic mapping and path records', async () => {
    const doc = sampleDoc();
    const emf = readEmf(await exportEmfBytes(doc, { kind: 'all' }, {}, ctxFor(doc)));
    const types = emf.records.map((r) => r.type);
    const mapMode = emf.records.find((r) => r.type === EMR.SETMAPMODE)!;
    expect(u32(mapMode, 8)).toBe(8);
    const win = emf.records.find((r) => r.type === EMR.SETWINDOWEXTEX)!;
    expect([i32(win, 8), i32(win, 12)]).toEqual([8000, 6000]);
    for (const t of [
      EMR.BEGINPATH,
      EMR.MOVETOEX,
      EMR.LINETO,
      EMR.POLYBEZIERTO16,
      EMR.CLOSEFIGURE,
      EMR.ENDPATH,
      EMR.FILLPATH,
      EMR.STROKEPATH,
    ]) {
      expect(types, `record ${t}`).toContain(t);
    }
    expect(types).toContain(EMR.CREATEBRUSHINDIRECT);
    expect(types).toContain(EMR.EXTCREATEPEN);
    expect(types).toContain(EMR.SELECTOBJECT);
    expect(types).toContain(EMR.DELETEOBJECT);
    // Every BEGINPATH closes with ENDPATH.
    expect(types.filter((t) => t === EMR.BEGINPATH).length).toBe(
      types.filter((t) => t === EMR.ENDPATH).length,
    );
    // Creates and deletes balance.
    const created = types.filter(
      (t) => t === EMR.CREATEBRUSHINDIRECT || t === EMR.EXTCREATEPEN || t === EMR.EXTCREATEFONTINDIRECTW,
    ).length;
    expect(types.filter((t) => t === EMR.DELETEOBJECT).length).toBe(created);
    // SAVEDC/RESTOREDC balance.
    expect(types.filter((t) => t === EMR.SAVEDC).length).toBe(
      types.filter((t) => t === EMR.RESTOREDC).length,
    );
  });

  it('writes the brush color as a COLORREF and the pen width in logical units', async () => {
    const doc = createDocument({ width: 100, height: 100, units: 'px' });
    const r = makeRect(10, 10, 20, 20);
    r.appearance.items = [
      {
        kind: 'fill',
        id: 'f',
        visible: true,
        paint: { type: 'solid', color: rgb(1, 0.5, 0) },
        opacity: 1,
        blend: 'normal',
      },
      {
        kind: 'stroke',
        id: 's',
        visible: true,
        paint: { type: 'solid', color: rgb(0, 0, 1) },
        opacity: 1,
        blend: 'normal',
        width: 2,
        align: 'center',
        cap: 'round',
        join: 'bevel',
        miter: 4,
        dash: [4, 2],
        dashOffset: 0,
        profile: null,
        arrowStart: null,
        arrowEnd: null,
      },
    ];
    doc.artboards[0].children = [r];
    doc.artboards[0].background = null;
    const emf = readEmf(await exportEmfBytes(doc, { kind: 'all' }, {}, ctxFor(doc)));
    const brush = emf.records.find((x) => x.type === EMR.CREATEBRUSHINDIRECT)!;
    expect(u32(brush, 16)).toBe(0x000080ff);
    const pen = emf.records.find((x) => x.type === EMR.EXTCREATEPEN)!;
    const style = u32(pen, 28);
    expect(style & 0x10000).toBe(0x10000); // geometric
    expect(style & 0xf).toBe(7); // user dash style
    expect(style & 0xf00).toBe(0); // round cap
    expect(style & 0xf000).toBe(0x1000); // bevel join
    expect(u32(pen, 32)).toBe(40); // 2 pt × 20
    expect(u32(pen, 40)).toBe(0x00ff0000);
    expect(u32(pen, 48)).toBe(2);
    expect([u32(pen, 52), u32(pen, 56)]).toEqual([80, 40]);
    const move = emf.records.find((x) => x.type === EMR.MOVETOEX)!;
    expect([i32(move, 8), i32(move, 12)]).toEqual([200, 200]);
  });

  it('notes gradients, transparency and live text', async () => {
    const doc = sampleDoc();
    doc.artboards[0].children.push(makeText(10, 10, 'Hi'));
    const warnings: string[] = [];
    const emf = readEmf(await exportEmfBytes(doc, { kind: 'all' }, {}, ctxFor(doc, warnings)));
    expect(warnings).toContain('Gradients became flat colors.');
    expect(warnings).toContain('EMF has no transparency, so see-through objects were drawn opaque.');
    const texts = emf.records.filter((r) => r.type === EMR.EXTTEXTOUTW);
    const text = texts[texts.length - 1];
    expect(text).toBeDefined();
    expect(u32(text, 44)).toBe(2); // chars
    expect(emf.records.some((r) => r.type === EMR.STRETCHDIBITS)).toBe(true);
  });

  it('exports through the adapter', async () => {
    const doc = sampleDoc();
    const blob = await emfAdapter.export!(doc, { kind: 'all' }, {}, ctxFor(doc));
    expect(blob.type).toBe('image/emf');
    expect(readEmf(new Uint8Array(await blob.arrayBuffer())).header.signature).toBe(0x464d4520);
    expect(emfAdapter.canImport).toBe(false);
  });
});
