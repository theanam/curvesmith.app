import { getState, setState, useEditor, DEFAULT_UI, type EditorState } from './store';
import { lsGet, lsSet } from './storage';

const KEY = 'curvesmith.prefs.v1';

type Prefs = Pick<EditorState, 'theme' | 'snapping' | 'defaults'> & { ui: Partial<EditorState['ui']> };

/** UI fields worth remembering per user (layout, view toggles, tool options). */
const UI_KEYS: (keyof EditorState['ui'])[] = [
  'inspectorTab',
  'layersHeight',
  'rulers',
  'guides',
  'lockGuides',
  'grid',
  'showGrid',
  'showAllHandles',
  'pencilSmoothing',
  'penMode',
  'starPoints',
  'starPolygon',
  'shapeKind',
  'shapeParams',
];

export function loadPrefs() {
  const p = lsGet<Partial<Prefs> | null>(KEY, null);
  if (!p) return;
  const s = getState();
  setState({
    theme: p.theme ?? s.theme,
    snapping: { ...s.snapping, ...p.snapping },
    defaults: { ...s.defaults, ...p.defaults },
    ui: { ...DEFAULT_UI, ...pick(p.ui ?? {}) },
  });
}

function pick(ui: Partial<EditorState['ui']>) {
  const out: Partial<EditorState['ui']> = {};
  for (const k of UI_KEYS) if (k in ui) (out as Record<string, unknown>)[k] = ui[k];
  return out;
}

export function applyTheme(theme: EditorState['theme']) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document
    .querySelector('meta[name="theme-color"]:not([media])')
    ?.setAttribute('content', dark ? '#141317' : '#F7F6F3');
}

export function installPrefs() {
  loadPrefs();
  applyTheme(getState().theme);
  let last = '';
  useEditor.subscribe((s) => {
    const prefs: Prefs = { theme: s.theme, snapping: s.snapping, defaults: s.defaults, ui: pick(s.ui) };
    const json = JSON.stringify(prefs);
    if (json === last) return;
    const themeChanged = !last || JSON.parse(last).theme !== s.theme;
    last = json;
    lsSet(KEY, prefs);
    if (themeChanged) applyTheme(s.theme);
  });
}

export const isDarkTheme = () => {
  const t = getState().theme;
  return t === 'dark' || (t === 'system' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
};
