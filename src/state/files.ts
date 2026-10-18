/* Opening, saving, autosave and recent files.
   Uses the File System Access API first (showOpenFilePicker/showSaveFilePicker), falling back to
   <input type=file> and downloads. Pattern follows BetterSCAD's fs-access module. */
import type { CurvsDocument } from '../core/types';
import type { History } from '../core/history';
import { activeDoc, getState, isDirty, type OpenDoc, openDocument, setState, updateDoc } from './store';
import { deleteBlob, idbAll, idbDelete, idbGet, idbSet, lsGet, lsSet, readBlob, writeBlob } from './storage';
import { toast } from '../ui/toast';

export const supportsOpenPicker = () => typeof window !== 'undefined' && 'showOpenFilePicker' in window;
export const supportsSavePicker = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

type PickerWindow = Window & {
  showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
};
type PermHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export const OPEN_ACCEPT: Record<string, string[]> = {
  'application/x-curvesmith': ['.curvs'],
  'image/svg+xml': ['.svg', '.svgz'],
  'application/pdf': ['.pdf'],
  'application/illustrator': ['.ai'],
  'application/postscript': ['.eps'],
  'application/dxf': ['.dxf'],
  'image/emf': ['.emf'],
  'image/wmf': ['.wmf'],
  'application/x-coreldraw': ['.cdr'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function splitName(fileName: string): { base: string; ext: string } {
  const i = fileName.lastIndexOf('.');
  if (i <= 0) return { base: fileName, ext: '' };
  return { base: fileName.slice(0, i), ext: fileName.slice(i).toLowerCase() };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pickWithInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export async function writeToHandle(handle: FileSystemFileHandle, data: Blob): Promise<boolean> {
  try {
    const h = handle as PermHandle;
    const perm = await h.queryPermission?.({ mode: 'readwrite' });
    if (perm && perm !== 'granted') {
      const req = await h.requestPermission?.({ mode: 'readwrite' });
      if (req !== 'granted') return false;
    }
    // createWritable writes to a swap file and replaces the original on close.
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
    return true;
  } catch {
    return false;
  }
}

/** Save a blob somewhere the user picks. Returns the handle when the picker was used. */
export async function saveBlobAs(
  blob: Blob,
  suggestedName: string,
  type: { description: string; mime: string; ext: string },
): Promise<
  | { status: 'saved'; handle: FileSystemFileHandle }
  | { status: 'downloaded' }
  | { status: 'cancelled' }
  | { status: 'failed' }
> {
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: type.description, accept: { [type.mime]: [type.ext] } }],
      });
      return (await writeToHandle(handle, blob)) ? { status: 'saved', handle } : { status: 'failed' };
    } catch (e) {
      if (isAbort(e)) return { status: 'cancelled' };
      // Some contexts (iframes, unsupported types) reject the picker: download instead.
    }
  }
  downloadBlob(blob, suggestedName);
  return { status: 'downloaded' };
}

// ---------------------------------------------------------------------------------------------
// Open

export async function openFromBytes(
  name: string,
  bytes: Uint8Array,
  handle: FileSystemFileHandle | null = null,
) {
  const { importFile } = await import('../formats/registry');
  try {
    const { doc, report } = await importFile({ name, bytes });
    const { base, ext } = splitName(name);
    const isNative = ext === '.curvs';
    // Opening a file that is already open just switches to its tab.
    const existing = getState().docs.find((d) => d.doc.id === doc.id && isNative);
    if (existing) {
      setState({ activeKey: existing.key, route: 'editor' });
      return existing.key;
    }
    const key = openDocument(doc, {
      name: base,
      ext: isNative ? '.curvs' : ext,
      handle: isNative ? handle : null,
      saved: isNative,
      report: isNative ? null : report,
    });
    void import('../fonts/loader').then((m) => m.ensureDocumentFonts(doc));
    void addRecent(
      getState().docs.find((d) => d.key === key)!,
      handle,
    );
    return key;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : `Could not open ${name}.`);
    return null;
  }
}

export async function openFile(file: File, handle: FileSystemFileHandle | null = null) {
  return openFromBytes(file.name, new Uint8Array(await file.arrayBuffer()), handle);
}

export async function openFiles() {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Vector and image files', accept: OPEN_ACCEPT }],
        excludeAcceptAllOption: false,
      });
      for (const h of handles) await openFile(await h.getFile(), h);
      return;
    } catch (e) {
      if (isAbort(e)) return;
    }
  }
  const files = await pickWithInput(Object.values(OPEN_ACCEPT).flat().join(','), true);
  for (const f of files) await openFile(f);
}

