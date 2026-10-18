import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurvsDocument, FontRef, SceneNode } from '../../../src/core/types';
import { CATALOG_ROWS, textNode } from './helpers';

type Loader = typeof import('../../../src/fonts/loader');

const TTF = new Uint8Array([0, 1, 0, 0, 9, 9, 9, 9]);
const faces: { family: string; weight?: string; style?: string }[] = [];
const added: unknown[] = [];
let ttfRequests: string[] = [];
let online = true;

class FakeFontFace {
  family: string;
  weight?: string;
  style?: string;
  constructor(family: string, _src: ArrayBuffer, desc: { weight?: string; style?: string } = {}) {
    this.family = family;
    this.weight = desc.weight;
    this.style = desc.style;
    faces.push({ family, weight: desc.weight, style: desc.style });
  }
  load() {
    return Promise.resolve(this);
  }
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('fonts/google-fonts.json')) {
    if (!online) throw new TypeError('offline');
    return new Response(JSON.stringify(CATALOG_ROWS));
  }
  ttfRequests.push(url);
  if (!online) throw new TypeError('Failed to fetch');
  if (url.includes('/nope@')) return new Response('missing', { status: 404 });
  await new Promise((r) => setTimeout(r, 5));
  return new Response(TTF.slice());
});

async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import('../../../src/fonts/loader');
}

function deleteDb() {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('curvesmith-fonts');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  faces.length = 0;
  added.length = 0;
  ttfRequests = [];
  online = true;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (f: unknown) => added.push(f), check: () => true, load: async () => [] },
  });
  await deleteDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const inter: FontRef = { family: 'Inter', weight: 700, style: 'normal' };

describe('ensureFont', () => {
  it('dedupes concurrent loads, registers the face and notifies once', async () => {
    const L = await freshLoader();
    const seen = vi.fn();
    const off = L.onFontLoaded(seen);
    await Promise.all([L.ensureFont(inter), L.ensureFont(inter), L.ensureFont({ ...inter })]);
    expect(ttfRequests).toEqual([
      'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf',
    ]);
    expect(faces).toEqual([{ family: 'Inter', weight: '700', style: 'normal' }]);
    expect(added).toHaveLength(1);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    await L.ensureFont({ ...inter, weight: 650 }); // snaps to 700: same face, no new fetch
    expect(ttfRequests).toHaveLength(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('snaps to the nearest weight and drops italic where the family has none', async () => {
    const L = await freshLoader();
    await L.ensureFont({ family: 'Lobster', weight: 700, style: 'italic' });
    expect(ttfRequests).toEqual([
      'https://cdn.jsdelivr.net/fontsource/fonts/lobster@latest/latin-400-normal.ttf',
    ]);
  });

  it('bundled faces resolve without a download, but bytes still come from fontsource', async () => {
    const L = await freshLoader();
    await L.ensureFont({ family: 'Geist', weight: 500, style: 'normal' });
    expect(ttfRequests).toEqual([]);
    const bytes = await L.getFontBytes({ family: 'Geist', weight: 500, style: 'normal' });
    expect(bytes).toEqual(TTF);
    expect(ttfRequests).toEqual([
      'https://cdn.jsdelivr.net/fontsource/fonts/geist@latest/latin-500-normal.ttf',
    ]);
    // A weight the app does not bundle loads like any other face.
    await L.ensureFont({ family: 'Geist', weight: 800, style: 'normal' });
    expect(faces).toEqual([{ family: 'Geist', weight: '800', style: 'normal' }]);
  });
});

describe('getFontBytes', () => {
  it('caches bytes in IndexedDB across sessions', async () => {
    let L = await freshLoader();
    expect(await L.getFontBytes(inter)).toEqual(TTF);
    expect(ttfRequests).toHaveLength(1);
    // Let the IndexedDB write settle, then start a new "session" while offline.
    await new Promise((r) => setTimeout(r, 20));
    L = await freshLoader();
    online = false;
    expect(await L.getFontBytes(inter)).toEqual(TTF);
    expect(ttfRequests).toHaveLength(1);
  });

  it('offline failures resolve to null, never throw, and are remembered', async () => {
    online = false;
    const L = await freshLoader();
    const seen = vi.fn();
    L.onFontLoaded(seen);
    await expect(L.ensureFont(inter)).resolves.toBeUndefined();
    expect(await L.getFontBytes(inter)).toBeNull();
    online = true;
    expect(await L.getFontBytes(inter)).toBeNull();
    expect(ttfRequests).toHaveLength(1);
    expect(seen).not.toHaveBeenCalled();
    expect(faces).toHaveLength(0);
  });

  it('unknown families fail quietly', async () => {
    const L = await freshLoader();
    expect(await L.getFontBytes({ family: 'Nope', weight: 400, style: 'normal' })).toBeNull();
    expect(ttfRequests[0]).toContain('/nope@latest/latin-400-normal.ttf');
  });

  it('works without IndexedDB', async () => {
    const idb = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    try {
      const L = await freshLoader();
      expect(await L.getFontBytes(inter)).toEqual(TTF);
    } finally {
      vi.stubGlobal('indexedDB', idb);
    }
  });
});

describe('document fonts', () => {
  const base = {
    id: 'g',
    name: 'G',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal' as const,
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    appearance: { items: [] },
  };
  const a = textNode('A', {}, { font: { family: 'Inter', weight: 400, style: 'normal' } });
  const b = textNode('B', { id: 't2' }, { font: { family: 'Lobster', weight: 400, style: 'normal' } });
  const c = textNode('C', { id: 't3' }, { font: { family: 'Inter', weight: 400, style: 'normal' } });
  const d = textNode('D', { id: 't4' }, { font: { family: 'Caveat', weight: 700, style: 'normal' } });
  const group: SceneNode = { ...base, type: 'group', children: [b, c] };
  const doc = {
    artboards: [
      {
        id: 'a',
        name: 'A',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        background: null,
        guides: [],
        children: [a, group],
      },
    ],
    symbols: [{ id: 's', name: 'S', root: d }],
  } as unknown as Pick<CurvsDocument, 'artboards' | 'symbols'>;

  it('fontsInUse collects distinct fonts from artboards, groups and symbols', async () => {
    const L = await freshLoader();
    expect(
      L.fontsInUse(doc)
        .map((f) => f.family)
        .sort(),
    ).toEqual(['Caveat', 'Inter', 'Lobster']);
  });

  it('ensureDocumentFonts loads each face once', async () => {
    const L = await freshLoader();
    await L.ensureDocumentFonts(doc);
    expect(ttfRequests.sort()).toEqual([
      'https://cdn.jsdelivr.net/fontsource/fonts/caveat@latest/latin-700-normal.ttf',
      'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf',
      'https://cdn.jsdelivr.net/fontsource/fonts/lobster@latest/latin-400-normal.ttf',
    ]);
  });
});
