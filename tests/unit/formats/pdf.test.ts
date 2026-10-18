import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { exportPdfBytes, BLEED_PT } from '../../../src/formats/pdf/export';
import { aiAdapter, pdfAdapter } from '../../../src/formats/pdf';
import { createDocument, makeRect, makeText, makeArtboard } from '../../../src/core/document';
import { rgb } from '../../../src/core/color';
import { fromUtf8 } from '../../../src/formats/shared/bytes';
import { ctxFor, sampleDoc } from './helpers';

const fontState = { available: true };
vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () =>
    fontState.available
      ? new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/fonts/geist-latin-400-normal.ttf')))
      : null,
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

async function content(bytes: Uint8Array, index = 0): Promise<{ pdf: PDFDocument; text: string }> {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(index);
  const c = page.node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r as PDFRef)) : [c];
  const text = streams
    .map((s) => (s instanceof PDFRawStream ? fromUtf8(decodePDFRawStream(s).decode()) : ''))
    .join('\n');
  return { pdf, text };
}

describe('PDF export', () => {
  it('writes one vector page per artboard with metadata', async () => {
    const doc = sampleDoc();
    const ab2 = makeArtboard('Back', 200, 100, 500, 0);
    ab2.children = [makeRect(10, 10, 20, 20)];
    doc.artboards.push(ab2);
    const bytes = await exportPdfBytes(doc, { kind: 'all' }, {}, ctxFor(doc));
    expect(fromUtf8(bytes.subarray(0, 8))).toMatch(/^%PDF-1\.\d/);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getMediaBox()).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    expect(pdf.getPage(1).getMediaBox()).toMatchObject({ width: 200, height: 100 });
    expect(pdf.getProducer()).toBe('Curvesmith');
    expect(pdf.getTitle()).toBe('Test');
  });

  it('draws true curves in a flipped (y-down) frame with fills, strokes, dashes and opacity', async () => {
    const doc = sampleDoc();
    const { text, pdf } = await content(
      await exportPdfBytes(doc, { kind: 'artboard', id: doc.artboards[0].id }, {}, ctxFor(doc)),
    );
    expect(text).toMatch(/1 0 0 -1 0 300 cm/);
    expect(text).toMatch(/ c\n/); // curveto
    expect(text).toMatch(/ l\n/); // lineto
    expect(text).toMatch(/\nf\n/);
    expect(text).toMatch(/\nS\n/);
    expect(text).toMatch(/\[6 3\] 0 d/);
    expect(text).toMatch(/1 J/); // round caps on the wave stroke
    expect(text).toMatch(/\/GS-?\d* gs/);
    // Gradient as a shading pattern.
    expect(text).toMatch(/\/Pattern cs/);
    const res = pdf.getPage(0).node.Resources()!;
    expect(res.lookup(PDFName.of('Pattern'))).toBeInstanceOf(PDFDict);
    // Image XObject.
    expect(text).toMatch(/ Do\n/);
    // Text with the embedded font.
    expect(text).toMatch(/BT\n/);
    expect(text).toMatch(/1 0 0 -1 \d+(\.\d+)? \d+(\.\d+)? Tm/);
  });

  it('embeds TrueType fonts, outlines them, or falls back to Helvetica', async () => {
    const doc = createDocument({ width: 200, height: 100, units: 'px' });
    doc.artboards[0].children = [makeText(10, 10, 'Hello')];
    const embedded = await content(
      await exportPdfBytes(doc, { kind: 'all' }, { embedFonts: true }, ctxFor(doc)),
    );
    expect(embedded.text).toContain('Tj');
    const fontDict = embedded.pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const font = fontDict.lookup(fontDict.keys()[0], PDFDict);
    expect(font.get(PDFName.of('Subtype'))?.toString()).toBe('/Type0');

    const outlined = await content(
      await exportPdfBytes(doc, { kind: 'all' }, { embedFonts: false }, ctxFor(doc)),
    );
    expect(outlined.text).not.toContain('Tj');
    expect(outlined.text).toMatch(/\nf\n/);

    fontState.available = false;
    const warnings: string[] = [];
    const fallback = await content(await exportPdfBytes(doc, { kind: 'all' }, {}, ctxFor(doc, warnings)));
    fontState.available = true;
    expect(fallback.text).toContain('Tj');
    expect(warnings).toContain('Some fonts were unavailable and were replaced with Helvetica.');
  });

  it('adds bleed, trim and crop marks', async () => {
    const doc = createDocument({ width: 100, height: 50, units: 'mm' });
    doc.artboards[0].children = [makeRect(0, 0, 10, 10)];
    const bytes = await exportPdfBytes(doc, { kind: 'all' }, { bleed: true, cropMarks: true }, ctxFor(doc));
    const { pdf, text } = await content(bytes);
    const page = pdf.getPage(0);
    const off = BLEED_PT + 20;
    expect(page.getMediaBox().width).toBeCloseTo(100 + off * 2, 3);
    expect(page.getTrimBox()).toMatchObject({ x: off, y: off, width: 100, height: 50 });
    expect(page.getBleedBox().width).toBeCloseTo(100 + BLEED_PT * 2, 3);
    // Background extends into the bleed; crop marks use registration black.
    expect(text).toContain('1 1 1 1 K');
  });

  it('writes optional content groups for layers', async () => {
    const doc = sampleDoc();
    const bytes = await exportPdfBytes(doc, { kind: 'all' }, { keepLayers: true }, ctxFor(doc));
    const { pdf, text } = await content(bytes);
    expect(text).toMatch(/\/OC \/OC1 BDC/);
    expect(text).toContain('EMC');
    const oc = pdf.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    expect(oc.lookup(PDFName.of('OCGs'), PDFArray).size()).toBeGreaterThanOrEqual(2);
  });

  it('exports inside/outside strokes with clips and blend modes as ExtGStates', async () => {
    const doc = createDocument({ width: 100, height: 100, units: 'px' });
    const r = makeRect(10, 10, 50, 50);
    const st = r.appearance.items[1];
    if (st.kind === 'stroke') {
      st.align = 'outside';
      st.blend = 'multiply';
    }
    r.appearance.items.push({
      kind: 'effect',
      id: 'e',
      visible: true,
      effect: { type: 'dropShadow', x: 2, y: 2, blur: 4, color: rgb(0, 0, 0, 0.4) },
    });
    doc.artboards[0].children = [r];
    const warnings: string[] = [];
    const { pdf, text } = await content(
      await exportPdfBytes(doc, { kind: 'all' }, {}, ctxFor(doc, warnings)),
    );
    expect(text).toContain('W*');
    const gs = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
    const dicts = gs.keys().map((k) => gs.lookup(k, PDFDict));
    expect(dicts.some((d) => d.get(PDFName.of('BM'))?.toString() === '/Multiply')).toBe(true);
    expect(warnings).toContain('Shadows were exported without blur.');
  });

  it('exports the selection on a tight page', async () => {
    const doc = sampleDoc();
    const card = doc.artboards[0].children[0];
    const bytes = await exportPdfBytes(doc, { kind: 'selection', ids: [card.id] }, {}, ctxFor(doc));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getMediaBox()).toMatchObject({ width: 120, height: 80 });
  });

  it('AI export is a PDF with the Illustrator mime type', async () => {
    const doc = sampleDoc();
    const blob = await aiAdapter.export!(doc, { kind: 'all' }, aiAdapter.defaults!, ctxFor(doc));
    expect(blob.type).toBe('application/illustrator');
    const head = fromUtf8(new Uint8Array(await blob.arrayBuffer()).subarray(0, 5));
    expect(head).toBe('%PDF-');
    expect(aiAdapter.note).toBe(
      'Saved as a PDF-based .ai file. Illustrator opens it; Illustrator-only editing data is not included.',
    );
    expect(aiAdapter.extensions).toEqual(['ai']);
    const pdfBlob = await pdfAdapter.export!(doc, { kind: 'all' }, pdfAdapter.defaults!, ctxFor(doc));
    expect(pdfBlob.type).toBe('application/pdf');
  });
});
