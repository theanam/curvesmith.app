/* Font file containers → plain sfnt (TrueType / OpenType) faces, the one form the canvas (FontFace),
   outlining (opentype.js) and PDF embedding (fontkit) all read. WOFF tables are inflated here; WOFF2 goes
   through Google's decoder (wawoff2, loaded on demand); collections (.ttc) split into single faces. */
import { unzlibSync } from 'fflate';

export type FontContainer = 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc';

const tag = (b: Uint8Array, at = 0) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

export function sniffFont(b: Uint8Array): FontContainer | null {
  if (b.length < 12) return null;
  const t = tag(b);
  if (t === 'wOF2') return 'woff2';
  if (t === 'wOFF') return 'woff';
  if (t === 'ttcf') return 'ttc';
  if (t === 'OTTO') return 'otf';
  if (t === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf';
  return null;
}

type Table = { tag: string; data: Uint8Array; checksum: number };

const pad4 = (n: number) => (n + 3) & ~3;

/** Assemble an sfnt from tables (sorted by tag, 4-byte aligned, with a valid table directory). */
export function buildSfnt(flavor: number, tables: Table[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log++;
  }
  const headerSize = 12 + n * 16;
  let size = headerSize;
  for (const t of sorted) size += pad4(t.data.length);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  dv.setUint16(6, pow * 16);
  dv.setUint16(8, log);
  dv.setUint16(10, n * 16 - pow * 16);
  let offset = headerSize;
  sorted.forEach((t, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    dv.setUint32(rec + 4, t.checksum >>> 0);
    dv.setUint32(rec + 8, offset);
    dv.setUint32(rec + 12, t.data.length);
    out.set(t.data, offset);
    offset += pad4(t.data.length);
  });
  return out;
}

/** Tables of the sfnt starting at `at` (a single font, or one face inside a collection). */
function readTables(b: Uint8Array, at: number): { flavor: number; tables: Table[] } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = dv.getUint32(at);
  const n = dv.getUint16(at + 4);
  const tables: Table[] = [];
  for (let i = 0; i < n; i++) {
    const rec = at + 12 + i * 16;
    const off = dv.getUint32(rec + 8);
    const len = dv.getUint32(rec + 12);
    if (off + len > b.length) throw new Error('This font file is damaged.');
    tables.push({ tag: tag(b, rec), checksum: dv.getUint32(rec + 4), data: b.subarray(off, off + len) });
  }
  return { flavor, tables };
}

/** WOFF 1.0 → sfnt: each table is zlib-compressed unless its compressed length equals its original length. */
export function woffToSfnt(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = dv.getUint32(4);
  const n = dv.getUint16(12);
  const tables: Table[] = [];
  for (let i = 0; i < n; i++) {
    const rec = 44 + i * 20;
    const off = dv.getUint32(rec + 4);
    const compLen = dv.getUint32(rec + 8);
    const origLen = dv.getUint32(rec + 12);
    const raw = b.subarray(off, off + compLen);
    const data = compLen < origLen ? unzlibSync(raw) : raw.slice();
    if (data.length !== origLen) throw new Error('This font file is damaged.');
    tables.push({ tag: tag(b, rec), checksum: dv.getUint32(rec + 16), data });
  }
  return buildSfnt(flavor, tables);
}

/** Each face of a TrueType/OpenType collection as a standalone sfnt. */
export function splitCollection(b: Uint8Array): Uint8Array[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getUint32(8);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const { flavor, tables } = readTables(b, dv.getUint32(12 + i * 4));
    out.push(
      buildSfnt(
        flavor,
        tables.map((t) => ({ ...t, data: t.data.slice() })),
      ),
    );
  }
  return out;
}

type Woff2Decoder = (b: Uint8Array) => Promise<Uint8Array>;
let woff2: Promise<Woff2Decoder> | null = null;

const NODE_DECODER = 'wawoff2/decompress.js';

const inNode = () =>
  typeof process === 'object' &&
  typeof (process as { versions?: { node?: string } }).versions?.node === 'string';

/**
 * wawoff2's Emscripten glue only exports its module under Node. In the browser its source is run with our
 * own module object, which the runtime fills in and calls back once the WebAssembly is ready.
 */
