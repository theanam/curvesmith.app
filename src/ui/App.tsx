import { markTouch } from '../state/input';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import {
  getState,
  setState,
  setUi,
  useEditor,
  closeDialog,
  setIsolation,
  select,
  setTool,
} from '../state/store';
import { commandForEvent, isEnabled, run } from '../state/commands';
import { toolForKey } from '../tools/ids';
import { activeToolImpl } from '../tools';
import { TopBar } from './shell/TopBar';
import { ContextBar } from './shell/ContextBar';
import { Toolbar, resetColors, swapColors, swapFocus } from './shell/Toolbar';
import { StatusBar } from './shell/StatusBar';
import { CanvasView, currentToolApi, requestCanvasRender } from './canvas/CanvasView';
import { Inspector } from './inspector/Inspector';
import { Home } from './home/Home';
import { ErrorBoundary } from './ErrorBoundary';
import { SelectionMenu } from './controls/SelectionMenu';
import { TipProvider } from './controls/Tooltip';
import { Palette } from './dialogs/Palette';
import { NewDocumentDialog } from './dialogs/NewDocument';
import { CloseConfirmDialog, ImportReportDialog, PreferencesDialog, ShortcutsDialog } from './dialogs/Misc';
import { openFile } from '../state/files';
import { nudge } from '../state/actions';
import { nudgeNodes } from '../tools/node';
import { Icon } from './icons';

const TraceDialog = lazy(() => import('./trace/TraceDialog').then((m) => ({ default: m.TraceDialog })));
const ExportDialog = lazy(() => import('./dialogs/ExportDialog').then((m) => ({ default: m.ExportDialog })));
const Tour = lazy(() => import('./tour/Tour').then((m) => ({ default: m.Tour })));
const HelpPage = lazy(() => import('./pages/Pages').then((m) => ({ default: m.HelpPage })));
const AboutPage = lazy(() => import('./pages/Pages').then((m) => ({ default: m.AboutPage })));

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function useWide(min: number) {
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= min));
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return wide;
}

/** The user's fonts: the uploaded library and installed fonts at start-up, and fonts that open documents embed. */
function useUserFonts() {
  const docs = useEditor((st) => st.docs);
  useEffect(() => {
    void import('../fonts/user').then((m) => m.initUserFonts());
  }, []);
  useEffect(() => {
    if (docs.some((d) => d.doc.fonts.some((f) => f.file)))
      void import('../fonts/user').then((m) => docs.forEach((d) => void m.registerDocumentFonts(d.doc)));
  }, [docs]);
}

/** Touch screens: show the touch keys once a finger or pen is used, and keep page zoom off the app chrome. */
function useTouch() {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') markTouch();
    };
    // iOS Safari pinch-zooms the whole page unless its gesture events are cancelled.
    const gesture = (e: Event) => e.preventDefault();
    window.addEventListener('pointerdown', down, true);
    document.addEventListener('gesturestart', gesture);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      document.removeEventListener('gesturestart', gesture);
    };
  }, []);
}

