import { create } from 'zustand';
import type { Draft } from 'immer';
import type { Color, CurvsDocument, ImportReport, SceneNode } from '../core/types';
import {
  emptyHistory,
  type History,
  jumpTo,
  preview,
  push,
  record,
  type Recipe,
  redo as redoH,
  undo as undoH,
} from '../core/history';
import { createDocument, locate } from '../core/document';
import { INK } from '../core/document';
import { hexToColor } from '../core/color';
import { newId } from '../core/id';
import type { ToolId } from '../tools/ids';
import type { ShapeToolKind } from '../core/shapeCatalog';
import type { ShapeParams } from '../core/geometry/multishape';

export type ViewState = { zoom: number; panX: number; panY: number };

export type NodeSelection = { id: string; sp: number; i: number };

export type OpenDoc = {
  key: string;
  doc: CurvsDocument;
  history: History;
  selection: string[];
  /** Selected path nodes for the Node tool. */
  nodeSelection: NodeSelection[];
  name: string;
  ext: string;
  handle: FileSystemFileHandle | null;
  version: number;
  savedVersion: number;
  savedAt: number | null;
  /** Last autosave to this device. */
  autosavedAt: number | null;
  view: ViewState | null;
  activeArtboard: string;
  /** Id of the group being edited in isolation, if any. */
  isolation: string | null;
  /** Last transform (matrix delta in world space) for Transform Again. */
  lastTransform: [number, number, number, number, number, number] | null;
  exportSettings: Record<string, Record<string, unknown>>;
  lastExport: { format: string; scope: 'selection' | 'artwork' | 'artboard' | 'all'; name: string } | null;
  importReport: ImportReport | null;
};

export type Snapping = {
  nodes: boolean;
  guides: boolean;
  pixel: boolean;
  objects: boolean;
  angles: boolean;
  grid: boolean;
};
export type Theme = 'light' | 'dark' | 'system';
export type Route = 'home' | 'editor' | 'help' | 'about';
export type HomeSection = 'home' | 'files' | 'libraries';

export type Dialog =
  | null
  | 'export'
  | 'palette'
  | 'preferences'
  | 'customSize'
  | 'shortcuts'
  | 'tour'
  | 'importReport'
  | 'closeConfirm'
  | 'symbol'
  | 'trace';

export type UiState = {
  hideAll: boolean;
  hidePanels: boolean;
  inspectorTab: 'design' | 'assets';
  layersHeight: number;
  rulers: boolean;
  guides: boolean;
  /** Guides can't be dragged with the Move tool. */
  lockGuides: boolean;
  /** Pixel grid at high zoom. */
  grid: boolean;
  /** The document's layout grid. */
  showGrid: boolean;
  outline: boolean;
  showAllHandles: boolean;
  pencilSmoothing: number;
  penMode: 'pen' | 'smart' | 'polygon' | 'line';
  starPolygon: boolean;
  starPoints: number;
  /** Shape drawn by the Shapes tool, and the last parameters used per shape. */
  shapeKind: ShapeToolKind;
  shapeParams: Record<string, ShapeParams>;
  drawer: boolean;
  historyOpen: boolean;
};

export type DefaultStyle = {
  fill: Color | null;
  stroke: Color | null;
  strokeWidth: number;
  focus: 'fill' | 'stroke';
};

export type EditorState = {
  route: Route;
  homeSection: HomeSection;
  docs: OpenDoc[];
  activeKey: string | null;
  tool: ToolId;
  /** Tool to return to after a temporary switch (Space → Hand). */
  springTool: ToolId | null;
  snapping: Snapping;
  theme: Theme;
  ui: UiState;
  defaults: DefaultStyle;
  dialog: Dialog;
  dialogArg: unknown;
  closingKey: string | null;
  /** Text node being edited on canvas. */
  editingText: string | null;
};

export const DEFAULT_UI: UiState = {
  hideAll: false,
  hidePanels: false,
  inspectorTab: 'design',
  layersHeight: 262,
  rulers: true,
  guides: true,
  lockGuides: false,
  grid: false,
  showGrid: false,
  outline: false,
  showAllHandles: true,
  pencilSmoothing: 0.4,
  penMode: 'pen',
  starPolygon: false,
  starPoints: 5,
  shapeKind: 'star',
  shapeParams: {},
  drawer: false,
  historyOpen: false,
};

const initial: EditorState = {
  route: 'home',
  homeSection: 'home',
  docs: [],
  activeKey: null,
  tool: 'move',
  springTool: null,
  snapping: { nodes: true, guides: true, pixel: false, objects: true, angles: true, grid: false },
  theme: 'system',
  ui: DEFAULT_UI,
  defaults: { fill: hexToColor('#D9D6D0'), stroke: INK, strokeWidth: 1, focus: 'fill' },
  dialog: null,
  dialogArg: null,
  closingKey: null,
  editingText: null,
};

