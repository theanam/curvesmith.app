/* User fonts: files people upload (kept in this browser), fonts installed on the device (read through the
   Local Font Access API where the browser offers it), and fonts embedded in open documents. The loader
   consults these before the Google Fonts catalogue, so a family name resolves to the user's own face. */
import type { CurvsDocument, FontRef } from '../core/types';
import { dataUrlToBytes, sha256Hex } from '../formats/shared/bytes';
import { readSfntNames, sniffFont, splitCollection, toSfntFaces } from './sfnt';
import type { CatalogFont } from './catalog';

export type UserFontSource = 'upload' | 'system' | 'document';

export type UserFace = {
  key: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  source: UserFontSource;
  /** Full face name, e.g. "Inter Semi Bold Italic". */
  name: string;
  /** sfnt bytes when held in memory. */
  bytes: Uint8Array | null;
  /** A variable font covers every weight in [min, max]. */
  weights?: [number, number];
  /** Reads the bytes on demand (system fonts). Missing when only the name is known. */
  load?: () => Promise<Uint8Array | null>;
};

const faces = new Map<string, UserFace>();
const listeners = new Set<(families: string[]) => void>();

/** Called with the changed family names whenever user fonts are added or removed. */
export function onUserFontsChanged(fn: (families: string[]) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

let version = 0;
/** Bumps whenever user fonts change (for React hooks). */
export const userFontsVersion = () => version;

function changed(families: Iterable<string>) {
  version++;
  const list = [...new Set(families)];
  for (const fn of [...listeners]) {
    try {
      fn(list);
    } catch (e) {
      console.error(e);
    }
  }
}

/* ---------- describing a face ---------- */

const WEIGHT_WORDS: [RegExp, number][] = [
  [/(hairline|thin)/, 100],
  [/(extra|ultra)light/, 200],
  [/light/, 300],
  [/(semi|demi)bold/, 600],
  [/(extra|ultra)bold/, 800],
  [/(black|heavy)/, 900],
  [/bold/, 700],
  [/medium/, 500],
];

/** Weight from a style name like "Semi Bold Italic" (400 when it names none). */
export function weightFromStyle(style: string): number {
  const s = style.toLowerCase().replace(/[\s_-]+/g, '');
  for (const [re, w] of WEIGHT_WORDS) if (re.test(s)) return w;
  return 400;
}

export const italicFromStyle = (style: string) => /italic|oblique/i.test(style);

const STYLE_WORD =
  /\s+(thin|hairline|extra ?light|ultra ?light|light|regular|book|normal|roman|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique)$/i;

/** A legacy family name without the style words some fonts put in it ("Geist Medium" → "Geist"). */
export function baseFamily(name: string): string {
  let n = name.trim();
  for (let guard = 0; guard < 4 && STYLE_WORD.test(n); guard++) n = n.replace(STYLE_WORD, '').trim();
  return n || name.trim();
}

export type FaceInfo = {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  name: string;
  postscript: string;
  weights?: [number, number];
};

/** Family, weight and style of an sfnt face, read from its name and OS/2 tables. */
export async function describeFace(sfnt: Uint8Array): Promise<FaceInfo> {
  let n;
  try {
    n = readSfntNames(sfnt);
  } catch {
    throw new Error('This font file is damaged.');
  }
  const sub = n.typographicSubfamily ?? n.subfamily ?? '';
  const weight = n.weightClass
    ? Math.max(100, Math.min(900, Math.round(n.weightClass / 100) * 100))
    : weightFromStyle(sub);
  const axis = n.weightAxis;
  // A variable font's legacy names describe one instance ("Bricolage Grotesque 96pt ExtraBold"); its family
  // is the typographic one, or the legacy name with style words removed.
  const legacy = baseFamily(n.family ?? 'Untitled font');
  const family = n.typographicFamily ?? (axis ? legacy.replace(/\s+\d+(\.\d+)?pt$/i, '') : legacy);
  return {
    family,
    ...(axis ? { weights: [Math.max(1, axis[0]), Math.min(1000, axis[2])] as [number, number] } : {}),
    weight: axis ? Math.round(axis[1]) : weight,
    style: n.italic || italicFromStyle(sub) ? 'italic' : 'normal',
    name: n.fullName ?? `${family} ${sub}`.trim(),
    postscript: n.postscript ?? '',
  };
}

/* ---------- lookups ---------- */

const sameFamily = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The user's face for a font: matching style first, then the nearest weight. */
export function pickUserFace(font: FontRef): UserFace | null {
  const all = [...faces.values()].filter((f) => sameFamily(f.family, font.family));
  if (!all.length) return null;
  const styled = all.filter((f) => f.style === font.style);
  const pool = styled.length ? styled : all;
  const gap = (f: UserFace) =>
    f.weights
      ? Math.max(0, f.weights[0] - font.weight, font.weight - f.weights[1])
      : Math.abs(f.weight - font.weight);
  return pool.reduce((best, f) => {
    const d = gap(f);
    const bd = gap(best);
    return d < bd || (d === bd && f.weight > best.weight) ? f : best;
  });
}

export const userFaces = (): UserFace[] => [...faces.values()];

/** One picker entry per user family. Uploads win over the same family installed on the device. */
export function userFamilies(): (CatalogFont & { source: UserFontSource })[] {
  const byFamily = new Map<string, UserFace[]>();
  for (const f of faces.values()) {
    const k = f.family.toLowerCase();
    byFamily.set(k, [...(byFamily.get(k) ?? []), f]);
  }
  const rank: Record<UserFontSource, number> = { upload: 0, document: 1, system: 2 };
  return [...byFamily.values()]
    .map((list) => {
      const source = list.reduce((s, f) => (rank[f.source] < rank[s] ? f.source : s), list[0].source);
      return {
        id: `user-${list[0].family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        family: list[0].family,
        category: 'sans' as const,
        weights: [
          ...new Set(
            list.flatMap((f) =>
              f.weights
                ? [100, 200, 300, 400, 500, 600, 700, 800, 900].filter(
                    (w) => w >= f.weights![0] && w <= f.weights![1],
                  )
                : [f.weight],
            ),
          ),
        ].sort((a, b) => a - b),
        italic: list.some((f) => f.style === 'italic'),
        local: true,
        source,
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** Bytes to embed in a document for a face the user uploaded (or one already embedded). Null otherwise. */
export function embeddableFace(font: FontRef): { face: UserFace; bytes: Uint8Array } | null {
  const f = pickUserFace(font);
  if (!f || f.source === 'system' || !f.bytes) return null;
  return { face: f, bytes: f.bytes };
}

/** sfnt bytes of a user face (reading a system font's file on first use). */
export async function userFaceBytes(face: UserFace): Promise<Uint8Array | null> {
  if (face.bytes) return face.bytes;
  if (!face.load) return null;
  try {
    face.bytes = await face.load();
  } catch {
    face.bytes = null;
  }
  return face.bytes;
}

/* ---------- uploads (kept in IndexedDB) ---------- */

const DB = 'curvesmith-user-fonts';
const STORE = 'faces';
type Stored = {
  family: string;
  weight: number;
  weights?: [number, number];
  style: 'normal' | 'italic';
  name: string;
  bytes: ArrayBuffer;
};

let db: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  return (db ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await openDb();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Add font files to this browser's font library. Returns the families added and any per-file errors. */
export async function addFontFiles(files: File[]): Promise<{ families: string[]; errors: string[] }> {
  const families: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const sfnts = await toSfntFaces(new Uint8Array(await file.arrayBuffer()));
      for (const sfnt of sfnts) {
        const info = await describeFace(sfnt);
        const key = `user:${await sha256Hex(sfnt)}`;
        const face: UserFace = { key, ...info, source: 'upload', bytes: sfnt };
        faces.set(key, face);
        const rec: Stored = {
          weights: info.weights,
          family: info.family,
          weight: info.weight,
          style: info.style,
          name: info.name,
          bytes: sfnt.slice().buffer,
        };
        await idb('readwrite', (s) => s.put(rec, key));
        families.push(info.family);
      }
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : 'could not be read.'}`);
    }
  }
  if (families.length) changed(families);
  return { families: [...new Set(families)], errors };
}

/** Remove an uploaded family from this browser (documents that embed it keep their copy). */
export async function removeUserFamily(family: string) {
  const gone = [...faces.values()].filter((f) => f.source === 'upload' && sameFamily(f.family, family));
  for (const f of gone) {
    faces.delete(f.key);
    await idb('readwrite', (s) => s.delete(f.key));
  }
  if (gone.length) changed([family]);
}

/* ---------- fonts on this device ---------- */

type LocalFontData = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
};
type WithLocalFonts = { queryLocalFonts?: () => Promise<LocalFontData[]> };

