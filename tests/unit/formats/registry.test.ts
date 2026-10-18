import { describe, expect, it, vi } from 'vitest';
import {
  FORMATS,
  GROUP_LABELS,
  adapterForFile,
  estimateSize,
  exportDocument,
  exportFormats,
  exportWithReport,
  fileNameFor,
  formatBytes,
  importAccept,
  importFile,
  loadAdapter,
} from '../../../src/formats/registry';
import { writeCurvs } from '../../../src/formats/curvs';
import { utf8, dataUrlToBytes } from '../../../src/formats/shared/bytes';
import { PNG_1PX, ctxFor, fixture, sampleDoc } from './helpers';

vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () => null,
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

describe('format registry', () => {
  it('lists export formats in mockup order with their descriptors', () => {
    const list = exportFormats().map((f) => [GROUP_LABELS[f.group], f.label, f.descriptor]);
    expect(list).toEqual([
      ['NATIVE', '.curvs', 'Lossless, fully editable'],
      ['VECTOR', 'SVG', 'Web, code, icons'],
      ['VECTOR', 'PDF', 'Print and sharing'],
      ['VECTOR', 'AI', 'Opens in Illustrator'],
      ['VECTOR', 'EPS', 'Legacy print workflows'],
      ['VECTOR', 'DXF', 'CAD, laser and vinyl cutters'],
      ['VECTOR', 'EMF', 'Microsoft Office'],
      ['RASTER', 'PNG', 'Transparent bitmap'],
      ['RASTER', 'JPG', 'Photos, no transparency'],
      ['RASTER', 'WebP', 'Small images for the web'],
    ]);
  });

  it('keeps UI notes short and free of "X, not Y" phrasing', () => {
    for (const f of FORMATS) {
      if (!f.note) continue;
      expect(f.note.length).toBeLessThan(110);
      expect(f.note).not.toMatch(/,\s*not\b|instead of/i);
    }
  });

  it('loads every adapter lazily and they match their descriptors', async () => {
    for (const f of FORMATS) {
      const a = await loadAdapter(f.id);
      expect(a.id).toBe(f.id);
      expect(a.label).toBe(f.label);
      expect(Boolean(a.export)).toBe(f.canExport);
      expect(Boolean(a.import)).toBe(f.canImport);
    }
    await expect(loadAdapter('cdr')).rejects.toThrow(/Unknown format/);
  });

  it('picks formats by sniffing bytes, then by extension', () => {
    expect(adapterForFile('x.bin', utf8('%PDF-1.7'))?.id).toBe('pdf');
    expect(adapterForFile('x.ai', utf8('%PDF-1.5'))?.id).toBe('ai');
    expect(adapterForFile('weird.txt', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))?.id).toBe('curvs');
    expect(
      adapterForFile('icon', utf8('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'))?.id,
    ).toBe('svg');
    expect(adapterForFile('a.svgz', new Uint8Array([0x1f, 0x8b, 8, 0]))?.id).toBe('svg');
    expect(adapterForFile('p', dataUrlToBytes(PNG_1PX)!.bytes)?.id).toBe('png');
    expect(adapterForFile('p', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.id).toBe('jpg');
    expect(adapterForFile('d', utf8('  0\nSECTION\n'))?.id).toBe('dxf');
    expect(adapterForFile('logo.eps', utf8('%!PS-Adobe-3.0 EPSF-3.0'))?.id).toBe('eps');
    expect(adapterForFile('drawing.DXF')?.id).toBe('dxf');
    expect(adapterForFile('photo.jpeg')?.id).toBe('jpg');
    expect(adapterForFile('notes.txt')).toBeNull();
    expect(importAccept()).toContain('.svg');
  });

  it('imports SVG, .curvs, DXF and images through importFile', async () => {
    const svg = await importFile({ name: 'features.svg', bytes: fixture('svg/features.svg') });
    expect(svg.format).toBe('svg');
    expect(svg.report.warnings.length).toBeGreaterThan(0);
    const curvs = await importFile({ name: 'a.curvs', bytes: await writeCurvs(sampleDoc()) });
    expect(curvs.doc.artboards[0].children).toHaveLength(6);
    const dxf = await importFile({ name: 'parts.dxf', bytes: fixture('dxf/parts.dxf') });
    expect(dxf.format).toBe('dxf');
    const img = await importFile({ name: 'dot.png', bytes: dataUrlToBytes(PNG_1PX)!.bytes });
    expect(img.doc.artboards[0].children[0].type).toBe('image');
    const file = new File([fixture('svg/features.svg')], 'from-disk.svg', { type: 'image/svg+xml' });
    expect((await importFile(file)).doc.artboards).toHaveLength(1);
  });

  it('explains files it cannot open', async () => {
    await expect(importFile({ name: 'a.eps', bytes: utf8('%!PS-Adobe-3.0 EPSF-3.0\n') })).rejects.toThrow(
      /Opening EPS files arrives in a later version/,
    );
    await expect(importFile({ name: 'old.ai', bytes: utf8('%!PS-Adobe-3.0\n') })).rejects.toThrow(
      /no PDF data/,
    );
    await expect(importFile({ name: 'a.xyz', bytes: utf8('hello') })).rejects.toThrow(/can't open/);
  });

  it('exports with defaults merged and collects notes', async () => {
    const doc = sampleDoc();
    const svg = await exportDocument('svg', doc, { kind: 'all' }, { minify: true }, ctxFor(doc));
    expect(svg.type).toBe('image/svg+xml');
    expect(await svg.text()).not.toContain('\n');
    const r = await exportWithReport(
      'emf',
      doc,
      { kind: 'all' },
      {},
      { name: 'Poster', selection: [], activeArtboard: doc.artboards[0].id },
    );
    expect(r.fileName).toBe('Poster.emf');
    expect(r.warnings).toContain('Gradients became flat colors.');
    await expect(exportDocument('gif', doc, { kind: 'all' }, {}, ctxFor(doc))).rejects.toThrow(
      /isn't available/,
    );
  });

  it('names files and estimates sizes', () => {
    const doc = sampleDoc();
    expect(fileNameFor('jpg', 'Poster')).toBe('Poster.jpg');
    expect(fileNameFor('curvs', '')).toBe('Untitled.curvs');
    const svg = estimateSize('svg', doc, { kind: 'all' }, {}, doc.artboards[0].id);
    expect(svg).toBeGreaterThan(300);
    const png1 = estimateSize('png', doc, { kind: 'all' }, { scale: 1 }, doc.artboards[0].id);
    const png2 = estimateSize('png', doc, { kind: 'all' }, { scale: 2 }, doc.artboards[0].id);
    expect(png2).toBeGreaterThan(png1 * 3);
    expect(formatBytes(18 * 1024)).toBe('18 KB');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
  });
});