export const useEditor = create<EditorState>(() => initial);
export const getState = useEditor.getState;
export const setState = useEditor.setState;

export function resetStore() {
  setState({ ...initial, docs: [], ui: { ...DEFAULT_UI } }, true);
}

// ---------------------------------------------------------------------------------------------
// Selectors

export const activeDoc = (s: EditorState = getState()) => s.docs.find((d) => d.key === s.activeKey) ?? null;
export const useActiveDoc = () => useEditor((s) => s.docs.find((d) => d.key === s.activeKey) ?? null);
export const isDirty = (d: OpenDoc) => d.version !== d.savedVersion;

function updateActive(fn: (d: OpenDoc) => OpenDoc) {
  const s = getState();
  if (!s.activeKey) return;
  setState({ docs: s.docs.map((d) => (d.key === s.activeKey ? fn(d) : d)) });
}

export function updateDoc(key: string, patch: Partial<OpenDoc>) {
  setState({ docs: getState().docs.map((d) => (d.key === key ? { ...d, ...patch } : d)) });
}

// ---------------------------------------------------------------------------------------------
// Documents

export type OpenOptions = {
  name: string;
  ext?: string;
  handle?: FileSystemFileHandle | null;
  saved?: boolean;
  history?: History;
  key?: string;
  report?: ImportReport | null;
};

export function openDocument(doc: CurvsDocument, opts: OpenOptions): string {
  const key = opts.key ?? newId('tab');
  const existing = getState().docs.find((d) => d.key === key);
  const od: OpenDoc = {
    key,
    doc,
    history: opts.history ?? emptyHistory(),
    selection: [],
    nodeSelection: [],
    name: opts.name,
    ext: opts.ext ?? '.curvs',
    handle: opts.handle ?? null,
    version: 0,
    savedVersion: opts.saved === false ? -1 : 0,
    savedAt: opts.saved === false ? null : Date.now(),
    autosavedAt: null,
    view: null,
    activeArtboard:
      doc.view?.artboard && doc.artboards.some((a) => a.id === doc.view!.artboard)
        ? doc.view.artboard
        : (doc.artboards[0]?.id ?? ''),
    isolation: null,
    lastTransform: null,
    exportSettings: {},
    lastExport: null,
    importReport: opts.report ?? null,
  };
  setState({
    docs: existing ? getState().docs.map((d) => (d.key === key ? od : d)) : [...getState().docs, od],
    activeKey: key,
    route: 'editor',
    editingText: null,
    dialog:
      opts.report && (opts.report.warnings.length || Object.keys(opts.report.notes).length)
        ? 'importReport'
        : getState().dialog,
  });
  return key;
}

export function newDocument(opts: {
  name?: string;
  width: number;
  height: number;
  units: CurvsDocument['units'];
  colorMode?: CurvsDocument['colorProfile'];
}) {
  const doc = createDocument({
    name: opts.name,
    width: opts.width,
    height: opts.height,
    units: opts.units,
    colorMode: opts.colorMode,
  });
  return openDocument(doc, { name: opts.name ?? 'Untitled', saved: false });
}

export function closeDocument(key: string) {
  const s = getState();
  const idx = s.docs.findIndex((d) => d.key === key);
  const docs = s.docs.filter((d) => d.key !== key);
  let activeKey = s.activeKey;
  if (activeKey === key) activeKey = docs[Math.min(idx, docs.length - 1)]?.key ?? null;
  setState({ docs, activeKey, route: docs.length ? s.route : 'home', editingText: null });
}

export function setActive(key: string) {
  setState({ activeKey: key, route: 'editor', editingText: null });
}

// ---------------------------------------------------------------------------------------------
// Mutations

/** Apply a recorded change to the active document. `selection` replaces the selection when given. */
export function mutate(
  label: string,
  recipe: Recipe,
  selection?: string[],
  opts: { coalesce?: number } = {},
): boolean {
  const d = activeDoc();
  if (!d) return false;
  const selAfter = selection ?? d.selection;
  const { doc, entry } = record(d.doc, recipe, label, d.selection, selAfter);
  if (!entry) return false;
  updateActive((o) => ({
    ...o,
    doc,
    history: push(o.history, entry, opts.coalesce ?? 0),
    selection: pruneSelection(doc, selAfter),
    version: o.version + 1,
  }));
  return true;
}

// Live gestures: preview from a base document, record once at the end.
let gestureBase: {
  key: string;
  doc: CurvsDocument;
  recipe: Recipe | null;
  kept: Recipe[];
  selection: string[];
} | null = null;

