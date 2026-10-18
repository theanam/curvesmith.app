import type { Vec } from '../core/types';
import type { Rect } from '../core/geometry/bezier';
import type { ViewState } from '../state/store';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;
export const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4, 8];

export const toScreen = (v: ViewState, p: Vec): Vec => [p[0] * v.zoom + v.panX, p[1] * v.zoom + v.panY];
export const toWorld = (v: ViewState, p: Vec): Vec => [(p[0] - v.panX) / v.zoom, (p[1] - v.panY) / v.zoom];

export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Zoom keeping the screen point `at` fixed. */
export function zoomAt(v: ViewState, zoom: number, at: Vec): ViewState {
  const z = clampZoom(zoom);
  const w = toWorld(v, at);
  return { zoom: z, panX: at[0] - w[0] * z, panY: at[1] - w[1] * z };
}

/** View that fits a world rect into a screen of size w×h with padding. */
export function fitRect(r: Rect, w: number, h: number, padding = 48): ViewState {
  const zw = (w - padding * 2) / Math.max(r.width, 1);
  const zh = (h - padding * 2) / Math.max(r.height, 1);
  const zoom = clampZoom(Math.min(zw, zh));
  return { zoom, panX: w / 2 - (r.x + r.width / 2) * zoom, panY: h / 2 - (r.y + r.height / 2) * zoom };
}

/** Next step in a 2^(n/2) zoom ladder. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const steps = Math.log2(z) * 2;
  const next = dir > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
  return clampZoom(Math.pow(2, next / 2));
}

/** Tick spacing for rulers: a 1-2-5 sequence in world units giving ≥ `minPx` between labels. */
export function rulerStep(zoom: number, unitPt: number, minPx = 50): number {
  const target = minPx / zoom / unitPt;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow * unitPt;
  return 10 * pow * unitPt;
}
