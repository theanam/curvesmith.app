/* Format registry: cheap descriptors for menus and the export dialog, with lazily loaded implementations. */
import type { CurvsDocument, ExportScope, ImportReport } from '../core/types';
import type { ExportContext, FormatAdapter, FormatGroup } from './types';
import { allNodes } from '../core/document';
import { pagesForScope } from './shared/pages';

export type FormatId =
  'curvs' | 'svg' | 'pdf' | 'ai' | 'eps' | 'dxf' | 'emf' | 'png' | 'jpg' | 'webp' | 'gif';

export type FormatDescriptor = Omit<FormatAdapter, 'import' | 'export' | 'id'> & { id: FormatId };

export type SvgExportOptions = {
  text: 'keep' | 'outlines';
  styling: 'attributes' | 'inline' | 'classes';
  decimals: number;
  minify: boolean;
  responsive: boolean;
  background: boolean;
  layerIds: boolean;
};

export type PdfExportOptions = {
  compatibility: 'PDF 1.7' | 'PDF/X-4';
  embedFonts: boolean;
  keepLayers: boolean;
  bleed: boolean;
  cropMarks: boolean;
};

export type EpsExportOptions = { bleed: boolean; cropMarks: boolean };
export type DxfExportOptions = { units: 'mm' | 'in' | 'px'; tolerance: number };
export type EmfExportOptions = Record<string, never>;
export type RasterExportOptions = {
  /** Output pixels per point (1, 2, 3 or custom). */
  scale: number;
  /** Optional target size in pixels; overrides scale (the other side follows the aspect ratio). */
  width?: number;
  height?: number;
  /** 0–100, JPG and WebP. */
  quality: number;
  transparent: boolean;
  antialias: boolean;
};
export type CurvsExportOptions = { thumbnail?: Blob };

export const PDF_COMPATIBILITY: PdfExportOptions['compatibility'][] = ['PDF 1.7', 'PDF/X-4'];

const pdfDefaults: PdfExportOptions = {
  compatibility: 'PDF 1.7',
  embedFonts: true,
  keepLayers: false,
  bleed: false,
  cropMarks: false,
};

export const FORMATS: FormatDescriptor[] = [
  {
    id: 'curvs',
    label: '.curvs',
    descriptor: 'Lossless, fully editable',
    group: 'native',
    extensions: ['curvs'],
    mime: ['application/x-curvesmith'],
    canImport: true,
    canExport: true,
    defaults: {},
  },
  {
    id: 'svg',
    label: 'SVG',
    descriptor: 'Web, code, icons',
    group: 'vector',
    extensions: ['svg', 'svgz'],
    mime: ['image/svg+xml'],
    canImport: true,
    canExport: true,
    defaults: {
      text: 'keep',
      styling: 'attributes',
      decimals: 2,
      minify: false,
      responsive: false,
      background: false,
      layerIds: true,
    } satisfies SvgExportOptions,
  },
  {
    id: 'pdf',
    label: 'PDF',
    descriptor: 'Print and sharing',
    group: 'vector',
    extensions: ['pdf'],
    mime: ['application/pdf'],
    canImport: true,
    canExport: true,
    defaults: pdfDefaults,
    note: 'PDF/X-4 is a label for now. Full X-4 checks arrive in a later version.',
  },
  {
    id: 'ai',
    label: 'AI',
    descriptor: 'Opens in Illustrator',
    group: 'vector',
    extensions: ['ai'],
    mime: ['application/illustrator', 'application/postscript'],
    canImport: true,
    canExport: true,
    defaults: pdfDefaults,
    note: 'Saved as a PDF-based .ai file. Illustrator opens it; Illustrator-only editing data is not included.',
  },
  {
    id: 'eps',
    label: 'EPS',
    descriptor: 'Legacy print workflows',
    group: 'vector',
    extensions: ['eps'],
    mime: ['application/postscript'],
    canImport: false,
    canExport: true,
    defaults: { bleed: false, cropMarks: false } satisfies EpsExportOptions,
    note: 'Transparency and effects are flattened. Opening EPS files arrives in a later version.',
  },
  {
    id: 'dxf',
    label: 'DXF',
    descriptor: 'CAD, laser and vinyl cutters',
    group: 'vector',
    extensions: ['dxf'],
    mime: ['image/vnd.dxf', 'application/dxf'],
    canImport: true,
    canExport: true,
    defaults: { units: 'mm', tolerance: 0.1 } satisfies DxfExportOptions,
    note: 'Outlines only. Curves become polylines; fills and effects are left out.',
  },
  {
    id: 'emf',
    label: 'EMF',
    descriptor: 'Microsoft Office',
    group: 'vector',
    extensions: ['emf'],
    mime: ['image/emf', 'image/x-emf'],
    canImport: false,
    canExport: true,
    defaults: {},
    note: 'Gradients become flat colors and transparency is flattened.',
  },
  {
    id: 'png',
    label: 'PNG',
    descriptor: 'Transparent bitmap',
    group: 'raster',
    extensions: ['png'],
    mime: ['image/png'],
    canImport: true,
    canExport: true,
    defaults: { scale: 1, quality: 90, transparent: true, antialias: true } satisfies RasterExportOptions,
  },
  {
    id: 'jpg',
    label: 'JPG',
    descriptor: 'Photos, no transparency',
    group: 'raster',
    extensions: ['jpg', 'jpeg'],
    mime: ['image/jpeg'],
    canImport: true,
    canExport: true,
    defaults: { scale: 1, quality: 90, transparent: false, antialias: true } satisfies RasterExportOptions,
  },
  {
    id: 'webp',
    label: 'WebP',
    descriptor: 'Small images for the web',
    group: 'raster',
    extensions: ['webp'],
    mime: ['image/webp'],
    canImport: true,
    canExport: true,
    defaults: { scale: 1, quality: 90, transparent: true, antialias: true } satisfies RasterExportOptions,
  },
  {
    id: 'gif',
    label: 'GIF',
    descriptor: 'Animated and legacy images',
    group: 'raster',
    extensions: ['gif'],
    mime: ['image/gif'],
    canImport: true,
    canExport: false,
  },
];

