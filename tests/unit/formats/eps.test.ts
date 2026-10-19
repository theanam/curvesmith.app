import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportEpsString } from '../../../src/formats/eps/export';
import { epsAdapter } from '../../../src/formats/eps';
import { createDocument, makeRect, makeText, makeArtboard } from '../../../src/core/document';
import { ctxFor, sampleDoc } from './helpers';
import { convertDocumentColors } from '../../../src/core/color';

const fontState = { available: true };
vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () =>
    fontState.available
      ? new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/fonts/geist-latin-400-normal.ttf')))
      : null,
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

/** Strip hex image data and comments so operator counts are about code. */
const code = (eps: string) =>
  eps
    .split('\n')
    .filter((l) => !l.startsWith('%') && !/^[0-9a-f]+$/.test(l))
    .join('\n');

const count = (s: string, word: string) => (s.match(new RegExp(`(^|\\s)${word}(\\s|$)`, 'gm')) ?? []).length;

describe('EPS export', () => {
  it('writes a DSC header with bounding boxes', async () => {
    const doc = sampleDoc();
    const eps = await exportEpsString(doc, { kind: 'all' }, {}, ctxFor(doc));
    const lines = eps.split('\n');
    expect(lines[0]).toBe('%!PS-Adobe-3.0 EPSF-3.0');
    expect(eps).toContain('%%BoundingBox: 0 0 400 300');
    expect(eps).toContain('%%HiResBoundingBox: 0 0 400 300');
    expect(eps).toContain('%%Creator: Curvesmith');
    expect(eps).toContain('%%LanguageLevel: 3');
    expect(eps).toContain('%%EndComments');
    expect(eps.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('balances gsave/grestore and save/restore', async () => {
    const doc = sampleDoc();
    const c = code(
      await exportEpsString(doc, { kind: 'all' }, { bleed: true, cropMarks: true }, ctxFor(doc)),
    );
    expect(count(c, 'gsave')).toBeGreaterThan(5);
    expect(count(c, 'gsave')).toBe(count(c, 'grestore'));
    expect(count(c, 'save')).toBe(count(c, 'restore'));
    expect(count(c, 'begin')).toBe(count(c, 'end'));
  });

  it('draws paths, strokes, dashes and gradients as shadings', async () => {
    const doc = sampleDoc();
    const eps = await exportEpsString(doc, { kind: 'all' }, {}, ctxFor(doc));
    expect(eps).toMatch(/ c( |$)/m);
    expect(eps).toMatch(/ m /);
    expect(eps).toMatch(/^h$|\sh(\s|$)/m);
    expect(eps).toMatch(/setrgbcolor\nf$/m);
    expect(eps).toContain('setlinewidth 1 setlinecap 1 setlinejoin');
    expect(eps).toContain('[6 3] 0 setdash');
    expect(eps).toMatch(/<< \/ShadingType 2 \/ColorSpace \/DeviceRGB \/Coords \[-50 0 50 0\]/);
    expect(eps).toContain('shfill');
    // PNG image decoded to hex samples.
    expect(eps).toContain('/ASCIIHexDecode filter >> image');
  });

  it('writes CMYK inks and shadings for CMYK documents', async () => {
    const doc = sampleDoc();
    convertDocumentColors(doc, 'cmyk');
    const eps = await exportEpsString(doc, { kind: 'all' }, {}, ctxFor(doc));
    expect(eps).toMatch(/setcmykcolor\nf$/m);
    expect(eps).not.toContain('setrgbcolor');
    expect(eps).toContain('/ColorSpace /DeviceCMYK');
  });

  it('outlines text with the font, and falls back to Helvetica without it', async () => {
    const doc = createDocument({ width: 100, height: 50, units: 'px' });
    doc.artboards[0].children = [makeText(5, 5, 'Hi (there)')];
    const outlined = await exportEpsString(doc, { kind: 'all' }, {}, ctxFor(doc));
    expect(outlined).not.toContain('findfont');
    fontState.available = false;
    const warnings: string[] = [];
    const live = await exportEpsString(doc, { kind: 'all' }, {}, ctxFor(doc, warnings));
    fontState.available = true;
    expect(live).toContain('/Helvetica findfont');
    expect(live).toContain('(Hi \\(there\\)) show');
    expect(warnings).toContain('Text without an available font was set in Helvetica.');
  });

  it('notes transparency and places all artboards on one page', async () => {
    const doc = sampleDoc();
    const ab = makeArtboard('Back', 100, 100, 500, 0);
    ab.children = [makeRect(0, 0, 10, 10)];
    doc.artboards.push(ab);
    const warnings: string[] = [];
    const eps = await exportEpsString(doc, { kind: 'all' }, {}, ctxFor(doc, warnings));
    expect(eps).toContain('%%BoundingBox: 0 0 600 300');
    expect(warnings).toContain('EPS has no transparency, so see-through objects were drawn opaque.');
  });

  it('exports through the adapter and cannot import', async () => {
    const doc = sampleDoc();
    const blob = await epsAdapter.export!(doc, { kind: 'all' }, epsAdapter.defaults!, ctxFor(doc));
    expect(blob.type).toBe('application/postscript');
    expect(epsAdapter.canImport).toBe(false);
  });
});