/** The browser can list installed fonts and read their files (Chrome and Edge). */
export const systemFontsSupported = () =>
  typeof window !== 'undefined' &&
  typeof (window as unknown as WithLocalFonts).queryLocalFonts === 'function';

let systemLoaded = false;
export const systemFontsLoaded = () => systemLoaded;

/** The face inside a collection file whose PostScript name matches. */
async function faceIn(bytes: Uint8Array, postscript: string): Promise<Uint8Array | null> {
  if (sniffFont(bytes) !== 'ttc') return bytes;
  for (const sfnt of splitCollection(bytes))
    if ((await describeFace(sfnt)).postscript === postscript) return sfnt;
  return null;
}

/**
 * Read the fonts installed on this device. Asks for permission the first time (call it from a click);
 * later visits read them quietly. Resolves to how many faces are available.
 */
export async function loadSystemFonts(): Promise<number> {
  const q = (window as unknown as WithLocalFonts).queryLocalFonts;
  if (!q) return 0;
  const list = await q.call(window);
  const families: string[] = [];
  for (const fd of list) {
    const key = `system:${fd.postscriptName}`;
    if (faces.has(key)) continue;
    faces.set(key, {
      key,
      family: fd.family,
      weight: weightFromStyle(fd.style),
      style: italicFromStyle(fd.style) ? 'italic' : 'normal',
      source: 'system',
      name: fd.fullName,
      bytes: null,
      load: async () => faceIn(new Uint8Array(await (await fd.blob()).arrayBuffer()), fd.postscriptName),
    });
    families.push(fd.family);
  }
  systemLoaded = true;
  if (families.length) changed(families);
  return list.length;
}