export const GROUP_LABELS: Record<FormatGroup, string> = {
  native: 'NATIVE',
  vector: 'VECTOR',
  raster: 'RASTER',
};

/** Formats shown in the export dialog, in mockup order. */
export const exportFormats = () => FORMATS.filter((f) => f.canExport);
export const importFormats = () => FORMATS.filter((f) => f.canImport);
export const descriptorFor = (id: string) => FORMATS.find((f) => f.id === id) ?? null;

/** Descriptor fields typed for an adapter implementation with its own options type. */
export function baseAdapter<O>(id: FormatId): FormatAdapter<O> {
  const d = descriptorFor(id);
  if (!d) throw new Error(`Unknown format "${id}".`);
  return { ...d } as unknown as FormatAdapter<O>;
}

/** `accept` attribute value for file inputs. */
export const importAccept = () =>
  importFormats()
    .flatMap((f) => [...f.extensions.map((e) => '.' + e), ...f.mime])
    .join(',');

const loaders: Record<FormatId, () => Promise<FormatAdapter>> = {
  curvs: () => import('./curvs').then((m) => m.curvsAdapter),
  svg: () => import('./svg').then((m) => m.svgAdapter),
  pdf: () => import('./pdf').then((m) => m.pdfAdapter),
  ai: () => import('./pdf').then((m) => m.aiAdapter),
  eps: () => import('./eps').then((m) => m.epsAdapter),
  dxf: () => import('./dxf').then((m) => m.dxfAdapter),
  emf: () => import('./emf').then((m) => m.emfAdapter),
  png: () => import('./raster').then((m) => m.rasterAdapter('png')),
  jpg: () => import('./raster').then((m) => m.rasterAdapter('jpg')),
  webp: () => import('./raster').then((m) => m.rasterAdapter('webp')),
  gif: () => import('./raster').then((m) => m.rasterAdapter('gif')),
};

const cache = new Map<string, Promise<FormatAdapter>>();

/** Load the implementation of a format (a separate chunk per format family). */
export function loadAdapter(id: string): Promise<FormatAdapter> {
  const load = loaders[id as FormatId];
  if (!load) return Promise.reject(new Error(`Unknown format "${id}".`));
  let p = cache.get(id);
  if (!p) {
    p = load();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

const extOf = (name: string) => {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
};

/** Pick a format for a file by sniffing its bytes first, then by extension. */
export function adapterForFile(name: string, bytes?: Uint8Array): FormatDescriptor | null {
  const ext = extOf(name);
  if (bytes && bytes.length >= 4) {
    const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 1024)));
    if (head.startsWith('%PDF')) return descriptorFor(ext === 'ai' ? 'ai' : 'pdf');
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
      return descriptorFor('curvs');
    if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') return descriptorFor('png');
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return descriptorFor('jpg');
    if (head.startsWith('GIF8')) return descriptorFor('gif');
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return descriptorFor('webp');
    if (bytes[0] === 0x1f && bytes[1] === 0x8b && (ext === 'svgz' || ext === 'svg'))
      return descriptorFor('svg');
    if (/<svg[\s>]/i.test(head)) return descriptorFor('svg');
    if (/^\s*0\s*\r?\n\s*SECTION/.test(head)) return descriptorFor('dxf');
    if (head.startsWith('%!PS')) return descriptorFor(ext === 'ai' ? 'ai' : 'eps');
  }
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}

export type ImportResult = { doc: CurvsDocument; report: ImportReport; format: FormatId };