export function beginGesture() {
  const d = activeDoc();
  if (!d) return;
  gestureBase = { key: d.key, doc: d.doc, recipe: null, kept: [], selection: d.selection };
}

export const gestureActive = () => gestureBase !== null;
export const gestureBaseDoc = () => gestureBase?.doc ?? null;

/**
 * Preview a change from the gesture's base document. Each call replaces the previous preview, except
 * steps passed with `keep` (e.g. "add a node"), which stay applied under every later preview.
 */
export function updateGesture(recipe: Recipe, keep = false) {
  const g = gestureBase;
  if (!g) return;
  if (keep) g.kept.push(recipe);
  else g.recipe = recipe;
  const combined = gestureRecipe(g);
  updateDoc(g.key, { doc: preview(g.doc, combined) });
}

function gestureRecipe(g: NonNullable<typeof gestureBase>): Recipe {
  const steps = g.recipe ? [...g.kept, g.recipe] : g.kept;
  return (d) => steps.forEach((r) => r(d));
}

export function endGesture(label: string, selection?: string[]) {
  const g = gestureBase;
  gestureBase = null;
  if (!g) return;
  const d = getState().docs.find((x) => x.key === g.key);
  if (!d) return;
  if (!g.recipe && !g.kept.length) {
    updateDoc(g.key, { doc: g.doc, ...(selection ? { selection } : {}) });
    return;
  }
  const selAfter = selection ?? d.selection;
  const { doc, entry } = record(g.doc, gestureRecipe(g), label, g.selection, selAfter);
  if (!entry) {
    updateDoc(g.key, { doc: g.doc });
    return;
  }
  updateDoc(g.key, {
    doc,
    history: push(d.history, entry),
    selection: pruneSelection(doc, selAfter),
    version: d.version + 1,
  });
}

export function cancelGesture() {
  const g = gestureBase;
  gestureBase = null;
  if (g) updateDoc(g.key, { doc: g.doc });
}

function pruneSelection(doc: CurvsDocument, ids: string[]) {
  return ids.filter((id) => locate(doc, id));
}

export function select(ids: string[]) {
  updateActive((d) => ({ ...d, selection: pruneSelection(d.doc, ids), nodeSelection: [] }));
}

export function setNodeSelection(nodeSelection: NodeSelection[]) {
  updateActive((d) => ({ ...d, nodeSelection }));
}

export function undo() {
  const d = activeDoc();
  if (!d || gestureBase) return;
  const r = undoH(d.doc, d.history);
  if (!r) return;
  updateActive((o) => ({
    ...o,
    doc: r.doc,
    history: r.history,
    selection: pruneSelection(r.doc, r.selection),
    nodeSelection: [],
    version: o.version + 1,
  }));
}

export function redo() {
  const d = activeDoc();
  if (!d || gestureBase) return;
  const r = redoH(d.doc, d.history);
  if (!r) return;
  updateActive((o) => ({
    ...o,
    doc: r.doc,
    history: r.history,
    selection: pruneSelection(r.doc, r.selection),
    nodeSelection: [],
    version: o.version + 1,
  }));
}

export function jumpHistory(index: number) {
  const d = activeDoc();
  if (!d) return;
  const r = jumpTo(d.doc, d.history, index);
  updateActive((o) => ({
    ...o,
    doc: r.doc,
    history: r.history,
    selection: pruneSelection(r.doc, r.selection),
    version: o.version + 1,
  }));
}

export function setView(view: ViewState) {
  updateActive((d) => ({ ...d, view }));
}

export function setActiveArtboard(id: string) {
  updateActive((d) => ({ ...d, activeArtboard: id }));
}

export function setIsolation(id: string | null) {
  updateActive((d) => ({ ...d, isolation: id, selection: [] }));
}

export function setTool(tool: ToolId) {
  setState({ tool, springTool: null, editingText: null });
  if (tool !== 'node') setNodeSelection([]);
}

export function setUi(patch: Partial<UiState>) {
  setState({ ui: { ...getState().ui, ...patch } });
}

export function openDialog(dialog: Dialog, arg: unknown = null) {
  setState({ dialog, dialogArg: arg });
}

export const closeDialog = () => setState({ dialog: null, dialogArg: null });

/** Helper for recipes that edit selected nodes. */
export function forEachSelected(
  draft: Draft<CurvsDocument>,
  ids: string[],
  fn: (node: Draft<SceneNode>) => void,
) {
  for (const id of ids) {
    const loc = locate(draft as CurvsDocument, id);
    if (loc) fn(loc.node as Draft<SceneNode>);
  }
}