/**
 * Use an installed font by name where the browser can't list fonts (Safari, Firefox). The canvas and SVG
 * use it by name; outlines and PDF need the file, so those fall back to another face.
 */
export async function addSystemFontByName(name: string): Promise<boolean> {
  const family = name.trim();
  if (!family || !isInstalled(family)) return false;
  const key = `system-name:${family.toLowerCase()}`;
  if (!faces.has(key)) {
    faces.set(key, {
      key,
      family,
      weight: 400,
      style: 'normal',
      source: 'system',
      name: family,
      bytes: null,
    });
    changed([family]);
  }
  return true;
}

/**
 * Whether a family is installed, by family name (the way the canvas and SVG look fonts up): text set in it
 * measures differently from both generic fallbacks.
 */
export function isInstalled(family: string): boolean {
  if (typeof document === 'undefined') return false;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const sample = 'mmmmmmmmmmlli WQ@#0123';
  const width = (font: string) => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(sample).width;
  };
  const quoted = `"${family.replace(/"/g, '')}"`;
  return ['monospace', 'serif'].every((generic) => width(`${quoted}, ${generic}`) !== width(generic));
}

/* ---------- fonts embedded in documents ---------- */

const embedded = new Set<string>();

/** Make the fonts a document carries available (once per file). */
export async function registerDocumentFonts(doc: Pick<CurvsDocument, 'fonts' | 'assets'>) {
  const families: string[] = [];
  for (const entry of doc.fonts) {
    if (!entry.file || embedded.has(entry.file)) continue;
    const url = doc.assets[entry.file];
    const decoded = url ? dataUrlToBytes(url) : null;
    if (!decoded) continue;
    embedded.add(entry.file);
    try {
      for (const sfnt of await toSfntFaces(decoded.bytes)) {
        const sha = await sha256Hex(sfnt);
        if (faces.has(`user:${sha}`)) continue;
        const info = await describeFace(sfnt);
        faces.set(`doc:${sha}`, {
          key: `doc:${sha}`,
          ...info,
          family: entry.family || info.family,
          source: 'document',
          bytes: sfnt,
        });
        families.push(entry.family || info.family);
      }
    } catch {
      /* a damaged embedded font: the text falls back like any missing font */
    }
  }
  if (families.length) changed(families);
}

/* ---------- start-up ---------- */

let started: Promise<void> | null = null;

/** Load uploaded fonts, and installed fonts when permission was granted before. Never rejects. */
export function initUserFonts(): Promise<void> {
  return (started ??= (async () => {
    const d = await openDb();
    if (d) {
      const keys = ((await idb('readonly', (s) => s.getAllKeys())) ?? []) as string[];
      const recs = ((await idb('readonly', (s) => s.getAll())) ?? []) as Stored[];
      const families: string[] = [];
      recs.forEach((r, i) => {
        if (!r?.bytes) return;
        faces.set(keys[i], {
          key: keys[i],
          weights: r.weights,
          family: r.family,
          weight: r.weight,
          style: r.style,
          name: r.name,
          source: 'upload',
          bytes: new Uint8Array(r.bytes),
        });
        families.push(r.family);
      });
      if (families.length) changed(families);
    }
    try {
      const perm = await navigator.permissions?.query({ name: 'local-fonts' as PermissionName });
      if (perm?.state === 'granted' && systemFontsSupported()) await loadSystemFonts();
    } catch {
      /* no permission API or no local-fonts permission */
    }
  })());
}

/** Tests only. */
export function resetUserFontsForTests() {
  faces.clear();
  embedded.clear();
  systemLoaded = false;
  started = null;
  version++;
}

/** Tests only: add a face directly. */
export function addFaceForTests(face: UserFace) {
  faces.set(face.key, face);
  changed([face.family]);
}
