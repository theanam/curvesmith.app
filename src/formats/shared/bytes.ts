/* Byte helpers shared by every format: hashing, data URLs, mime sniffing, CRC32, image headers. */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const utf8 = (s: string) => textEncoder.encode(s);
export const fromUtf8 = (b: Uint8Array) => textDecoder.decode(b);

/** Lower-case hex SHA-256 of some bytes (WebCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64Encode(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function base64Decode(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Decode a data URL (base64 or percent-encoded). Returns null for anything else. */
export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/s.exec(url);
  if (!m) return null;
  const mime = (m[1] || 'text/plain').toLowerCase();
  const isB64 = /;base64/i.test(m[2]);
  try {
    return { bytes: isB64 ? base64Decode(m[3]) : utf8(decodeURIComponent(m[3])), mime };
  } catch {
    return null;
  }
}

export const bytesToDataUrl = (bytes: Uint8Array, mime: string) =>
  `data:${mime};base64,${base64Encode(bytes)}`;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
};

export const extForMime = (mime: string) => EXT_BY_MIME[mime.toLowerCase()] ?? 'bin';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

export const mimeForExt = (ext: string) =>
  MIME_BY_EXT[ext.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream';

/** Image mime type from magic bytes. */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

export const ascii = (b: Uint8Array, start: number, n: number) =>
  String.fromCharCode(...b.subarray(start, start + n));

/** Natural pixel size from PNG, JPEG, GIF or WebP headers (no decoding, no canvas). */
export function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  const mime = sniffImageMime(b);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (mime === 'image/png' && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (mime === 'image/gif' && b.length >= 10)
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      const segLen = dv.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + segLen;
    }
    return null;
  }
  if (mime === 'image/webp' && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ')
      return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h };
    }
  }
  return null;
}

/** JPEG color component count (1 gray, 3 RGB, 4 CMYK) from the SOF marker. */
export function jpegComponents(b: Uint8Array): number {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const segLen = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return b[i + 9];
    i += 2 + segLen;
  }
  return 3;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO-HDLC, as used by PNG and ZIP). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** Wraps bytes in a Blob (copying into a plain ArrayBuffer keeps the Blob constructor typings happy). */
export function bytesBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

/** Growable little/big-endian byte writer used by the binary writers. */
export class ByteWriter {
  buf = new Uint8Array(1024);
  view = new DataView(this.buf.buffer);
  length = 0;
  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.length, v | 0, true);
    this.length += 4;
  }
  f32(v: number) {
    this.ensure(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  pad4() {
    while (this.length % 4) this.u8(0);
  }
  setU32(at: number, v: number) {
    this.view.setUint32(at, v >>> 0, true);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}
