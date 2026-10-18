import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zlibSync } from 'fflate';
import { bytesBlob, crc32, readImageSize, dataUrlToBytes, utf8 } from '../../../src/formats/shared/bytes';
import {
  decodePng,
  dpiToPpm,
  getPngDpi,
  makeChunk,
  readChunks,
  setPngDpi,
} from '../../../src/formats/shared/png';
import { planRaster, exportRaster } from '../../../src/formats/raster/export';
import { imageNodeFromFile, importImage, IMAGE_NOTE } from '../../../src/formats/raster/import';
import { rasterAdapter } from '../../../src/formats/raster';
import { PNG_1PX, ctxFor, sampleDoc } from './helpers';

const raster = vi.hoisted(() => ({
  renderToCanvas: vi.fn(),
  canvasToBlob: vi.fn(),
  scopeBounds: vi.fn(),
}));

vi.mock('../../../src/render/raster', () => raster);

const png = () => dataUrlToBytes(PNG_1PX)!.bytes;

/** Build a PNG from RGBA pixels with filter type `filter` on every row. */
function encodePng(w: number, h: number, rgba: number[], filter = 0): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(filter);
    for (let x = 0; x < w * 4; x++) {
      const v = rgba[y * w * 4 + x];
      const left = x >= 4 ? rgba[y * w * 4 + x - 4] : 0;
      const up = y ? rgba[(y - 1) * w * 4 + x] : 0;
      raw.push(filter === 1 ? (v - left) & 255 : filter === 2 ? (v - up) & 255 : v);
    }
  }
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlibSync(new Uint8Array(raw))),
    makeChunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('PNG utilities', () => {
  it('computes CRC-32 like zlib', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(utf8(''))).toBe(0);
  });

  it('inserts a pHYs chunk after IHDR with a valid CRC', () => {
    const out = setPngDpi(png(), 144);
    const chunks = readChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const phys = chunks[1];
    const dv = new DataView(phys.data.buffer, phys.data.byteOffset, 9);
    expect(dv.getUint32(0)).toBe(dpiToPpm(144));
    expect(dv.getUint32(4)).toBe(5669);
    expect(phys.data[8]).toBe(1);
    const stored = new DataView(out.buffer).getUint32(phys.offset + 8 + 9);
    expect(stored).toBe(crc32(out, phys.offset + 4, phys.offset + 8 + 9));
    expect(getPngDpi(out)).toBeCloseTo(144, 0);
  });

  it('replaces an existing pHYs chunk', () => {
    const twice = setPngDpi(setPngDpi(png(), 72), 216);
    expect(readChunks(twice).filter((c) => c.type === 'pHYs')).toHaveLength(1);
    expect(getPngDpi(twice)).toBeCloseTo(216, 0);
  });

  it('decodes PNG pixels with filters', () => {
    const px = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 10, 20, 30, 40];
    for (const f of [0, 1, 2]) {
      const d = decodePng(encodePng(2, 2, px, f))!;
      expect(d.width).toBe(2);
      expect(Array.from(d.rgba)).toEqual(px);
    }
    const one = decodePng(png())!;
    expect([one.width, one.height]).toEqual([1, 1]);
  });

  it('reads image sizes from headers', () => {
    expect(readImageSize(png())).toEqual({ width: 1, height: 1 });
    expect(readImageSize(encodePng(3, 2, new Array(24).fill(0)))).toEqual({ width: 3, height: 2 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 0, 7, 0, 0, 0, 0]);
    expect(readImageSize(gif)).toEqual({ width: 5, height: 7 });
    // Minimal JPEG: SOI, APP0 (len 2), SOF0 with 16×9.
    const jpg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xc0, 0, 11, 8, 0, 9, 0, 16, 3, 1, 0x11, 0, 0, 0,
    ]);
    expect(readImageSize(jpg)).toEqual({ width: 16, height: 9 });
    // WebP VP8X: canvas 300×200 (stored minus one, 24-bit LE).
    const webp = new Uint8Array(30);
    webp.set(utf8('RIFF'), 0);
    webp.set(utf8('WEBPVP8X'), 8);
    webp.set([299 & 255, 299 >> 8, 0, 199, 0, 0], 24);
    expect(readImageSize(webp)).toEqual({ width: 300, height: 200 });
  });
});