/** Keyboard routing: text fields first, then the active tool, then app shortcuts, then single-key tools. */
function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = getState();
      const typing = isTyping(e.target);
      const cmd = commandForEvent(e);
      // App-level saves and search work everywhere, even in fields.
      if (typing) {
        if (cmd && ['file.save', 'file.saveAs', 'edit.palette'].includes(cmd.id)) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
          void run(cmd.id);
        }
        return;
      }
      if (s.dialog) return; // Radix handles keys inside dialogs.
      // Open popovers and menus own the keyboard (Escape closes them and must not also deselect).
      const t = e.target as Element | null;
      if (
        t?.closest?.('[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [role="dialog"]')
      )
        return;
      if (
        document.querySelector(
          '[data-radix-popper-content-wrapper] [data-state="open"], [role="menu"][data-state="open"]',
        )
      )
        return;
      const inEditor = s.route === 'editor' && !!s.activeKey;
      if (inEditor) {
        const api = currentToolApi();
        const tool = activeToolImpl(s);
        if (api && tool.key?.(e, api)) {
          e.preventDefault();
          requestCanvasRender();
          return;
        }
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
        if (e.key === ' ' && plain && !e.repeat) {
          if (!s.springTool && s.tool !== 'hand') setState({ springTool: 'hand' });
          e.preventDefault();
          return;
        }
        if (e.key === 'Escape') {
          // The active tool already had its chance above (finishing a path, cancelling a drag).
          // An idle tool hands back to Move; on Move, Escape clears the selection, then leaves isolation.
          if (api) tool.cancel?.(api);
          const od = s.docs.find((d) => d.key === s.activeKey);
          if (s.ui.hideAll) setUi({ hideAll: false });
          else if (s.tool !== 'move') setTool('move');
          else if (od?.selection.length) select([]);
          else if (od?.isolation) setIsolation(null);
          requestCanvasRender();
          return;
        }
        if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          if (!(s.tool === 'node' && nudgeNodes(dx, dy))) nudge(dx, dy);
          e.preventDefault();
          return;
        }
        if (plain && e.key.toLowerCase() === 'x') {
          swapFocus();
          return;
        }
        if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'x') {
          swapColors();
          return;
        }
        if (plain && e.key.toLowerCase() === 'd') {
          resetColors();
          return;
        }
      }
      if (cmd) {
        e.preventDefault();
        if (isEnabled(cmd)) void run(cmd.id);
        return;
      }
      if (inEditor && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = toolForKey(e);
        if (t) {
          setState({ tool: t, springTool: null, editingText: null, croppingImage: null });
          e.preventDefault();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      const s = getState();
      if (s.route === 'editor') {
        const api = currentToolApi();
        const tool = activeToolImpl(s);
        if (api && tool.keyUp?.(e, api)) return;
      }
      if (e.key === ' ' && s.springTool) setState({ springTool: null });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}

/** Dropping files anywhere opens them; the canvas handles its own drops (placing into the document). */
function useGlobalDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      [...e.dataTransfer.files].forEach((f) => void openFile(f));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    // Installed PWA: files opened from the OS arrive through the launch queue.
    const lq = (
      window as unknown as {
        launchQueue?: { setConsumer(fn: (p: { files: FileSystemFileHandle[] }) => void): void };
      }
    ).launchQueue;
    lq?.setConsumer(async (params) => {
      for (const h of params.files ?? []) await openFile(await h.getFile(), h);
    });
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

function Editor() {
  const ui = useEditor((s) => s.ui);
  const key = useEditor((s) => s.activeKey);
  const wide = useWide(1100);
  const showPanels = !ui.hideAll && !ui.hidePanels;
  return (
    <div className="editor">
      <div className="viewonly-banner" role="note">
        <Icon name="system" /> Best on a larger screen. View, zoom and export here.
      </div>
      {!ui.hideAll && (
        <ErrorBoundary region="top bar">
          <TopBar />
        </ErrorBoundary>
      )}
      {!ui.hideAll && (
        <ErrorBoundary region="tool options bar">
          <ContextBar />
        </ErrorBoundary>
      )}
      <div className="workspace">
        {!ui.hideAll && (
          <ErrorBoundary region="toolbar">
            <Toolbar />
          </ErrorBoundary>
        )}
        <ErrorBoundary region="canvas" resetKey={key}>
          <CanvasView />
        </ErrorBoundary>
        {showPanels && wide && <Inspector />}
        {showPanels && !wide && (
          <>
            {!ui.drawer && (
              <button
                className="icon-btn drawer-toggle"
                aria-label="Show inspector"
                onClick={() => setUi({ drawer: true })}
              >
                <Icon name="layers" />
              </button>
            )}
            {ui.drawer && <Inspector drawer />}
          </>
        )}
      </div>
      {!ui.hideAll && (
        <ErrorBoundary region="status bar">
          <StatusBar />
        </ErrorBoundary>
      )}
      <ErrorBoundary region="object menu">
        <SelectionMenu />
      </ErrorBoundary>
    </div>
  );
}

export function App() {
  const route = useEditor((s) => s.route);
  const hasDoc = useEditor((s) => s.docs.length > 0);
  const dialog = useEditor((s) => s.dialog);
  const theme = useEditor((s) => s.theme);
  useKeyboard();
  useTouch();
  useUserFonts();
  useGlobalDrop();
  const view =
    route === 'editor' && hasDoc
      ? 'editor'
      : route === 'help'
        ? 'help'
        : route === 'about'
          ? 'about'
          : 'home';
  return (
    <TipProvider>
      <ErrorBoundary region="app" full>
        {view === 'editor' && <Editor />}
        {view === 'home' && (
          <ErrorBoundary region="start screen">
            <Home />
          </ErrorBoundary>
        )}
        <Suspense fallback={null}>
          {view === 'help' && (
            <ErrorBoundary region="help page">
              <HelpPage />
            </ErrorBoundary>
          )}
          {view === 'about' && (
            <ErrorBoundary region="about page">
              <AboutPage />
            </ErrorBoundary>
          )}
        </Suspense>
        <ErrorBoundary region="dialog" resetKey={dialog}>
          <Palette />
          <NewDocumentDialog />
          <PreferencesDialog />
          <ShortcutsDialog />
          <ImportReportDialog />
          <CloseConfirmDialog />
          <Suspense fallback={null}>
            {dialog === 'export' && <ExportDialog />}
            {dialog === 'trace' && <TraceDialog />}
            {dialog === 'tour' && <Tour onClose={closeDialog} />}
          </Suspense>
        </ErrorBoundary>
      </ErrorBoundary>
      <Toaster
        position="bottom-center"
        theme={theme === 'system' ? 'system' : theme}
        toastOptions={{ className: 'cs-toast' }}
        richColors={false}
        closeButton={false}
      />
    </TipProvider>
  );
}
