/* PNG chunk utilities (pHYs insertion with CRC32) and a small decoder for 8-bit, non-interlaced PNGs,
   used by writers that need raw pixels (EPS, EMF). */
import { unzlibSync, zlibSync } from 'fflate';
import { ascii, crc32 } from './bytes';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const isPng = (b: Uint8Array) => b.length > 8 && SIG.every((v, i) => b[i] === v);

export type PngChunk = { type: string; data: Uint8Array; offset: number };

export function readChunks(png: Uint8Array): PngChunk[] {
  if (!isPng(png)) throw new Error('Not a PNG file.');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: PngChunk[] = [];
  let i = 8;
  while (i + 12 <= png.length) {
    const len = dv.getUint32(i);
    const type = ascii(png, i + 4, 4);
    out.push({ type, data: png.subarray(i + 8, i + 8 + len), offset: i });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

export function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Pixels per meter for a DPI value (pHYs unit 1 = meter). */
export const dpiToPpm = (dpi: number) => Math.round(dpi / 0.0254);

/** Insert (or replace) the pHYs chunk right after IHDR. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const chunks = readChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR chunk.');
  const ppm = dpiToPpm(dpi);
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  data[8] = 1;
  const phys = makeChunk('pHYs', data);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === 'pHYs') continue;
    parts.push(png.subarray(c.offset, c.offset + 12 + c.data.length));
    if (c.type === 'IHDR') parts.push(phys);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** DPI from a PNG's pHYs chunk, or null. */
export function getPngDpi(png: Uint8Array): number | null {
  const c = readChunks(png).find((x) => x.type === 'pHYs');
  if (!c || c.data[8] !== 1) return null;
  const ppm = new DataView(c.data.buffer, c.data.byteOffset, 9).getUint32(0);
  return Math.round(ppm * 0.0254 * 100) / 100;
}

export type Pixels = { width: number; height: number; rgba: Uint8Array };

/** Decode 8-bit (and 1/2/4-bit gray/palette) non-interlaced PNGs to RGBA. Returns null when unsupported. */
export function decodePng(png: Uint8Array): Pixels | null {
  let chunks: PngChunk[];
  try {
    chunks = readChunks(png);
  } catch {
    return null;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) return null;
  const hd = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const width = hd.getUint32(0);
  const height = hd.getUint32(4);
  const depth = ihdr.data[8];
  const ctype = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (interlace !== 0 || depth > 8 || width * height > 64e6) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0 | 2 | 3 | 4 | 6];
  if (!channels) return null;
  const plte = chunks.find((c) => c.type === 'PLTE')?.data;
  const trns = chunks.find((c) => c.type === 'tRNS')?.data;
  const idat = chunks.filter((c) => c.type === 'IDAT');
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.data.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c.data, o);
    o += c.data.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(joined);
  } catch {
    return null;
  }
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < height * (stride + 1)) return null;
  const lines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    const prev = y ? lines.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (row: Uint8Array, idx: number) => {
    if (depth === 8) return row[idx];
    const bitPos = idx * depth;
    const byte = row[bitPos >> 3];
    const shift = 8 - depth - (bitPos & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scaleGray = depth < 8 && ctype === 0 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (ctype === 3) {
        const i = sample(row, x);
        rgba[d] = plte?.[i * 3] ?? 0;
        rgba[d + 1] = plte?.[i * 3 + 1] ?? 0;
        rgba[d + 2] = plte?.[i * 3 + 2] ?? 0;
        rgba[d + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (ctype === 0 || ctype === 4) {
        const g = Math.round(sample(row, x * channels) * scaleGray);
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
        rgba[d + 3] = ctype === 4 ? row[x * 2 + 1] : 255;
      } else {
        rgba[d] = row[x * channels];
        rgba[d + 1] = row[x * channels + 1];
        rgba[d + 2] = row[x * channels + 2];
        rgba[d + 3] = ctype === 6 ? row[x * 4 + 3] : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** Encode RGBA pixels as a PNG (filter 0 rows, zlib via fflate). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [
    new Uint8Array(SIG),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlibSync(raw, { level: 6 })),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
