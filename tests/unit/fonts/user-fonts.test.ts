import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zlibSync } from 'fflate';
import {
  buildSfnt,
  readSfntNames,
  sniffFont,
  splitCollection,
  toSfntFaces,
  woffToSfnt,
} from '../../../src/fonts/sfnt';
import {
  addFaceForTests,
  addFontFiles,
  baseFamily,
  describeFace,
  embeddableFace,
  pickUserFace,
  registerDocumentFonts,
  removeUserFamily,
  resetUserFontsForTests,
  userFaces,
  userFamilies,
  weightFromStyle,
} from '../../../src/fonts/user';
import { getFontBytes } from '../../../src/fonts/loader';
import { filterFonts } from '../../../src/fonts/catalog';
import { readCurvs, writeCurvs } from '../../../src/formats/curvs';
import { createDocument, makeText } from '../../../src/core/document';
import { bytesToDataUrl } from '../../../src/formats/shared/bytes';

const fixture = (p: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/fonts', p)));
const GEIST = fixture('geist-latin-400-normal.ttf');
const WOFF2 = new Uint8Array(
  readFileSync(resolve(__dirname, '../../../public/fonts/geist-latin-500-normal.woff2')),
);

/** Tables of an sfnt, for building test containers. */
function tablesOf(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint16(4);
  return Array.from({ length: n }, (_, i) => {
    const r = 12 + i * 16;
    return {
      tag: String.fromCharCode(...b.subarray(r, r + 4)),
      checksum: dv.getUint32(r + 4),
      data: b.slice(dv.getUint32(r + 8), dv.getUint32(r + 8) + dv.getUint32(r + 12)),
    };
  });
}

/** A WOFF 1.0 file wrapping an sfnt (every table compressed). */
function toWoff(sfnt: Uint8Array): Uint8Array {
  // Per the WOFF spec, a table whose compressed form is not smaller is stored as is.
  const tables = tablesOf(sfnt).map((t) => {
    const z = zlibSync(t.data);
    return { ...t, comp: z.length < t.data.length ? z : t.data };
  });
  let size = 44 + tables.length * 20;
  const offsets = tables.map((t) => {
    const at = size;
    size += (t.comp.length + 3) & ~3;
    return at;
  });
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]);
  dv.setUint32(4, new DataView(sfnt.buffer, sfnt.byteOffset).getUint32(0));
  dv.setUint32(8, size);
  dv.setUint16(12, tables.length);
  tables.forEach((t, i) => {
    const r = 44 + i * 20;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    dv.setUint32(r + 4, offsets[i]);
    dv.setUint32(r + 8, t.comp.length);
    dv.setUint32(r + 12, t.data.length);
    dv.setUint32(r + 16, t.checksum);
    out.set(t.comp, offsets[i]);
  });
  return out;
}

/** A two-face collection made from one face (enough to exercise splitting). */
function toCollection(sfnt: Uint8Array): Uint8Array {
  const one = sfnt.length;
  const out = new Uint8Array(20 + one * 2);
  const dv = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66]);
  dv.setUint32(4, 0x00010000);
  dv.setUint32(8, 2);
  // Each face is a full copy whose table offsets are relative to the collection start.
  for (const [i, at] of [20, 20 + one].entries()) {
    dv.setUint32(12 + i * 4, at);
    const copy = sfnt.slice();
    const cv = new DataView(copy.buffer);
    for (let t = 0; t < cv.getUint16(4); t++)
      cv.setUint32(12 + t * 16 + 8, cv.getUint32(12 + t * 16 + 8) + at);
    out.set(copy, at);
  }
  return out;
}

beforeEach(() => resetUserFontsForTests());

describe('font containers', () => {
  it('sniffs every container', () => {
    expect(sniffFont(GEIST)).toBe('ttf');
    expect(sniffFont(WOFF2)).toBe('woff2');
    expect(sniffFont(toWoff(GEIST))).toBe('woff');
    expect(sniffFont(toCollection(GEIST))).toBe('ttc');
    expect(sniffFont(new Uint8Array(20))).toBeNull();
  });

  it('inflates WOFF back to the same tables', () => {
    const back = woffToSfnt(toWoff(GEIST));
    expect(tablesOf(back).map((t) => [t.tag, t.data.length])).toEqual(
      tablesOf(GEIST)
        .map((t) => [t.tag, t.data.length])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    );
  });

  it('splits collections and decodes WOFF2', async () => {
    const faces = splitCollection(toCollection(GEIST));
    expect(faces).toHaveLength(2);
    expect(readSfntNames(faces[1]).family).toBe('Geist');
    const [fromWoff2] = await toSfntFaces(WOFF2);
    expect(sniffFont(fromWoff2)).toBe('ttf');
    expect(readSfntNames(fromWoff2).weightClass).toBe(500);
    await expect(toSfntFaces(new Uint8Array(40))).rejects.toThrow(/not a font/);
  });

  it('rebuilds a valid table directory', () => {
    const rebuilt = buildSfnt(0x00010000, tablesOf(GEIST));
    expect(readSfntNames(rebuilt).family).toBe('Geist');
  });
});

