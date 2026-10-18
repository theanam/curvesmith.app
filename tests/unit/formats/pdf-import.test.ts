import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportPdfBytes } from '../../../src/formats/pdf/export';
import { importPdf, parseFontName } from '../../../src/formats/pdf/import';
import { importFile } from '../../../src/formats/registry';
import { makeArtboard, makeRect, walk } from '../../../src/core/document';
import type { SceneNode, TextNode } from '../../../src/core/types';
import { utf8 } from '../../../src/formats/shared/bytes';
import { ctxFor, expectBoundsClose, fixture, sampleDoc, summarize } from './helpers';

vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () =>
    new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/fonts/geist-latin-400-normal.ttf'))),
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

const nodes = (doc: Parameters<typeof walk>[0]) => {
  const out: SceneNode[] = [];
  walk(doc, (n) => {
    out.push(n);
  });
  return out;
};

describe('PDF import', () => {
  it('parses font names into family, weight and style', () => {
    expect(parseFontName('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toEqual({
      family: 'Times New Roman',
      weight: 700,
      italic: true,
    });
    expect(parseFontName('Geist-Regular-8450')).toEqual({ family: 'Geist', weight: 400, italic: false });
    expect(parseFontName('Arial,Bold')).toEqual({ family: 'Arial', weight: 700, italic: false });
    expect(parseFontName('Inter-SemiBold')).toMatchObject({ weight: 600 });
  });

  it('round-trips a document: export PDF → import keeps shapes, colors, text and images', async () => {
    const doc = sampleDoc();
    const pdf = await exportPdfBytes(doc, { kind: 'all' }, {}, ctxFor(doc));
    const { doc: back, report } = await importPdf(pdf, { fileName: 'poster.pdf' });
    expect(back.artboards).toHaveLength(1);
    expect(back.artboards[0].width).toBeCloseTo(400, 3);
    expect(back.artboards[0].height).toBeCloseTo(300, 3);
    const all = nodes(back);
    // Background, card, sun, wave, star, inner rect → paths; plus text and image.
    const paths = all.filter((n) => n.type === 'path');
    expect(paths.length).toBe(6);
    const s = summarize(back);
    const card = s.find((x) => x.colors[0] === 'fill:43,95,107')!;
    expect(expectBoundsClose(card.bounds, [20, 20, 120, 80], 0.01)).toBe(true);
    // Fill and stroke of the same path come back as one object.
    const wave = s.find((x) => x.colors[0] === 'fill:255,204,0')!;
    expect(wave.colors).toEqual(['fill:255,204,0', 'stroke:0,0,128']);
    const sun = all.find((n) =>
      n.appearance.items.some((i) => i.kind === 'fill' && i.paint.type === 'linear'),
    )!;
    const st = sun.appearance.items.find((i) => i.kind === 'stroke');
    expect(st).toMatchObject({ dash: [6, 3], width: 2 });
    const grad = sun.appearance.items[0];
    if (grad.kind === 'fill' && grad.paint.type === 'linear') {
      expect(grad.paint.from[0]).toBeCloseTo(200, 3);
      expect(grad.paint.to[0]).toBeCloseTo(300, 3);
    }
    const text = all.find((n) => n.type === 'text') as TextNode;
    expect(text.runs[0].text).toBe('Low Tide');
    expect(text.runs[0].font.family).toBe('Geist');
    expect(text.runs[0].size).toBeCloseTo(24, 3);
    const img = all.find((n) => n.type === 'image')!;
    expect(img.type === 'image' && back.assets[img.asset]).toMatch(/^data:image\/png;base64,/);
    const ib = summarize(back).find((x) => x.type === 'image')!;
    expect(expectBoundsClose(ib.bounds, [200, 120, 40, 40], 0.01)).toBe(true);
    expect(report.notes.pages).toBe(1);
  });

  it('reads one artboard per page and uses the TrimBox when there is bleed', async () => {
    const doc = sampleDoc();
    const ab = makeArtboard('Back', 200, 100, 500, 0);
    ab.children = [makeRect(10, 10, 20, 20)];
    doc.artboards.push(ab);
    const pdf = await exportPdfBytes(doc, { kind: 'all' }, { bleed: true, cropMarks: true }, ctxFor(doc));
    const { doc: back } = await importPdf(pdf, { fileName: 'two.pdf' });
    expect(back.artboards.map((a) => [a.name, Math.round(a.width), Math.round(a.height)])).toEqual([
      ['Page 1', 400, 300],
      ['Page 2', 200, 100],
    ]);
    const s = summarize({ ...back, artboards: [back.artboards[1]] });
    const rect = s.find((x) => x.colors[0] === 'fill:217,217,217')!;
    expect(expectBoundsClose(rect.bounds, [back.artboards[1].x + 10, 10, 20, 20], 0.01)).toBe(true);
  });

  it('reads the golden PDF fixture and AI files through the registry', async () => {
    const r = await importFile({ name: 'golden.pdf', bytes: fixture('pdf/golden.pdf') });
    expect(r.format).toBe('pdf');
    expect(nodes(r.doc).length).toBeGreaterThan(5);
    const ai = await importFile({ name: 'golden.ai', bytes: fixture('pdf/golden.pdf') });
    expect(ai.format).toBe('ai');
    expect(ai.report.warnings).toContain('Imported the PDF content of this .ai file.');
  });

  it('rejects broken PDFs clearly', async () => {
    await expect(importPdf(utf8('%PDF-1.7\nnot really'), { fileName: 'bad.pdf' })).rejects.toThrow(
      /could not be read|no pages/,
    );
  });
});
