/* Export, print and place. */
import type { ExportScope } from '../core/types';
import { activeDoc, openDialog, updateDoc } from './store';
import { downloadBlob, saveBlobAs } from './files';
import { addNode } from './actions';
import { makeGroup, clone } from '../core/document';
import { translate, multiply } from '../core/matrix';
import { toast } from '../ui/toast';
import { selectionBounds } from '../core/transform';

export type ScopeKind = 'selection' | 'artboard' | 'all';

export function scopeFor(kind: ScopeKind): ExportScope {
  const od = activeDoc()!;
  if (kind === 'selection' && od.selection.length) return { kind: 'selection', ids: od.selection };
  if (kind === 'all') return { kind: 'all' };
  return { kind: 'artboard', id: od.activeArtboard };
}

export async function renderExport(
  format: string,
  kind: ScopeKind,
  opts: Record<string, unknown>,
  name: string,
): Promise<{ blob: Blob; warnings: string[] }> {
  const od = activeDoc()!;
  const { exportWithReport } = await import('../formats/registry');
  let extra = opts;
  if (format === 'curvs') {
    const { renderThumbnail } = await import('../render/raster');
    extra = { ...opts, thumbnail: (await renderThumbnail(od.doc)) ?? undefined };
  }
  const r = await exportWithReport(format, od.doc, scopeFor(kind), extra, {
    name,
    selection: od.selection,
    activeArtboard: od.activeArtboard,
  });
  return { blob: r.blob, warnings: r.warnings };
}

export async function runExport(
  format: string,
  kind: ScopeKind,
  opts: Record<string, unknown>,
  name: string,
): Promise<boolean> {
  const od = activeDoc();
  if (!od) return false;
  const { FORMATS } = await import('../formats/registry');
  const f = FORMATS.find((x) => x.id === format)!;
  try {
    const { blob, warnings } = await renderExport(format, kind, opts, name);
    const ext = `.${f.extensions[0]}`;
    const res = await saveBlobAs(blob, `${name}${ext}`, {
      description: `${f.label} file`,
      mime: f.mime[0],
      ext,
    });
    if (res.status === 'cancelled') return false;
    updateDoc(od.key, {
      exportSettings: { ...od.exportSettings, [format]: opts },
      lastExport: { format, scope: kind, name },
    });
    toast.success(`Exported ${name}${ext}`);
    for (const w of warnings) toast(w);
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Export failed.');
    return false;
  }
}

export async function exportAgain() {
  const od = activeDoc();
  if (!od) return;
  if (!od.lastExport) return openDialog('export');
  const { format, scope, name } = od.lastExport;
  await runExport(format, scope, od.exportSettings[format] ?? {}, name);
}

/** Print every artboard as its own vector page (SVG keeps curves and text crisp in the print payload). */
export async function printDocument() {
  const od = activeDoc();
  if (!od) return;
  const { artboardToSvgString } = await import('../formats/svg/export');
  const root = document.createElement('div');
  root.id = 'print-root';
  const style = document.createElement('style');
  const pages: string[] = [];
  const rules: string[] = [];
  for (const [i, ab] of od.doc.artboards.entries()) {
    const svg = await artboardToSvgString(od.doc, ab.id);
    rules.push(
      `@page ab${i} { size: ${ab.width}pt ${ab.height}pt; margin: 0; } .print-page.p${i} { page: ab${i}; width: ${ab.width}pt; height: ${ab.height}pt; }`,
    );
    pages.push(`<div class="print-page p${i}">${svg}</div>`);
  }
  style.textContent = `${rules.join('\n')}
@media screen { #print-root { display: none; } }
@media print {
  body > *:not(#print-root) { display: none !important; }
  html, body { background: #fff !important; margin: 0; }
  #print-root { display: block; }
  .print-page { break-after: page; overflow: hidden; }
  .print-page:last-child { break-after: auto; }
  .print-page svg { width: 100%; height: 100%; display: block; }
}`;
  root.innerHTML = pages.join('');
  document.head.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Give images inside the SVGs a moment to decode.
  await new Promise((r) => setTimeout(r, 50));
  window.print();
  setTimeout(cleanup, 60_000);
}

/** Place images or vector files into the current document. */
export async function placeFiles(files: File[]) {
  const od = activeDoc();
  if (!od) return;
  const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    try {
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        const { imageNodeFromFile } = await import('../formats/raster/import');
        const { node, assetKey, dataUrl } = await imageNodeFromFile(
          bytes,
          file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        );
        const fit = Math.min(1, (ab.width * 0.8) / node.width, (ab.height * 0.8) / node.height);
        node.width *= fit;
        node.height *= fit;
        node.name = file.name.replace(/\.[^.]+$/, '');
        node.transform = translate(ab.x + (ab.width - node.width) / 2, ab.y + (ab.height - node.height) / 2);
        const { mutate } = await import('./store');
        mutate('Place image', (d) => void (d.assets[assetKey] = dataUrl));
        addNode(node, 'Place image');
      } else {
        const { importFile } = await import('../formats/registry');
        const { doc } = await importFile({ name: file.name, bytes });
        const src = doc.artboards[0];
        const group = makeGroup(clone(src.children), file.name.replace(/\.[^.]+$/, ''));
        const b = { x: ab.x + (ab.width - src.width) / 2, y: ab.y + (ab.height - src.height) / 2 };
        group.transform = multiply(translate(b.x, b.y), group.transform);
        const { mutate } = await import('./store');
        mutate('Place', (d) => {
          for (const [k, v] of Object.entries(doc.assets)) d.assets[k] = v;
          for (const s of doc.swatches)
            if (!d.swatches.some((x) => x.id === s.id)) d.swatches.push(s as never);
        });
        addNode(group, 'Place');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not place ${file.name}.`);
    }
  }
}

export async function placeImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.webp,.gif,.svg,.svgz,.dxf,.pdf,.ai';
  input.multiple = true;
  input.onchange = () => void placeFiles([...(input.files ?? [])]);
  input.click();
}

export function downloadSelectionPng() {
  const od = activeDoc();
  if (!od || !selectionBounds(od.doc, od.selection)) return;
  void renderExport('png', 'selection', { scale: 2, transparent: true, antialias: true }, 'selection').then(
    (r) => downloadBlob(r.blob, 'selection.png'),
  );
}
