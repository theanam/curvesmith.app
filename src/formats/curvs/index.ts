/* .curvs native format (docs/CURVS_FORMAT.md): a ZIP with mimetype (stored, first), manifest.json,
   document.json, thumbnail.png and assets/<sha256>.<ext>. */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { CurvsDocument, ExportScope, SceneNode } from '../../core/types';
import type { ExportContext, FormatAdapter, ImportOptions } from '../types';
import { emptyReport } from '../types';
import {
  blobToBytes,
  bytesToDataUrl,
  dataUrlToBytes,
  extForMime,
  mimeForExt,
  sha256Hex,
} from '../shared/bytes';
import { baseAdapter, type CurvsExportOptions } from '../registry';

export const CURVS_MIME = 'application/x-curvesmith';
export const READER_VERSION = 1;
export const FORMAT_VERSION = 1;

declare const __APP_VERSION__: string | undefined;
const appVersion = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0');

const DOC_KEYS = [
  'id',
  'units',
  'colorProfile',
  'swatches',
  'styles',
  'symbols',
  'fonts',
  'artboards',
  'view',
  'extra',
];
const MANIFEST_KEYS = [
  'format',
  'formatVersion',
  'minReaderVersion',
  'generator',
  'created',
  'modified',
  'document',
  'thumbnail',
  'entries',
];
/** Reserved keys in `doc.extra` that hold unknown keys so they can be written back where they came from. */
const UNKNOWN_DOC = '$unknown';
const UNKNOWN_MANIFEST = '$manifest';
const CREATED = '$created';

const BASE_KEYS = [
  'id',
  'name',
  'visible',
  'locked',
  'opacity',
  'blend',
  'transform',
  'appearance',
  'type',
  'extra',
];
const NODE_KEYS: Record<SceneNode['type'], string[]> = {
  group: ['children', 'isolated'],
  path: ['subpaths', 'fillRule'],
  rect: ['width', 'height', 'corners'],
  ellipse: ['rx', 'ry', 'arcStart', 'arcEnd', 'pie'],
  star: ['points', 'outerRadius', 'innerRatio', 'rounding', 'polygon'],
  shape: ['kind', 'width', 'height', 'params'],
  text: ['mode', 'pathRef', 'box', 'runs', 'paragraph'],
  image: ['asset', 'width', 'height', 'crop'],
  boolean: ['op', 'children'],
  instance: ['symbol', 'overrides'],
  clipGroup: ['clip', 'children'],
};

export class CurvsError extends Error {}

const round4 = (_k: string, v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v;

function forEachNode(doc: CurvsDocument, fn: (n: SceneNode) => void) {
  const visit = (n: SceneNode) => {
    fn(n);
    if (n.type === 'clipGroup') visit(n.clip);
    if (n.type === 'group' || n.type === 'boolean' || n.type === 'clipGroup') n.children.forEach(visit);
  };
  for (const ab of doc.artboards) ab.children.forEach(visit);
  for (const s of doc.symbols) visit(s.root);
}

/** Node → plain JSON: hoists `extra` (unknown keys from newer writers) back to the node's top level. */
function nodeToJson(n: SceneNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === 'extra' || v === undefined) continue;
    if (k === 'children') out.children = (v as SceneNode[]).map(nodeToJson);
    else if (k === 'clip') out.clip = nodeToJson(v as SceneNode);
    else out[k] = v;
  }
  if (n.extra) for (const [k, v] of Object.entries(n.extra)) if (!(k in out)) out[k] = v;
  return out;
}

function nodeFromJson(raw: Record<string, unknown>, path: string): SceneNode {
  const type = raw.type as SceneNode['type'];
  if (!type || !(type in NODE_KEYS))
    throw new CurvsError(`Unknown object type "${String(raw.type)}" at ${path}.`);
  const known = new Set([...BASE_KEYS, ...NODE_KEYS[type]]);
  const node: Record<string, unknown> = {
    name: '',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: [1, 0, 0, 1, 0, 0],
    appearance: { items: [] },
  };
  const extra: Record<string, unknown> = { ...((raw.extra as Record<string, unknown>) ?? {}) };
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'extra') continue;
    if (known.has(k)) node[k] = v;
    else extra[k] = v;
  }
  if (typeof node.id !== 'string') throw new CurvsError(`An object at ${path} has no id.`);
  if (Array.isArray(raw.children))
    node.children = (raw.children as Record<string, unknown>[]).map((c, i) =>
      nodeFromJson(c, `${path}.children[${i}]`),
    );
  else if (type === 'group' || type === 'boolean' || type === 'clipGroup') node.children = [];
  if (type === 'clipGroup') {
    if (!raw.clip || typeof raw.clip !== 'object')
      throw new CurvsError(`Clip group ${String(raw.id)} has no clip shape.`);
    node.clip = nodeFromJson(raw.clip as Record<string, unknown>, `${path}.clip`);
  }
  if (Object.keys(extra).length) node.extra = extra;
  return node as unknown as SceneNode;
}

