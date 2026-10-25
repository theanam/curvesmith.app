/* One registry drives menus, the command palette and keyboard shortcuts.
   Shortcuts use "Mod" for ⌘ on macOS and Ctrl elsewhere. */
import * as A from './actions';
import {
  activeDoc,
  closeDialog,
  getState,
  isDirty,
  openDialog,
  redo,
  setState,
  setTool,
  setUi,
  setView,
  undo,
  type Theme,
} from './store';
import { openFiles, saveDocument } from './files';
import { fitRect, stepZoom, zoomAt } from '../render/viewport';
import { selectionBounds } from '../core/transform';
import { TOOLS, type ToolId } from '../tools/ids';
import { exportAgain, placeImage, printDocument } from './io';
import { navigate } from '../ui/router';
import { createOutlines, makeSymbol } from './extra';
import { openTrace, selectedImage } from './trace';
import { canCrop, resetCrop, startCrop } from './crop';
import { addGuide, clearGuides, guideCount } from './guides';

export type Category = 'File' | 'Edit' | 'Object' | 'Type' | 'View' | 'Help' | 'Tool';

export type Command = {
  id: string;
  title: string;
  category: Category;
  shortcut?: string;
  /** Extra shortcuts that trigger the command but are not displayed. */
  alt?: string[];
  keywords?: string;
  run: () => void | Promise<unknown>;
  enabled?: () => boolean;
  /** Needs an open document. */
  doc?: boolean;
  /** On/off state for toggles, shown as a check in menus. */
  checked?: () => boolean;
};

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function formatShortcut(s: string, mac = IS_MAC): string {
  const parts = s.split('+');
  const key = parts.pop()!;
  const mods = parts.map((p) => {
    if (p === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (p === 'Shift') return mac ? '⇧' : 'Shift';
    if (p === 'Alt') return mac ? '⌥' : 'Alt';
    return p;
  });
  const k =
    key.length === 1
      ? key.toUpperCase()
      : ({ Backspace: '⌫', Delete: 'Del', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', Enter: '↵' }[key] ??
        key);
  return mac ? [...mods, k].join('') : [...mods, k].join('+');
}

const hasDoc = () => !!activeDoc();
const hasSel = () => (activeDoc()?.selection.length ?? 0) > 0;
const hasMulti = () => (activeDoc()?.selection.length ?? 0) > 1;

function canvasSize() {
  const el = document.querySelector('[data-canvas-host]') as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  return { w: r?.width || 800, h: r?.height || 600 };
}

export function zoomFitArtboard() {
  const od = activeDoc();
  if (!od) return;
  const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
  if (!ab) return;
  const { w, h } = canvasSize();
  setView(fitRect({ x: ab.x, y: ab.y, width: ab.width, height: ab.height }, w, h, 56));
}

export function zoomFitAll() {
  const od = activeDoc();
  if (!od?.doc.artboards.length) return;
  const xs = od.doc.artboards.flatMap((a) => [a.x, a.x + a.width]);
  const ys = od.doc.artboards.flatMap((a) => [a.y, a.y + a.height]);
  const { w, h } = canvasSize();
  setView(
    fitRect(
      {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      w,
      h,
      56,
    ),
  );
}

function zoomTo(z: number) {
  const od = activeDoc();
  if (!od?.view) return;
  const { w, h } = canvasSize();
  setView(zoomAt(od.view, z, [w / 2, h / 2]));
}

function zoomSelection() {
  const od = activeDoc();
  if (!od) return;
  const r = selectionBounds(od.doc, od.selection);
  if (!r) return zoomFitArtboard();
  const { w, h } = canvasSize();
  setView(fitRect(r, w, h, 80));
}

const THEMES: Theme[] = ['light', 'dark', 'system'];
export const cycleTheme = () =>
  setState({ theme: THEMES[(THEMES.indexOf(getState().theme) + 1) % THEMES.length] });

export const REPO_URL = 'https://github.com/theanam/curvesmith.app';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const CONTACT_EMAIL = 'anam.ahmed.a@gmail.com';

const toolCommands: Command[] = TOOLS.map((t) => ({
  id: `tool.${t.id}`,
  title: `${t.label} tool`,
  category: 'Tool' as const,
  shortcut: t.shortcut === '⇧M' ? 'Shift+M' : t.shortcut,
  keywords: t.hint ?? '',
  run: () => setTool(t.id as ToolId),
  doc: true,
}));

export const COMMANDS: Command[] = [
  // File
  {
    id: 'file.new',
    title: 'New document…',
    category: 'File',
    shortcut: 'Mod+N',
    alt: ['Alt+N'],
    run: () => openDialog('customSize'),
  },
  { id: 'file.open', title: 'Open…', category: 'File', shortcut: 'Mod+O', run: () => openFiles() },
  {
    id: 'file.save',
    title: 'Save',
    category: 'File',
    shortcut: 'Mod+S',
    run: () => saveDocument(false),
    doc: true,
  },
  {
    id: 'file.saveAs',
    title: 'Save as…',
    category: 'File',
    shortcut: 'Mod+Shift+S',
    run: () => saveDocument(true),
    doc: true,
  },
  {
    id: 'file.place',
    title: 'Place image…',
    category: 'File',
    shortcut: 'Mod+Shift+P',
    run: () => placeImage(),
    doc: true,
  },
  {
    id: 'file.export',
    title: 'Export…',
    category: 'File',
    shortcut: 'Mod+Shift+E',
    run: () => openDialog('export'),
    doc: true,
  },
  {
    id: 'file.exportAgain',
    title: 'Export again',
    category: 'File',
    shortcut: 'Mod+E',
    run: () => exportAgain(),
    doc: true,
  },
  {
    id: 'file.print',
    title: 'Print…',
    category: 'File',
    shortcut: 'Mod+P',
    run: () => printDocument(),
    doc: true,
  },
  {
    id: 'file.close',
    title: 'Close document',
    category: 'File',
    shortcut: 'Alt+W',
    run: () => {
      const od = activeDoc();
      if (od) requestClose(od.key);
    },
    doc: true,
  },
  {
    id: 'file.home',
    title: 'Start screen',
    category: 'File',
    run: () => setState({ route: 'home', homeSection: 'home' }),
  },
  // Edit
  {
    id: 'edit.undo',
    title: 'Undo',
    category: 'Edit',
    shortcut: 'Mod+Z',
    run: undo,
    enabled: () => !!activeDoc()?.history.past.length,
    doc: true,
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    category: 'Edit',
    shortcut: 'Mod+Shift+Z',
    alt: ['Mod+Y'],
    run: redo,
    enabled: () => !!activeDoc()?.history.future.length,
    doc: true,
  },
  {
    id: 'edit.cut',
    title: 'Cut',
    category: 'Edit',
    shortcut: 'Mod+X',
    run: () => A.copySelection(true),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'edit.copy',
    title: 'Copy',
    category: 'Edit',
    shortcut: 'Mod+C',
    run: () => A.copySelection(false),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'edit.paste',
    title: 'Paste',
    category: 'Edit',
    shortcut: 'Mod+V',
    run: () => A.paste(false),
    enabled: A.hasClipboard,
    doc: true,
  },
  {
    id: 'edit.pasteInPlace',
    title: 'Paste in place',
    category: 'Edit',
    shortcut: 'Mod+Shift+V',
    run: () => A.paste(true),
    enabled: A.hasClipboard,
    doc: true,
  },
  {
    id: 'edit.duplicate',
    title: 'Duplicate',
    category: 'Edit',
    shortcut: 'Mod+Shift+D',
    run: () => A.duplicateSelection(),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'edit.delete',
    title: 'Delete',
    category: 'Edit',
    shortcut: 'Backspace',
    alt: ['Delete'],
    run: () => A.deleteSelectedNodes() || A.deleteSelection(),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'edit.selectAll',
    title: 'Select all',
    category: 'Edit',
    shortcut: 'Mod+A',
    run: A.selectAll,
    doc: true,
  },
  {
    id: 'edit.deselect',
    title: 'Deselect',
    category: 'Edit',
    shortcut: 'Mod+Shift+A',
    run: A.deselect,
    doc: true,
  },
  {
    id: 'edit.palette',
    title: 'Search commands',
    category: 'Edit',
    shortcut: 'Mod+K',
    run: () => openDialog('palette'),
  },
  {
    id: 'edit.preferences',
    title: 'Preferences…',
    category: 'Edit',
    shortcut: 'Mod+,',
    run: () => openDialog('preferences'),
  },
  // Object
  {
    id: 'object.group',
    title: 'Group',
    category: 'Object',
    shortcut: 'Mod+G',
    run: A.groupSelection,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.ungroup',
    title: 'Ungroup',
    category: 'Object',
    shortcut: 'Mod+Shift+G',
    run: A.ungroupSelection,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.transformAgain',
    title: 'Transform again',
    category: 'Object',
    shortcut: 'Mod+D',
    run: A.transformAgain,
    enabled: () => !!activeDoc()?.lastTransform && hasSel(),
    doc: true,
  },
  {
    id: 'object.front',
    title: 'Bring to front',
    category: 'Object',
    shortcut: 'Mod+Shift+]',
    run: () => A.arrange('front'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.forward',
    title: 'Bring forward',
    category: 'Object',
    shortcut: 'Mod+]',
    run: () => A.arrange('forward'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.backward',
    title: 'Send backward',
    category: 'Object',
    shortcut: 'Mod+[',
    run: () => A.arrange('backward'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.back',
    title: 'Send to back',
    category: 'Object',
    shortcut: 'Mod+Shift+[',
    run: () => A.arrange('back'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.union',
    title: 'Union',
    category: 'Object',
    keywords: 'boolean combine add merge',
    run: () => A.makeBoolean('union'),
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.subtract',
    title: 'Subtract',
    category: 'Object',
    keywords: 'boolean minus front',
    run: () => A.makeBoolean('subtract'),
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.intersect',
    title: 'Intersect',
    category: 'Object',
    keywords: 'boolean',
    run: () => A.makeBoolean('intersect'),
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.exclude',
    title: 'Exclude',
    category: 'Object',
    keywords: 'boolean xor',
    run: () => A.makeBoolean('exclude'),
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.divide',
    title: 'Divide',
    category: 'Object',
    keywords: 'boolean split pieces',
    run: A.divideSelection,
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.expand',
    title: 'Expand / convert to path',
    category: 'Object',
    shortcut: 'Mod+Shift+C',
    keywords: 'curves flatten',
    run: A.convertToPath,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.release',
    title: 'Release compound',
    category: 'Object',
    run: A.releaseCompound,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.traceImage',
    title: 'Trace image…',
    category: 'Object',
    keywords: 'vectorize vectorise bitmap raster photo convert',
    run: () => openTrace(),
    enabled: () => !!selectedImage(),
    doc: true,
  },
  {
    id: 'object.cropImage',
    title: 'Crop image',
    category: 'Object',
    keywords: 'trim photo bitmap frame',
    run: () => startCrop(),
    enabled: () => canCrop(selectedImage()),
    doc: true,
  },
  {
    id: 'object.resetCrop',
    title: 'Reset crop',
    category: 'Object',
    keywords: 'uncrop photo bitmap',
    run: () => resetCrop(),
    enabled: () => !!selectedImage()?.crop,
    doc: true,
  },
  {
    id: 'object.outlineStroke',
    title: 'Outline stroke',
    category: 'Object',
    run: A.outlineStroke,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.compound',
    title: 'Make compound path',
    category: 'Object',
    shortcut: 'Mod+8',
    run: A.makeCompoundPath,
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.releaseCompoundPath',
    title: 'Release compound path',
    category: 'Object',
    shortcut: 'Mod+Alt+8',
    run: A.releaseCompoundPath,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.clip',
    title: 'Make clip group',
    category: 'Object',
    shortcut: 'Mod+7',
    keywords: 'mask',
    run: A.makeClipGroup,
    enabled: hasMulti,
    doc: true,
  },
  {
    id: 'object.join',
    title: 'Join',
    category: 'Object',
    shortcut: 'Mod+J',
    run: A.joinNodes,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.simplify',
    title: 'Simplify path',
    category: 'Object',
    run: A.simplifySelection,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.reverse',
    title: 'Reverse path direction',
    category: 'Object',
    run: A.reversePath,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.flipH',
    title: 'Flip horizontal',
    category: 'Object',
    shortcut: 'Shift+H',
    run: () => A.flip('h'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.flipV',
    title: 'Flip vertical',
    category: 'Object',
    shortcut: 'Shift+V',
    run: () => A.flip('v'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.alignLeft',
    title: 'Align left',
    category: 'Object',
    run: () => A.align('left'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.alignHCenter',
    title: 'Align horizontal centers',
    category: 'Object',
    run: () => A.align('hcenter'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.alignRight',
    title: 'Align right',
    category: 'Object',
    run: () => A.align('right'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.alignTop',
    title: 'Align top',
    category: 'Object',
    run: () => A.align('top'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.alignVCenter',
    title: 'Align vertical centers',
    category: 'Object',
    run: () => A.align('vcenter'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.alignBottom',
    title: 'Align bottom',
    category: 'Object',
    run: () => A.align('bottom'),
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.distributeH',
    title: 'Distribute horizontally',
    category: 'Object',
    run: () => A.distribute('h'),
    enabled: () => (activeDoc()?.selection.length ?? 0) > 2,
    doc: true,
  },
  {
    id: 'object.distributeV',
    title: 'Distribute vertically',
    category: 'Object',
    run: () => A.distribute('v'),
    enabled: () => (activeDoc()?.selection.length ?? 0) > 2,
    doc: true,
  },
  {
    id: 'object.symbol',
    title: 'Make symbol',
    category: 'Object',
    run: makeSymbol,
    enabled: hasSel,
    doc: true,
  },
  {
    id: 'object.lock',
    title: 'Lock / unlock',
    category: 'Object',
    shortcut: 'Mod+Shift+L',
    run: () => {
      const od = activeDoc();
      for (const id of od?.selection ?? []) A.setLocked(id, true);
    },
    enabled: hasSel,
    doc: true,
  },
  // Type
  {
    id: 'type.outlines',
    title: 'Create outlines',
    category: 'Type',
    shortcut: 'Mod+Shift+O',
    keywords: 'text to path',
    run: createOutlines,
    enabled: hasSel,
    doc: true,
  },
  // View
  {
    id: 'view.zoomIn',
    title: 'Zoom in',
    category: 'View',
    shortcut: 'Mod+=',
    alt: ['Mod++'],
    run: () => zoomTo(stepZoom(activeDoc()?.view?.zoom ?? 1, 1)),
    doc: true,
  },
  {
    id: 'view.zoomOut',
    title: 'Zoom out',
    category: 'View',
    shortcut: 'Mod+-',
    run: () => zoomTo(stepZoom(activeDoc()?.view?.zoom ?? 1, -1)),
    doc: true,
  },
  {
    id: 'view.fit',
    title: 'Fit artboard',
    category: 'View',
    shortcut: 'Mod+0',
    run: zoomFitArtboard,
    doc: true,
  },
  {
    id: 'view.actual',
    title: 'Actual size (100%)',
    category: 'View',
    shortcut: 'Mod+1',
    run: () => zoomTo(1),
    doc: true,
  },
  {
    id: 'view.fitSelection',
    title: 'Fit selection',
    category: 'View',
    shortcut: 'Mod+2',
    run: zoomSelection,
    doc: true,
  },
  {
    id: 'view.fitAll',
    title: 'Fit all artboards',
    category: 'View',
    shortcut: 'Mod+Alt+0',
    run: zoomFitAll,
    doc: true,
  },
  {
    id: 'view.rulers',
    title: 'Show rulers',
    category: 'View',
    shortcut: 'Mod+R',
    checked: () => getState().ui.rulers,
    run: () => setUi({ rulers: !getState().ui.rulers }),
    doc: true,
  },
  {
    id: 'view.guides',
    title: 'Show guides',
    category: 'View',
    shortcut: 'Mod+;',
    checked: () => getState().ui.guides,
    run: () => setUi({ guides: !getState().ui.guides }),
    doc: true,
  },
  {
    id: 'view.lockGuides',
    title: 'Lock guides',
    category: 'View',
    shortcut: 'Mod+Alt+;',
    checked: () => getState().ui.lockGuides,
    run: () => setUi({ lockGuides: !getState().ui.lockGuides }),
    doc: true,
  },
  {
    id: 'view.addGuideV',
    title: 'Add vertical guide',
    category: 'View',
    keywords: 'guide line column',
    run: () => addGuide('x'),
    doc: true,
  },
  {
    id: 'view.addGuideH',
    title: 'Add horizontal guide',
    category: 'View',
    keywords: 'guide line row baseline',
    run: () => addGuide('y'),
    doc: true,
  },
  {
    id: 'view.clearGuides',
    title: 'Clear guides',
    category: 'View',
    run: () => clearGuides(),
    enabled: () => guideCount(activeDoc()) > 0,
    doc: true,
  },
  {
    id: 'view.grid',
    title: 'Show grid',
    category: 'View',
    shortcut: "Mod+'",
    keywords: 'layout grid graph paper',
    checked: () => getState().ui.showGrid,
    run: () => setUi({ showGrid: !getState().ui.showGrid }),
    doc: true,
  },
  {
    id: 'view.snapGrid',
    title: 'Snap to grid',
    category: 'View',
    shortcut: "Mod+Shift+'",
    checked: () => getState().snapping.grid,
    run: () => setState({ snapping: { ...getState().snapping, grid: !getState().snapping.grid } }),
    doc: true,
  },
  {
    id: 'view.pixelGrid',
    title: 'Show pixel grid',
    category: 'View',
    shortcut: "Mod+Alt+'",
    checked: () => getState().ui.grid,
    run: () => setUi({ grid: !getState().ui.grid }),
    doc: true,
  },
  {
    id: 'view.outline',
    title: 'Outline mode',
    category: 'View',
    shortcut: 'Mod+Alt+Y',
    keywords: 'wireframe',
    checked: () => getState().ui.outline,
    run: () => setUi({ outline: !getState().ui.outline }),
    doc: true,
  },
  {
    id: 'view.hideUi',
    title: 'Hide interface',
    category: 'View',
    shortcut: 'Tab',
    run: () => setUi({ hideAll: !getState().ui.hideAll }),
    doc: true,
  },
  {
    id: 'view.hidePanels',
    title: 'Hide panels',
    category: 'View',
    shortcut: 'Shift+Tab',
    run: () => setUi({ hidePanels: !getState().ui.hidePanels }),
    doc: true,
  },
  {
    id: 'view.history',
    title: 'History',
    category: 'View',
    keywords: 'undo versions',
    run: () => setUi({ historyOpen: !getState().ui.historyOpen }),
    doc: true,
  },
  {
    id: 'view.theme',
    title: 'Cycle theme (light, dark, system)',
    category: 'View',
    keywords: 'dark mode',
    run: cycleTheme,
  },
  {
    id: 'view.snap',
    title: 'Toggle snapping',
    category: 'View',
    shortcut: 'Mod+Shift+;',
    run: () => {
      const s = getState().snapping;
      const on = !(s.objects || s.guides || s.nodes);
      setState({ snapping: { ...s, objects: on, guides: on, nodes: on } });
    },
  },
  // Help
  { id: 'help.help', title: 'Help', category: 'Help', shortcut: 'F1', run: () => navigate('help') },
  {
    id: 'help.shortcuts',
    title: 'Keyboard shortcuts',
    category: 'Help',
    shortcut: 'Mod+/',
    run: () => openDialog('shortcuts'),
  },
  { id: 'help.tour', title: 'Take the tour', category: 'Help', run: () => openDialog('tour') },
  {
    id: 'help.issue',
    title: 'Report an issue',
    category: 'Help',
    keywords: 'bug github',
    run: () => void window.open(ISSUES_URL, '_blank', 'noopener'),
  },
  {
    id: 'help.github',
    title: 'Source on GitHub',
    category: 'Help',
    run: () => void window.open(REPO_URL, '_blank', 'noopener'),
  },
  { id: 'help.about', title: 'About Curvesmith', category: 'Help', run: () => navigate('about') },
  ...toolCommands,
];

export const command = (id: string) => COMMANDS.find((c) => c.id === id)!;

export function isEnabled(c: Command) {
  if (c.doc && !hasDoc()) return false;
  return c.enabled ? c.enabled() : true;
}

export async function run(id: string) {
  const c = command(id);
  if (!c || !isEnabled(c)) return;
  if (getState().dialog === 'palette') closeDialog();
  await c.run();
}

// ---- Keyboard ----

function normalize(shortcut: string): string {
  const parts = shortcut.split('+');
  let key = parts.pop()!;
  if (key === '' && shortcut.endsWith('++')) key = '+';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return [
    mods.has('mod') ? 'mod' : '',
    mods.has('shift') ? 'shift' : '',
    mods.has('alt') ? 'alt' : '',
    key.toLowerCase(),
  ].join('|');
}

/** Key identity that survives Shift/Alt changing the produced character (Shift+] gives "}", Alt+8 gives "•"). */
function eventKey(e: KeyboardEvent): string {
  if (e.code?.startsWith('Digit')) return e.code.slice(5);
  if (e.code?.startsWith('Key') && (e.altKey || e.metaKey || e.ctrlKey)) return e.code.slice(3).toLowerCase();
  const byCode: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Minus: '-',
    Equal: '=',
  };
  if (e.code && byCode[e.code]) return byCode[e.code];
  return e.key.toLowerCase();
}

export function describeEvent(e: KeyboardEvent): string {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  return [mod ? 'mod' : '', e.shiftKey ? 'shift' : '', e.altKey ? 'alt' : '', eventKey(e)].join('|');
}

/** Find the command bound to a key event. */
export function commandForEvent(e: KeyboardEvent): Command | null {
  const pressed = describeEvent(e);
  for (const c of COMMANDS) {
    if (c.category === 'Tool') continue;
    for (const s of [c.shortcut, ...(c.alt ?? [])]) if (s && normalize(s) === pressed) return c;
  }
  return null;
}

export function requestClose(key: string) {
  const od = getState().docs.find((d) => d.key === key);
  if (!od) return;
  if (isDirty(od)) {
    setState({ closingKey: key });
    openDialog('closeConfirm');
  } else void import('./store').then((m) => m.closeDocument(key));
}

export const MENUS: { label: string; items: (string | '-')[] }[] = [
  {
    label: 'File',
    items: [
      'file.new',
      'file.open',
      '-',
      'file.save',
      'file.saveAs',
      '-',
      'file.place',
      '-',
      'file.export',
      'file.exportAgain',
      'file.print',
      '-',
      'file.close',
      'file.home',
    ],
  },
  {
    label: 'Edit',
    items: [
      'edit.undo',
      'edit.redo',
      '-',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.pasteInPlace',
      'edit.duplicate',
      'edit.delete',
      '-',
      'edit.selectAll',
      'edit.deselect',
      '-',
      'edit.palette',
      'edit.preferences',
    ],
  },
  {
    label: 'Object',
    items: [
      'object.group',
      'object.ungroup',
      'object.transformAgain',
      '-',
      'object.front',
      'object.forward',
      'object.backward',
      'object.back',
      '-',
      'object.union',
      'object.subtract',
      'object.intersect',
      'object.exclude',
      'object.divide',
      'object.expand',
      'object.release',
      '-',
      'object.compound',
      'object.releaseCompoundPath',
      'object.clip',
      'object.outlineStroke',
      'object.cropImage',
      'object.traceImage',
      'object.join',
      'object.simplify',
      'object.reverse',
      '-',
      'object.flipH',
      'object.flipV',
      'object.symbol',
      'object.lock',
    ],
  },
  { label: 'Type', items: ['tool.text', 'type.outlines'] },
  {
    label: 'View',
    items: [
      'view.zoomIn',
      'view.zoomOut',
      'view.fit',
      'view.actual',
      'view.fitSelection',
      'view.fitAll',
      '-',
      'view.rulers',
      'view.guides',
      'view.lockGuides',
      'view.addGuideV',
      'view.addGuideH',
      'view.clearGuides',
      '-',
      'view.grid',
      'view.snapGrid',
      'view.pixelGrid',
      'view.outline',
      'view.snap',
      '-',
      'view.history',
      'view.hidePanels',
      'view.hideUi',
      'view.theme',
    ],
  },
  {
    label: 'Help',
    items: ['help.help', 'help.shortcuts', 'help.tour', '-', 'help.issue', 'help.github', 'help.about'],
  },
];