describe('describing faces', () => {
  it('reads family, weight and style from the font itself', async () => {
    expect(await describeFace(GEIST)).toMatchObject({ family: 'Geist', weight: 400, style: 'normal' });
    const [medium] = await toSfntFaces(WOFF2);
    // The legacy family "Geist Medium" loses its style word.
    expect(await describeFace(medium)).toMatchObject({ family: 'Geist', weight: 500 });
  });

  it('understands style names', () => {
    expect(weightFromStyle('Semi Bold Italic')).toBe(600);
    expect(weightFromStyle('ExtraLight')).toBe(200);
    expect(weightFromStyle('Black')).toBe(900);
    expect(weightFromStyle('Regular')).toBe(400);
    expect(baseFamily('Inter Semi Bold Italic')).toBe('Inter');
    expect(baseFamily('Bold')).toBe('Bold');
  });
});

describe('the user font library', () => {
  it('adds uploads, picks the nearest face, and lists them for the picker', async () => {
    const { families, errors } = await addFontFiles([
      new File([GEIST], 'Geist.ttf'),
      new File([WOFF2], 'Geist-Medium.woff2'),
      new File([new Uint8Array(30)], 'notes.txt'),
    ]);
    expect(families).toEqual(['Geist']);
    expect(errors).toEqual([expect.stringMatching(/^notes\.txt: .*not a font/)]);
    expect(userFaces()).toHaveLength(2);
    expect(pickUserFace({ family: 'geist', weight: 600, style: 'normal' })?.weight).toBe(500);
    expect(pickUserFace({ family: 'Geist', weight: 300, style: 'italic' })?.weight).toBe(400);
    expect(pickUserFace({ family: 'Nope', weight: 400, style: 'normal' })).toBeNull();
    const [entry] = userFamilies();
    expect(entry).toMatchObject({ family: 'Geist', weights: [400, 500], source: 'upload', local: true });
    expect(filterFonts([entry], '', 'mine')).toHaveLength(1);
    expect(filterFonts([entry], '', 'device')).toHaveLength(0);
    // The loader hands out the uploaded bytes.
    expect(await getFontBytes({ family: 'Geist', weight: 400, style: 'normal' })).toBe(userFaces()[0].bytes);
  });

  it('keeps uploads for the next visit and removes them on request', async () => {
    await addFontFiles([new File([GEIST], 'Geist.ttf')]);
    resetUserFontsForTests();
    const { initUserFonts } = await import('../../../src/fonts/user');
    await initUserFonts();
    expect([...new Set(userFaces().map((f) => f.family))]).toEqual(['Geist']);
    await removeUserFamily('Geist');
    expect(userFaces()).toEqual([]);
  });

  it('variable fonts cover their whole weight range', () => {
    addFaceForTests({
      key: 'user:var',
      family: 'Flex',
      weight: 400,
      weights: [100, 900],
      style: 'normal',
      source: 'upload',
      name: 'Flex',
      bytes: GEIST,
    });
    expect(userFamilies()[0].weights).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(pickUserFace({ family: 'Flex', weight: 750, style: 'normal' })?.key).toBe('user:var');
  });

  it('installed fonts are referenced by name and never embedded', () => {
    addFaceForTests({
      key: 'system:X',
      family: 'Device Sans',
      weight: 400,
      style: 'normal',
      source: 'system',
      name: 'Device Sans',
      bytes: GEIST,
    });
    expect(embeddableFace({ family: 'Device Sans', weight: 400, style: 'normal' })).toBeNull();
    expect(userFamilies()[0].source).toBe('system');
  });
});

describe('fonts in .curvs files', () => {
  it('embeds uploaded fonts the document uses, and restores them on open', async () => {
    await addFontFiles([new File([GEIST], 'Geist.ttf')]);
    const doc = createDocument({ width: 100, height: 100, units: 'px' });
    doc.artboards[0].children = [makeText(0, 0, 'Hi')];
    const back = await readCurvs(await writeCurvs(doc));
    expect(back.fonts).toEqual([
      { family: 'Geist', style: 'Regular', file: expect.stringMatching(/^fonts\/[0-9a-f]{64}\.ttf$/) },
    ]);
    expect(back.assets[back.fonts[0].file!]).toMatch(/^data:font\/ttf;base64,/);

    // On another machine (no upload), the embedded copy is what the text uses.
    resetUserFontsForTests();
    await registerDocumentFonts(back);
    expect(userFaces()).toMatchObject([{ family: 'Geist', source: 'document' }]);
    expect(embeddableFace({ family: 'Geist', weight: 400, style: 'normal' })).not.toBeNull();
    // Saving again keeps the font.
    const again = await readCurvs(await writeCurvs(back));
    expect(again.fonts).toHaveLength(1);
  });

  it('leaves catalogue and installed fonts as names', async () => {
    const doc = createDocument({ width: 100, height: 100, units: 'px' });
    doc.artboards[0].children = [makeText(0, 0, 'Hi')];
    const back = await readCurvs(await writeCurvs(doc));
    expect(back.fonts).toEqual([]);
    void bytesToDataUrl;
  });
});
