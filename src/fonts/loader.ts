/* Font loading for the canvas, outlining and PDF export.
   Faces come from the Fontsource CDN as single latin TTFs, are cached in IndexedDB for
   offline use, and are registered with document.fonts so the canvas can draw them.
   Failures (offline, unknown family) resolve quietly and are remembered for the session. */
import type { CurvsDocument, FontRef, SceneNode } from '../core/types';
import {
  findFont,
  familyToId,
  fontsourceTtfUrl,
  loadCatalog,
  nearestWeight,
  type CatalogFont,
} from './catalog';

const DB_NAME = 'curvesmith-fonts';
const STORE = 'ttf';

type Face = {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  entry?: CatalogFont;
  key: string;
};

const listeners = new Set<() => void>();
/** Resolved face key → bytes (or null when the face could not be fetched). */
const bytesCache = new Map<string, Promise<Uint8Array | null>>();
/** Resolved face key → registration with document.fonts. */
const registered = new Map<string, Promise<boolean>>();
/** Requested font key → ensureFont in flight or done. */
const ensured = new Map<string, Promise<void>>();
const failed = new Set<string>();

const refKey = (f: FontRef) => `${f.family}|${f.weight}|${f.style}`;

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

/** Snap a FontRef to a face the catalogue has (nearest weight; italic only where it exists). */
async function resolveFace(font: FontRef): Promise<Face> {
  let list: CatalogFont[] = [];
  try {
    list = await loadCatalog();
  } catch {
    /* bundled fallback below */
  }
  const entry = findFont(list, font.family);
  const id = entry?.id ?? familyToId(font.family);
  const weight = entry ? nearestWeight(entry.weights, font.weight) : font.weight;
  const style = font.style === 'italic' && (!entry || entry.italic) ? 'italic' : 'normal';
  return { id, family: entry?.family ?? font.family, weight, style, entry, key: `${id}-${weight}-${style}` };
}

/* ---------- IndexedDB cache (optional: private windows and blocked storage get none) ---------- */

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function readCached(key: string): Promise<Uint8Array | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as ArrayBuffer | Uint8Array | undefined;
        resolve(v ? (v instanceof Uint8Array ? v : new Uint8Array(v)) : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCached(key: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes.slice().buffer, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* ---------- fetching ---------- */

function faceBytes(face: Face): Promise<Uint8Array | null> {
  const hit = bytesCache.get(face.key);
  if (hit) return hit;
  const p = (async () => {
    if (failed.has(face.key)) return null;
    const cached = await readCached(face.key);
    if (cached) return cached;
    try {
      const res = await fetch(fontsourceTtfUrl(face.id, face.weight, face.style));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) throw new Error('empty font');
      await writeCached(face.key, bytes);
      return bytes;
    } catch {
      failed.add(face.key);
      return null;
    }
  })();
  bytesCache.set(face.key, p);
  return p;
}

/** TrueType bytes for a font, for outlining text and embedding in PDF. Null when unavailable offline. */
export async function getFontBytes(font: FontRef): Promise<Uint8Array | null> {
  return faceBytes(await resolveFace(font));
}

const isBundled = (face: Face) => face.style === 'normal' && !!face.entry?.bundled?.includes(face.weight);

function register(face: Face): Promise<boolean> {
  const hit = registered.get(face.key);
  if (hit) return hit;
  const p = (async () => {
    const bytes = await faceBytes(face);
    if (!bytes || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts)
      return false;
    try {
      const ff = new FontFace(face.family, bytes.slice().buffer, {
        weight: String(face.weight),
        style: face.style,
      });
      await ff.load();
      document.fonts.add(ff);
      return true;
    } catch {
      failed.add(face.key);
      return false;
    }
  })();
  registered.set(face.key, p);
  return p;
}

/** Make a font usable by the canvas renderer. Resolves when the face is registered (or failed). */
export function ensureFont(font: FontRef): Promise<void> {
  const k = refKey(font);
  const hit = ensured.get(k);
  if (hit) return hit;
  const p = (async () => {
    try {
      const face = await resolveFace(font);
      if (isBundled(face)) {
        // Already declared by tokens.css; nudge the browser to fetch the woff2 and redraw once it has.
        try {
          const set = typeof document !== 'undefined' ? document.fonts : undefined;
          if (set && !set.check(`${face.weight} 16px "${face.family}"`)) {
            void set.load(`${face.weight} 16px "${face.family}"`).then(notify, () => undefined);
          }
        } catch {
          /* no FontFaceSet */
        }
        return;
      }
      if (await register(face)) notify();
    } catch {
      /* never throws */
    }
  })();
  ensured.set(k, p);
  return p;
}

/** Subscribe to font-loaded events (the canvas re-renders). */
export function onFontLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/* ---------- documents ---------- */

function collect(node: SceneNode, out: Map<string, FontRef>) {
  switch (node.type) {
    case 'text':
      for (const r of node.runs)
        out.set(refKey(r.font), { family: r.font.family, weight: r.font.weight, style: r.font.style });
      break;
    case 'group':
    case 'boolean':
      node.children.forEach((c) => collect(c, out));
      break;
    case 'clipGroup':
      collect(node.clip, out);
      node.children.forEach((c) => collect(c, out));
      break;
    default:
      break;
  }
}

/** Every distinct FontRef used by text in the document (artboards and symbols). */
export function fontsInUse(doc: Pick<CurvsDocument, 'artboards' | 'symbols'>): FontRef[] {
  const out = new Map<string, FontRef>();
  for (const ab of doc.artboards) ab.children.forEach((c) => collect(c, out));
  for (const s of doc.symbols ?? []) collect(s.root, out);
  return [...out.values()];
}

/** Load every face a document uses. Never rejects. */
export async function ensureDocumentFonts(doc: Pick<CurvsDocument, 'artboards' | 'symbols'>): Promise<void> {
  await Promise.all(fontsInUse(doc).map(ensureFont));
}
