/* Local persistence: IndexedDB for recent files (with File System Access handles) and autosave metadata,
   OPFS for autosaved document payloads when available. Everything degrades to no-ops when storage is blocked. */

const DB = 'curvesmith';
const VERSION = 1;
export const STORES = ['recent', 'autosave', 'kv'] as const;
type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetDb() {
  dbPromise = null;
}

function tx<T>(
  store: Store,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const idbGet = <T>(store: Store, key: string) =>
  tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const idbSet = (store: Store, key: string, value: unknown) =>
  tx(store, 'readwrite', (s) => s.put(value, key));
export const idbDelete = (store: Store, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
export const idbAll = <T>(store: Store) =>
  tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>).then((v) => v ?? []);

// ---- OPFS ------------------------------------------------------------------------------------

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('autosave', { create: true });
  } catch {
    return null;
  }
}

/** Write text to OPFS (temp file then replace, so a closed tab never leaves half a file). Falls back to IndexedDB. */
export async function writeBlob(name: string, text: string): Promise<'opfs' | 'idb' | null> {
  const dir = await opfsDir();
  if (dir) {
    try {
      const tmp = await dir.getFileHandle(`${name}.tmp`, { create: true });
      const w = await tmp.createWritable();
      await w.write(text);
      await w.close();
      const final = await dir.getFileHandle(name, { create: true });
      const w2 = await final.createWritable();
      await w2.write(await (await tmp.getFile()).text());
      await w2.close();
      await dir.removeEntry(`${name}.tmp`).catch(() => undefined);
      return 'opfs';
    } catch {
      /* fall through */
    }
  }
  const ok = await idbSet('kv', `blob:${name}`, text);
  return ok === undefined ? null : 'idb';
}

export async function readBlob(name: string): Promise<string | null> {
  const dir = await opfsDir();
  if (dir) {
    try {
      const h = await dir.getFileHandle(name);
      return await (await h.getFile()).text();
    } catch {
      /* fall through */
    }
  }
  return (await idbGet<string>('kv', `blob:${name}`)) ?? null;
}

export async function deleteBlob(name: string) {
  const dir = await opfsDir();
  if (dir) await dir.removeEntry(name).catch(() => undefined);
  await idbDelete('kv', `blob:${name}`);
}

// ---- localStorage (per-user UI conveniences) ---------------------------------------------------

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}