/** Open a file with the matching importer. Throws a short, user-facing error when it can't. */
export async function importFile(file: File | { name: string; bytes: Uint8Array }): Promise<ImportResult> {
  const given = (file as { bytes?: unknown }).bytes;
  const bytes = ArrayBuffer.isView(given)
    ? new Uint8Array(given.buffer, given.byteOffset, given.byteLength)
    : new Uint8Array(await (file as File).arrayBuffer());
  const desc = adapterForFile(file.name, bytes);
  if (!desc) throw new Error(`Curvesmith can't open "${file.name}". Try SVG, PDF or .curvs.`);
  if (desc.id === 'ai' && String.fromCharCode(...bytes.subarray(0, 4)) === '%!PS')
    throw new Error(
      'This .ai file has no PDF data. Re-save it from Illustrator with "Create PDF Compatible File" on.',
    );
  if (!desc.canImport) throw new Error(`Opening ${desc.label} files arrives in a later version.`);
  const adapter = await loadAdapter(desc.id);
  if (!adapter.import) throw new Error(`Opening ${desc.label} files arrives in a later version.`);
  const fileName = file.name.replace(/^.*[\\/]/, '');
  const { doc, report } = await adapter.import(bytes, { fileName });
  return { doc, report, format: desc.id };
}

/** Run an export. Notes about what the format could not keep go to `ctx.warn`. */
export async function exportDocument(
  id: string,
  doc: CurvsDocument,
  scope: ExportScope,
  opts: Record<string, unknown> | undefined,
  ctx: ExportContext,
): Promise<Blob> {
  const adapter = await loadAdapter(id);
  if (!adapter.canExport || !adapter.export) throw new Error(`Saving as ${adapter.label} isn't available.`);
  return adapter.export(doc, scope, { ...(adapter.defaults ?? {}), ...(opts ?? {}) }, ctx);
}

/** Export and collect the notes in one call. */
export async function exportWithReport(
  id: string,
  doc: CurvsDocument,
  scope: ExportScope,
  opts: Record<string, unknown> | undefined,
  ctx: Omit<ExportContext, 'warn'>,
): Promise<{ blob: Blob; warnings: string[]; fileName: string }> {
  const warnings: string[] = [];
  const blob = await exportDocument(id, doc, scope, opts, {
    ...ctx,
    warn: (m) => !warnings.includes(m) && warnings.push(m),
  });
  return { blob, warnings, fileName: fileNameFor(id, ctx.name) };
}

export function fileNameFor(id: string, base: string): string {
  const d = descriptorFor(id);
  return `${base || 'Untitled'}.${d?.extensions[0] ?? id}`;
}

/** Rough output size in bytes for the dialog footer ("≈ 18 KB"). */
export function estimateSize(
  id: string,
  doc: CurvsDocument,
  scope: ExportScope,
  opts: Record<string, unknown>,
  activeArtboard: string,
): number {
  const nodes = allNodes(doc);
  let pathNodes = 0;
  let images = 0;
  for (const n of nodes) {
    if (n.type === 'path') for (const sp of n.subpaths) pathNodes += sp.nodes.length;
    else if (n.type === 'image') images += (doc.assets[n.asset]?.length ?? 0) * 0.75;
    else pathNodes += 8;
  }
  const share = scope.kind === 'all' ? 1 : 1 / Math.max(1, doc.artboards.length);
  const vector = (perNode: number, perObject: number, overhead: number) =>
    overhead + (pathNodes * perNode + nodes.length * perObject) * share + images * share;
  switch (id) {
    case 'curvs':
      return vector(60, 400, 2000) * 0.35;
    case 'svg':
      return vector(opts.minify ? 22 : 26, 140, 300);
    case 'pdf':
    case 'ai':
      return vector(24, 120, 3000) * 0.45 + (opts.embedFonts ? 25000 : 0);
    case 'eps':
      return vector(36, 200, 2500);
    case 'dxf':
      return vector(160, 120, 1500);
    case 'emf':
      return vector(12, 140, 400);
    case 'png':
    case 'jpg':
    case 'webp': {
      const page = pagesForScope(doc, scope, { activeArtboard, name: '' }, true)[0];
      const rect = page ?? { width: 1, height: 1 };
      const scale = Number(opts.scale) || 1;
      const w = Number(opts.width) || rect.width * scale;
      const h =
        Number(opts.height) ||
        (opts.width ? (rect.height * Number(opts.width)) / rect.width : rect.height * scale);
      const q = (Number(opts.quality) || 90) / 100;
      const bpp = id === 'png' ? 0.9 : id === 'jpg' ? 0.15 + q * 0.5 : 0.08 + q * 0.35;
      return Math.round(w * h * bpp) + 200;
    }
    default:
      return 0;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.max(1, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