// ---------------------------------------------------------------------------------------------
// Save

export async function serializeCurvs(doc: CurvsDocument): Promise<Blob> {
  const [{ exportDocument }, { renderThumbnail }] = await Promise.all([
    import('../formats/registry'),
    import('../render/raster'),
  ]);
  const thumbnail = await renderThumbnail(doc).catch(() => null);
  return exportDocument(
    'curvs',
    doc,
    { kind: 'all' },
    { thumbnail: thumbnail ?? undefined },
    { name: 'document', selection: [], activeArtboard: doc.artboards[0]?.id ?? '', warn: () => undefined },
  );
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  const od = activeDoc();
  if (!od) return false;
  const version = od.version;
  const blob = await serializeCurvs(withView(od));
  if (od.handle && od.ext === '.curvs' && !saveAs) {
    if (await writeToHandle(od.handle, blob)) {
      markSaved(od.key, version, od.handle, od.name);
      toast.success(`Saved ${od.name}.curvs`);
      return true;
    }
    toast('Could not write to the original file. Choose where to save it.');
  }
  const res = await saveBlobAs(blob, `${od.name}.curvs`, {
    description: 'Curvesmith document',
    mime: 'application/x-curvesmith',
    ext: '.curvs',
  });
  if (res.status === 'cancelled') return false;
  if (res.status === 'failed') {
    toast.error('Saving failed. Try another location.');
    return false;
  }
  const handle = res.status === 'saved' ? res.handle : null;
  const name = handle ? splitName(handle.name).base : od.name;
  markSaved(od.key, version, handle, name);
  toast.success(res.status === 'saved' ? `Saved ${name}.curvs` : `Downloaded ${name}.curvs`);
  return true;
}

function withView(od: OpenDoc): CurvsDocument {
  if (!od.view) return od.doc;
  return {
    ...od.doc,
    view: { artboard: od.activeArtboard, zoom: od.view.zoom, cx: od.view.panX, cy: od.view.panY },
  };
}

function markSaved(key: string, version: number, handle: FileSystemFileHandle | null, name: string) {
  updateDoc(key, { savedVersion: version, savedAt: Date.now(), handle, name, ext: '.curvs' });
  const od = getState().docs.find((d) => d.key === key);
  if (od) void addRecent(od, handle);
}

// ---------------------------------------------------------------------------------------------
// Recent files and autosave

export type RecentEntry = {
  id: string;
  name: string;
  ext: string;
  modified: number;
  thumbnail: string | null;
  handle: FileSystemFileHandle | null;
};