describe('raster options', () => {
  it('derives pixel size from scale, width or height', () => {
    expect(planRaster('png', { width: 400, height: 300 }, { scale: 2 })).toMatchObject({
      width: 800,
      height: 600,
      dpi: 144,
    });
    expect(planRaster('png', { width: 400, height: 300 }, { scale: 1, width: 1000 })).toMatchObject({
      width: 1000,
      height: 750,
      scale: 2.5,
    });
    expect(planRaster('png', { width: 400, height: 300 }, { height: 150 })).toMatchObject({
      width: 200,
      height: 150,
      dpi: 36,
    });
    expect(planRaster('png', { width: 400, height: 300 }, { scale: 3 }).dpi).toBe(216);
  });
  it('forces an opaque matte for JPG and clamps quality', () => {
    expect(planRaster('jpg', { width: 10, height: 10 }, { transparent: true }).transparent).toBe(false);
    expect(planRaster('webp', { width: 10, height: 10 }, { transparent: true }).transparent).toBe(true);
    expect(planRaster('jpg', { width: 10, height: 10 }, { quality: 140 }).quality).toBe(100);
  });
  it('caps huge outputs to the canvas limit', () => {
    const p = planRaster('png', { width: 10000, height: 100 }, { scale: 4 });
    expect(p.width).toBe(16384);
  });
});

describe('raster export (renderer mocked)', () => {
  beforeEach(() => {
    raster.scopeBounds.mockReturnValue({ rect: { x: 0, y: 0, width: 400, height: 300 }, artboardId: 'ab' });
    raster.renderToCanvas.mockReturnValue({});
  });

  it('renders at scale and writes the DPI into PNGs', async () => {
    raster.canvasToBlob.mockResolvedValue(bytesBlob(png(), 'image/png'));
    const doc = sampleDoc();
    const blob = await exportRaster(
      'png',
      doc,
      { kind: 'artboard', id: doc.artboards[0].id },
      { scale: 2, transparent: true, antialias: false },
      ctxFor(doc),
    );
    expect(raster.renderToCanvas).toHaveBeenCalledWith(doc, expect.anything(), expect.anything(), {
      scale: 2,
      transparent: true,
      antialias: false,
      matte: '#ffffff',
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(getPngDpi(bytes)).toBeCloseTo(144, 0);
    expect(blob.type).toBe('image/png');
  });

  it('passes quality to JPG and WebP and never makes JPG transparent', async () => {
    raster.canvasToBlob.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    const doc = sampleDoc();
    await exportRaster(
      'jpg',
      doc,
      { kind: 'all' },
      { scale: 1, quality: 70, transparent: true },
      ctxFor(doc),
    );
    expect(raster.canvasToBlob).toHaveBeenLastCalledWith(expect.anything(), 'image/jpeg', 0.7);
    expect(raster.renderToCanvas.mock.lastCall![3]).toMatchObject({ transparent: false });
    raster.canvasToBlob.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
    await rasterAdapter('webp').export!(
      doc,
      { kind: 'all' },
      { scale: 1, quality: 50, transparent: true, antialias: true },
      ctxFor(doc),
    );
    expect(raster.canvasToBlob).toHaveBeenLastCalledWith(expect.anything(), 'image/webp', 0.5);
  });

  it('notes when only one of several artboards fits in an image', async () => {
    raster.canvasToBlob.mockResolvedValue(bytesBlob(png(), 'image/png'));
    const doc = sampleDoc();
    doc.artboards.push({ ...doc.artboards[0], id: 'ab_2' });
    const warnings: string[] = [];
    await exportRaster('png', doc, { kind: 'all' }, {}, ctxFor(doc, warnings));
    expect(warnings).toContain('Images hold one artboard. The active artboard was exported.');
  });
});

describe('image import', () => {
  it('places a bitmap as an image node sized from its header', async () => {
    const bytes = encodePng(30, 20, new Array(30 * 20 * 4).fill(255));
    const { node, assetKey, dataUrl } = await imageNodeFromFile(bytes);
    expect(node.type).toBe('image');
    expect([node.width, node.height]).toEqual([30, 20]);
    expect(assetKey).toMatch(/^assets\/[0-9a-f]{64}\.png$/);
    expect(node.asset).toBe(assetKey);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('creates a document with an honest note', async () => {
    const { doc, report } = await importImage(encodePng(8, 4, new Array(128).fill(0)), {
      fileName: 'photo.png',
    });
    expect(doc.artboards[0].width).toBe(8);
    expect(doc.artboards[0].height).toBe(4);
    expect(doc.artboards[0].children[0].name).toBe('photo');
    expect(Object.keys(doc.assets)).toHaveLength(1);
    expect(report.warnings).toEqual([IMAGE_NOTE]);
    expect(IMAGE_NOTE).toBe('Placed as an image. Image Trace arrives in a later version.');
  });

  it('rejects non-images', async () => {
    await expect(imageNodeFromFile(utf8('hello'))).rejects.toThrow(/not an image/);
  });
});
