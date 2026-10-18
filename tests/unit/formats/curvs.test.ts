import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readCurvs, writeCurvs, curvsAdapter } from '../../../src/formats/curvs';
import { sha256Hex, dataUrlToBytes, bytesToDataUrl, utf8 } from '../../../src/formats/shared/bytes';
import { makeRect } from '../../../src/core/document';
import type { CurvsDocument, ImageNode } from '../../../src/core/types';
import { PNG_1PX, ctxFor, fixture, sampleDoc } from './helpers';

/** Local file headers in archive order, with compression method. */
function zipEntries(bytes: Uint8Array) {
  const out: { name: string; method: number }[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 < bytes.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const csize = dv.getUint32(i + 18, true);
    const nlen = dv.getUint16(i + 26, true);
    const xlen = dv.getUint16(i + 28, true);
    out.push({ name: strFromU8(bytes.subarray(i + 30, i + 30 + nlen)), method });
    i += 30 + nlen + xlen + csize;
  }
  return out;
}

describe('.curvs helpers', () => {
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('converts data URLs both ways', () => {
    const d = dataUrlToBytes(PNG_1PX)!;
    expect(d.mime).toBe('image/png');
    expect(d.bytes[1]).toBe(0x50);
    expect(bytesToDataUrl(d.bytes, d.mime)).toBe(PNG_1PX);
    expect(dataUrlToBytes('data:text/plain,hi%20there')!.bytes).toEqual(utf8('hi there'));
    expect(dataUrlToBytes('nope')).toBeNull();
  });
});

describe('.curvs writer', () => {
  it('writes mimetype first and stored, then manifest and document', async () => {
    const bytes = await writeCurvs(sampleDoc(), { thumbnail: new Uint8Array([1, 2, 3]) });
    const entries = zipEntries(bytes);
    expect(entries[0]).toEqual({ name: 'mimetype', method: 0 });
    expect(entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['manifest.json', 'document.json', 'thumbnail.png']),
    );
    const files = unzipSync(bytes);
    expect(strFromU8(files.mimetype)).toBe('application/x-curvesmith');
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest).toMatchObject({
      format: 'curvs',
      formatVersion: 1,
      minReaderVersion: 1,
      document: 'document.json',
      thumbnail: 'thumbnail.png',
    });
    expect(manifest.generator).toMatch(/^Curvesmith /);
    const json = JSON.parse(strFromU8(files['document.json']));
    expect(json.assets).toBeUndefined();
    expect(files['thumbnail.png']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('stores assets by content hash and drops unreferenced ones', async () => {
    const doc = sampleDoc();
    doc.assets['assets/unused.png'] = PNG_1PX.replace('AAAAAQ', 'AAAAAg');
    const bytes = await writeCurvs(doc);
    const files = unzipSync(bytes);
    const hash = await sha256Hex(dataUrlToBytes(PNG_1PX)!.bytes);
    const assetFiles = Object.keys(files).filter((k) => k.startsWith('assets/'));
    expect(assetFiles).toEqual([`assets/${hash}.png`]);
    const json = JSON.parse(strFromU8(files['document.json']));
    const img = json.artboards[0].children.find((n: { type: string }) => n.type === 'image');
    expect(img.asset).toBe(`assets/${hash}.png`);
  });

  it('rounds numbers to 4 decimals', async () => {
    const doc = sampleDoc();
    doc.artboards[0].children[0].transform = [1, 0, 0, 1, 1.234567891, 2.00004999];
    const files = unzipSync(await writeCurvs(doc));
    const text = strFromU8(files['document.json']);
    expect(text).toContain('[1,0,0,1,1.2346,2]');
  });
});

describe('.curvs round trip', () => {
  it('write → read gives the same document (ids, geometry, assets)', async () => {
    const doc = sampleDoc();
    const back = await readCurvs(await writeCurvs(doc));
    const hash = await sha256Hex(dataUrlToBytes(PNG_1PX)!.bytes);
    // The file stores numbers with at most 4 decimals.
    const expected: CurvsDocument = JSON.parse(
      JSON.stringify(doc, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)),
    );
    const img = expected.artboards[0].children.find((n) => n.type === 'image') as ImageNode;
    img.asset = `assets/${hash}.png`;
    expected.assets = { [img.asset]: PNG_1PX };
    const { extra: _a, ...restBack } = back;
    const { extra: _b, ...restExpected } = expected;
    expect(restBack).toEqual(restExpected);
    expect(back.extra.$created).toBeTypeOf('string');
  });

  it('keeps unknown keys from newer writers and writes them back', async () => {
    const bytes = await writeCurvs(sampleDoc());
    const files = unzipSync(bytes);
    const json = JSON.parse(strFromU8(files['document.json']));
    json.timeline = { frames: 3 };
    json.artboards[0].children[0].sparkle = 7;
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.formatVersion = 3;
    manifest.vendor = 'future';
    files['document.json'] = strToU8(JSON.stringify(json));
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const doc = await readCurvs(zipSync(files));
    expect(doc.artboards[0].children[0].extra).toEqual({ sparkle: 7 });
    const again = unzipSync(await writeCurvs(doc));
    const json2 = JSON.parse(strFromU8(again['document.json']));
    expect(json2.timeline).toEqual({ frames: 3 });
    expect(json2.artboards[0].children[0].sparkle).toBe(7);
    expect(json2.extra).toEqual({});
    expect(JSON.parse(strFromU8(again['manifest.json'])).vendor).toBe('future');
  });

  it('refuses files that need a newer reader', async () => {
    const files = unzipSync(await writeCurvs(sampleDoc()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.minReaderVersion = 2;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    await expect(readCurvs(zipSync(files))).rejects.toThrow(/needs a newer Curvesmith/);
  });

  it('rejects damaged and foreign files clearly', async () => {
    await expect(readCurvs(new Uint8Array([1, 2, 3]))).rejects.toThrow(/damaged/);
    await expect(readCurvs(zipSync({ 'a.txt': strToU8('x') }))).rejects.toThrow(/no manifest/);
    await expect(readCurvs(zipSync({ 'manifest.json': strToU8('{"format":"other"}') }))).rejects.toThrow(
      /not a .curvs file/,
    );
  });

  it('reads the golden fixture', async () => {
    const doc = await readCurvs(fixture('curvs/golden.curvs'));
    expect(doc.artboards).toHaveLength(1);
    expect(doc.artboards[0].children.map((c) => c.type)).toEqual([
      'rect',
      'ellipse',
      'path',
      'group',
      'text',
      'image',
    ]);
    const img = doc.artboards[0].children[5] as ImageNode;
    expect(doc.assets[img.asset]).toBe(PNG_1PX);
  });

  it('works through the adapter with a thumbnail blob', async () => {
    const doc = sampleDoc();
    doc.artboards[0].children.push(makeRect(0, 0, 1, 1));
    const blob = await curvsAdapter.export!(
      doc,
      { kind: 'all' },
      { thumbnail: new Blob([new Uint8Array([9])]) },
      ctxFor(doc),
    );
    expect(blob.type).toBe('application/x-curvesmith');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(unzipSync(bytes)['thumbnail.png']).toEqual(new Uint8Array([9]));
    const { doc: back, report } = await curvsAdapter.import!(bytes, { fileName: 'x.curvs' });
    expect(back.artboards[0].children).toHaveLength(7);
    expect(report.warnings).toEqual([]);
  });
});
