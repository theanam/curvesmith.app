import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './ui/App';
import { installPrefs } from './state/prefs';
import { installRouter } from './ui/router';
import { restoreSession, startAutosave } from './state/files';
import { installCanvasMeasurer } from './fonts/outline';
import { loadPathKit } from './core/booleans';
import { getState, setState } from './state/store';
import { lsGet } from './state/storage';

installPrefs();
if (import.meta.env.DEV || navigator.webdriver)
  void import('./automation').then((m) => m.installAutomation());
installRouter();
installCanvasMeasurer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

document.getElementById('boot')?.remove();

void restoreSession().finally(() => {
  startAutosave();
  // First visit: the tour (shown once, remembered in this browser).
  if (
    !lsGet<string | null>('curvesmith.tour', null) &&
    getState().route !== 'help' &&
    getState().route !== 'about'
  ) {
    setState({ dialog: 'tour' });
  }
});

// Booleans load after the shell paints so the start screen stays instant.
const idle =
  (window as unknown as { requestIdleCallback?: (fn: () => void) => void }).requestIdleCallback ??
  ((fn: () => void) => setTimeout(fn, 1500));
idle(() => void loadPathKit().catch(() => undefined));

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