export type WriteCurvsOptions = { thumbnail?: Blob | Uint8Array | null; now?: Date };

/** Serialize a document into .curvs bytes. */
export async function writeCurvs(doc: CurvsDocument, opts: WriteCurvsOptions = {}): Promise<Uint8Array> {
  // Re-key referenced assets by content hash; drop unreferenced ones.
  const remap = new Map<string, string>();
  const files: Zippable = {};
  const referenced = new Set<string>();
  forEachNode(doc, (n) => {
    if (n.type === 'image') referenced.add(n.asset);
  });
  for (const key of referenced) {
    const url = doc.assets[key];
    const decoded = url ? dataUrlToBytes(url) : null;
    if (!decoded) continue;
    const hash = await sha256Hex(decoded.bytes);
    const extMatch = /\.([a-z0-9]+)$/i.exec(key);
    const ext =
      decoded.mime !== 'application/octet-stream' ? extForMime(decoded.mime) : (extMatch?.[1] ?? 'bin');
    const path = `assets/${hash}.${ext}`;
    remap.set(key, path);
    files[path] = [decoded.bytes, { level: 0 }];
  }

  const now = (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const extra = { ...doc.extra };
  const unknownDoc = (extra[UNKNOWN_DOC] as Record<string, unknown>) ?? {};
  const unknownManifest = (extra[UNKNOWN_MANIFEST] as Record<string, unknown>) ?? {};
  const created = typeof extra[CREATED] === 'string' ? (extra[CREATED] as string) : now;
  delete extra[UNKNOWN_DOC];
  delete extra[UNKNOWN_MANIFEST];
  delete extra[CREATED];

  const json: Record<string, unknown> = {
    id: doc.id,
    units: doc.units,
    colorProfile: doc.colorProfile,
    swatches: doc.swatches,
    styles: doc.styles,
    symbols: doc.symbols.map((s) => ({ ...s, root: nodeToJson(s.root) })),
    fonts: doc.fonts,
    artboards: doc.artboards.map((ab) => ({ ...ab, children: ab.children.map(nodeToJson) })),
    ...(doc.view ? { view: doc.view } : {}),
    extra,
  };
  for (const [k, v] of Object.entries(unknownDoc)) if (!(k in json)) json[k] = v;
  const rekey = (n: Record<string, unknown>) => {
    if (n.type === 'image' && typeof n.asset === 'string' && remap.has(n.asset)) n.asset = remap.get(n.asset);
    if (Array.isArray(n.children)) (n.children as Record<string, unknown>[]).forEach(rekey);
    if (n.clip) rekey(n.clip as Record<string, unknown>);
  };
  (json.artboards as { children: Record<string, unknown>[] }[]).forEach((ab) => ab.children.forEach(rekey));
  (json.symbols as { root: Record<string, unknown> }[]).forEach((s) => rekey(s.root));

  let thumb: Uint8Array | null = null;
  if (opts.thumbnail)
    thumb = opts.thumbnail instanceof Uint8Array ? opts.thumbnail : await blobToBytes(opts.thumbnail);

  const entries = [
    'mimetype',
    'manifest.json',
    'document.json',
    ...(thumb ? ['thumbnail.png'] : []),
    ...Object.keys(files),
  ];
  const manifest: Record<string, unknown> = {
    format: 'curvs',
    formatVersion: FORMAT_VERSION,
    minReaderVersion: 1,
    generator: `Curvesmith ${appVersion()}`,
    created,
    modified: now,
    document: 'document.json',
    ...(thumb ? { thumbnail: 'thumbnail.png' } : {}),
    entries,
  };
  for (const [k, v] of Object.entries(unknownManifest)) if (!(k in manifest)) manifest[k] = v;

  // Object key order is the archive order: mimetype must be first and stored.
  const zip: Zippable = {
    mimetype: [strToU8(CURVS_MIME), { level: 0 }],
    'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
    'document.json': [strToU8(JSON.stringify(json, round4)), { level: 6 }],
  };
  if (thumb) zip['thumbnail.png'] = [thumb, { level: 0 }];
  Object.assign(zip, files);
  return zipSync(zip);
}

/** Parse .curvs bytes. Throws CurvsError with a short, user-facing message. */
export async function readCurvs(bytes: Uint8Array): Promise<CurvsDocument> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new CurvsError('This file is damaged or is not a .curvs file.');
  }
  const mt = files.mimetype ? strFromU8(files.mimetype).trim() : null;
  if (mt !== null && mt !== CURVS_MIME) throw new CurvsError('This ZIP file is not a .curvs file.');
  if (!files['manifest.json']) throw new CurvsError('This .curvs file has no manifest.');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new CurvsError('The manifest of this .curvs file is damaged.');
  }
  if (manifest.format !== 'curvs') throw new CurvsError('This file is not a .curvs file.');
  const minReader = Number(manifest.minReaderVersion ?? 1);
  if (!Number.isFinite(minReader) || minReader > READER_VERSION)
    throw new CurvsError(
      `This file needs a newer Curvesmith (file format reader ${minReader}). Update the app to open it.`,
    );
  const docPath = typeof manifest.document === 'string' ? manifest.document : 'document.json';
  const docBytes = files[docPath];
  if (!docBytes) throw new CurvsError('This .curvs file has no document.');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(strFromU8(docBytes));
  } catch {
    throw new CurvsError('The document inside this .curvs file is damaged.');
  }
  if (!Array.isArray(raw.artboards))
    throw new CurvsError('The document inside this .curvs file has no artboards.');

  const extra: Record<string, unknown> = { ...((raw.extra as Record<string, unknown>) ?? {}) };
  const unknownDoc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!DOC_KEYS.includes(k)) unknownDoc[k] = v;
  if (Object.keys(unknownDoc).length) extra[UNKNOWN_DOC] = unknownDoc;
  const unknownManifest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(manifest)) if (!MANIFEST_KEYS.includes(k)) unknownManifest[k] = v;
  if (Object.keys(unknownManifest).length) extra[UNKNOWN_MANIFEST] = unknownManifest;
  if (typeof manifest.created === 'string') extra[CREATED] = manifest.created;

  const artboards = (raw.artboards as Record<string, unknown>[]).map((ab, i) => ({
    id: String(ab.id ?? `ab_${i + 1}`),
    name: String(ab.name ?? `Artboard ${i + 1}`),
    x: Number(ab.x ?? 0),
    y: Number(ab.y ?? 0),
    width: Number(ab.width ?? 595),
    height: Number(ab.height ?? 842),
    background: (ab.background ?? null) as CurvsDocument['artboards'][number]['background'],
    guides: (Array.isArray(ab.guides) ? ab.guides : []) as CurvsDocument['artboards'][number]['guides'],
    children: (Array.isArray(ab.children) ? ab.children : []).map((c: Record<string, unknown>, j: number) =>
      nodeFromJson(c, `artboards[${i}].children[${j}]`),
    ),
  }));
  const symbols = (Array.isArray(raw.symbols) ? raw.symbols : []).map(
    (s: Record<string, unknown>, i: number) => ({
      id: String(s.id),
      name: String(s.name ?? 'Symbol'),
      root: nodeFromJson(s.root as Record<string, unknown>, `symbols[${i}].root`),
    }),
  );

  const doc: CurvsDocument = {
    id: typeof raw.id === 'string' ? raw.id : `doc_${Date.now()}`,
    units: (raw.units as CurvsDocument['units']) ?? 'px',
    colorProfile: 'srgb',
    swatches: (raw.swatches as CurvsDocument['swatches']) ?? [],
    styles: (raw.styles as CurvsDocument['styles']) ?? [],
    symbols,
    fonts: (raw.fonts as CurvsDocument['fonts']) ?? [],
    artboards,
    ...(raw.view ? { view: raw.view as CurvsDocument['view'] } : {}),
    assets: {},
    extra,
  };
  const ids = new Set<string>();
  forEachNode(doc, (n) => {
    if (ids.has(n.id)) throw new CurvsError(`Two objects share the id ${n.id}.`);
    ids.add(n.id);
    if (n.type === 'image' && files[n.asset] && !doc.assets[n.asset]) {
      const ext = /\.([a-z0-9]+)$/i.exec(n.asset)?.[1] ?? 'png';
      doc.assets[n.asset] = bytesToDataUrl(files[n.asset], mimeForExt(ext));
    }
  });
  return doc;
}

export const curvsAdapter: FormatAdapter<CurvsExportOptions> = {
  ...baseAdapter<CurvsExportOptions>('curvs'),
  async import(bytes: Uint8Array, opts: ImportOptions) {
    const doc = await readCurvs(bytes);
    const report = emptyReport('curvs');
    let missing = 0;
    forEachNode(doc, (n) => {
      if (n.type === 'image' && !doc.assets[n.asset]) missing++;
    });
    if (missing)
      report.warnings.push(
        missing === 1 ? '1 image is missing from the file.' : `${missing} images are missing from the file.`,
      );
    void opts;
    return { doc, report };
  },
  async export(doc: CurvsDocument, _scope: ExportScope, opts: CurvsExportOptions, _ctx: ExportContext) {
    const bytes = await writeCurvs(doc, { thumbnail: opts.thumbnail });
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Blob([copy.buffer], { type: CURVS_MIME });
  },
};
