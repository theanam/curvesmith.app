import { getState, setState, type Route } from '../state/store';

/** Path-based routes for the static pages; the editor and start screen live at "/". */
export function routeFromPath(path: string): Route | null {
  const p = path.replace(/\/+$/, '');
  if (p === '/help') return 'help';
  if (p === '/about') return 'about';
  return null;
}

let lastAppRoute: Route = 'home';

export function navigate(route: Route) {
  const cur = getState().route;
  if (cur === 'home' || cur === 'editor') lastAppRoute = cur;
  const path = route === 'help' ? '/help' : route === 'about' ? '/about' : '/';
  if (location.pathname !== path) history.pushState({ route }, '', path);
  setState({
    route: route === 'home' && getState().docs.length && lastAppRoute === 'editor' ? 'editor' : route,
  });
  window.scrollTo?.(0, 0);
}

/** Leave a static page and return to where the user was. */
export function back() {
  navigate(getState().docs.length && lastAppRoute === 'editor' ? 'editor' : 'home');
}

export function installRouter() {
  const initial = routeFromPath(location.pathname);
  if (initial) setState({ route: initial });
  window.addEventListener('popstate', () => {
    const r = routeFromPath(location.pathname);
    setState({ route: r ?? (getState().docs.length ? lastAppRoute : 'home') });
  });
}