const loadWoff2 = () =>
  (woff2 ??= inNode()
    ? // Kept out of the browser bundle: this branch only runs under Node (tests and scripts).
      import(/* @vite-ignore */ NODE_DECODER).then((m) => {
        const mod = m as unknown as { default?: Woff2Decoder } | Woff2Decoder;
        return (typeof mod === 'function' ? mod : mod.default!) as Woff2Decoder;
      })
    : import('wawoff2/build/decompress_binding.js?raw').then(
        ({ default: source }) =>
          new Promise<Woff2Decoder>((resolve, reject) => {
            const Module: Record<string, unknown> = {
              onRuntimeInitialized: () =>
                resolve(async (b) => {
                  const out = (Module.decompress as (b: Uint8Array) => Uint8Array | false)(b);
                  if (out === false) throw new Error('This WOFF2 font is damaged.');
                  return out;
                }),
              onAbort: () => reject(new Error('WOFF2 fonts could not be read in this browser.')),
            };
            try {
              new Function('Module', source)(Module);
            } catch (e) {
              reject(e);
            }
          }),
      ));

/** Every face in a font file, as sfnt bytes. Throws a friendly error for files that are not fonts. */
export async function toSfntFaces(bytes: Uint8Array): Promise<Uint8Array[]> {
  switch (sniffFont(bytes)) {
    case 'ttf':
    case 'otf':
      return [bytes];
    case 'woff':
      return [woffToSfnt(bytes)];
    case 'woff2': {
      const decode = await loadWoff2();
      const sfnt = await decode(bytes);
      return sniffFont(sfnt) === 'ttc' ? splitCollection(sfnt) : [new Uint8Array(sfnt)];
    }
    case 'ttc':
      return splitCollection(bytes);
    default:
      throw new Error('This file is not a font Curvesmith can read. Use TTF, OTF, WOFF or WOFF2.');
  }
}

/* ---------- naming tables ---------- */

export type SfntNames = {
  family?: string;
  subfamily?: string;
  fullName?: string;
  postscript?: string;
  typographicFamily?: string;
  typographicSubfamily?: string;
  /** OS/2 usWeightClass. */
  weightClass?: number;
  /** OS/2 fsSelection italic bit, or head.macStyle italic bit. */
  italic: boolean;
  /** A variable font's weight axis (fvar "wght"): [min, default, max]. */
  weightAxis?: [number, number, number];
};

const utf16be = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
};
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

/** Family names, weight class and italic flag from an sfnt's name, OS/2 and head tables. */
export function readSfntNames(b: Uint8Array): SfntNames {
  const { tables } = readTables(b, 0);
  const find = (t: string) => tables.find((x) => x.tag === t)?.data;
  const out: SfntNames = { italic: false };
  const name = find('name');
  if (name && name.length >= 6) {
    const dv = new DataView(name.buffer, name.byteOffset, name.byteLength);
    const count = dv.getUint16(2);
    const strings = dv.getUint16(4);
    // Best record per name id: Windows English first, then any Windows, then Unicode, then Mac Roman.
    const score = (platform: number, lang: number) =>
      platform === 3 ? (lang === 0x409 ? 4 : 3) : platform === 0 ? 2 : platform === 1 && lang === 0 ? 1 : 0;
    const best = new Map<number, { s: number; v: string }>();
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      if (r + 12 > name.length) break;
      const platform = dv.getUint16(r);
      const lang = dv.getUint16(r + 4);
      const id = dv.getUint16(r + 6);
      const len = dv.getUint16(r + 8);
      const off = strings + dv.getUint16(r + 10);
      const s = score(platform, lang);
      if (!s || off + len > name.length || (best.get(id)?.s ?? 0) >= s) continue;
      const raw = name.subarray(off, off + len);
      best.set(id, { s, v: (platform === 1 ? latin1(raw) : utf16be(raw)).replace(/\0/g, '').trim() });
    }
    const get = (id: number) => best.get(id)?.v || undefined;
    out.family = get(1);
    out.subfamily = get(2);
    out.fullName = get(4);
    out.postscript = get(6);
    out.typographicFamily = get(16);
    out.typographicSubfamily = get(17);
  }
  const os2 = find('OS/2');
  if (os2 && os2.length >= 64) {
    const dv = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    out.weightClass = dv.getUint16(4);
    out.italic = !!(dv.getUint16(62) & 1);
  }
  const fvar = find('fvar');
  if (fvar && fvar.length >= 16) {
    const dv = new DataView(fvar.buffer, fvar.byteOffset, fvar.byteLength);
    const axesAt = dv.getUint16(4);
    const count = dv.getUint16(8);
    const size = dv.getUint16(10);
    for (let i = 0; i < count; i++) {
      const a = axesAt + i * size;
      if (a + 16 > fvar.length) break;
      if (tag(fvar, a) !== 'wght') continue;
      const fixed = (at: number) => dv.getInt32(at) / 65536;
      out.weightAxis = [fixed(a + 4), fixed(a + 8), fixed(a + 12)];
    }
  }
  const head = find('head');
  if (head && head.length >= 46)
    out.italic ||= !!(new DataView(head.buffer, head.byteOffset).getUint16(44) & 2);
  return out;
}