async function thumbnailDataUrl(doc: CurvsDocument): Promise<string | null> {
  try {
    const { renderThumbnail } = await import('../render/raster');
    const blob = await renderThumbnail(doc, 320);
    if (!blob) return null;
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function addRecent(od: OpenDoc, handle: FileSystemFileHandle | null) {
  const entry: RecentEntry = {
    id: od.doc.id,
    name: od.name,
    ext: od.ext,
    modified: Date.now(),
    thumbnail: await thumbnailDataUrl(od.doc),
    handle: handle ?? (await idbGet<RecentEntry>('recent', od.doc.id))?.handle ?? null,
  };
  try {
    await idbSet('recent', od.doc.id, entry);
  } catch {
    // Some browsers refuse to store handles; keep the entry without one.
    await idbSet('recent', od.doc.id, { ...entry, handle: null });
  }
  window.dispatchEvent(new Event('curvesmith:recent'));
}

export async function listRecent(): Promise<RecentEntry[]> {
  return (await idbAll<RecentEntry>('recent')).sort((a, b) => b.modified - a.modified);
}

export async function removeRecent(id: string) {
  await idbDelete('recent', id);
  window.dispatchEvent(new Event('curvesmith:recent'));
}

export type AutosaveEntry = {
  id: string;
  name: string;
  ext: string;
  modified: number;
  thumbnail: string | null;
};

type AutosavePayload = {
  doc: CurvsDocument;
  history: History;
  name: string;
  ext: string;
  key: string;
  savedVersion: number;
  version: number;
};

export async function autosave(od: OpenDoc): Promise<boolean> {
  const payload: AutosavePayload = {
    doc: od.doc,
    history: od.history,
    name: od.name,
    ext: od.ext,
    key: od.key,
    savedVersion: od.savedVersion,
    version: od.version,
  };
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return false;
  }
  const where = await writeBlob(`${od.doc.id}.json`, text);
  if (!where) return false;
  const meta: AutosaveEntry = {
    id: od.doc.id,
    name: od.name,
    ext: od.ext,
    modified: Date.now(),
    thumbnail: await thumbnailDataUrl(od.doc),
  };
  await idbSet('autosave', od.doc.id, meta);
  updateDoc(od.key, { autosavedAt: Date.now() });
  window.dispatchEvent(new Event('curvesmith:recent'));
  return true;
}

export async function listAutosaves(): Promise<AutosaveEntry[]> {
  return (await idbAll<AutosaveEntry>('autosave')).sort((a, b) => b.modified - a.modified);
}

export async function deleteAutosave(id: string) {
  await deleteBlob(`${id}.json`);
  await idbDelete('autosave', id);
  window.dispatchEvent(new Event('curvesmith:recent'));
}

/** Reopen an autosaved document (with its undo history). */
export async function openAutosave(id: string, activate = true): Promise<string | null> {
  const open = getState().docs.find((d) => d.doc.id === id);
  if (open) {
    if (activate) setState({ activeKey: open.key, route: 'editor' });
    return open.key;
  }
  const text = await readBlob(`${id}.json`);
  if (!text) return null;
  try {
    const p = JSON.parse(text) as AutosavePayload;
    const prevActive = getState().activeKey;
    const key = openDocument(p.doc, { name: p.name, ext: p.ext, history: p.history, key: p.key });
    updateDoc(key, { version: p.version, savedVersion: p.savedVersion, autosavedAt: Date.now() });
    if (!activate && prevActive) setState({ activeKey: prevActive });
    void import('../fonts/loader').then((m) => m.ensureDocumentFonts(p.doc));
    return key;
  } catch {
    return null;
  }
}

/** Reopen a recent file: through its stored handle when the browser allows, else from its autosave copy. */
export async function openRecent(entry: RecentEntry) {
  if (entry.handle) {
    try {
      const h = entry.handle as PermHandle;
      let perm = await h.queryPermission?.({ mode: 'read' });
      if (perm !== 'granted') perm = await h.requestPermission?.({ mode: 'read' });
      if (perm === 'granted' || perm === undefined) {
        await openFile(await entry.handle.getFile(), entry.handle);
        return;
      }
    } catch {
      /* fall back to the autosave copy */
    }
  }
  if (await openAutosave(entry.id)) return;
  toast('That file is no longer available here. Open it again from disk.');
}

// ---- Session (which tabs were open) ----

const SESSION_KEY = 'curvesmith.session';

export function saveSession() {
  const s = getState();
  lsSet(SESSION_KEY, {
    open: s.docs.map((d) => d.doc.id),
    active: activeDoc()?.doc.id ?? null,
    route: s.route,
  });
}

export async function restoreSession(): Promise<boolean> {
  const sess = lsGet<{ open: string[]; active: string | null; route: string } | null>(SESSION_KEY, null);
  if (!sess?.open?.length) return false;
  const landed = getState().route;
  let any = false;
  for (const id of sess.open) if (await openAutosave(id, false)) any = true;
  // Reopening documents switches to the editor; a deep link to /help or /about wins.
  if (landed === 'help' || landed === 'about') setState({ route: landed });
  const active = getState().docs.find((d) => d.doc.id === sess.active) ?? getState().docs[0];
  const onPage = landed === 'help' || landed === 'about';
  if (active)
    setState({
      activeKey: active.key,
      ...(onPage ? {} : { route: sess.route === 'home' ? 'home' : 'editor' }),
    });
  return any;
}

let timer: ReturnType<typeof setInterval> | null = null;
const lastAutosaved = new Map<string, number>();

export async function autosaveAll() {
  for (const od of getState().docs) {
    if (lastAutosaved.get(od.key) === od.version) continue;
    if (await autosave(od)) lastAutosaved.set(od.key, od.version);
  }
  saveSession();
}

/** Autosave every 30 s and when the window loses focus. */
export function startAutosave() {
  if (timer) return;
  timer = setInterval(() => void autosaveAll(), 30_000);
  window.addEventListener('blur', () => void autosaveAll());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosaveAll();
  });
  window.addEventListener('beforeunload', (e) => {
    saveSession();
    void autosaveAll();
    if (getState().docs.some((d) => isDirty(d) && lastAutosaved.get(d.key) !== d.version)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
