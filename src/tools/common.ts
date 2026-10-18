import type { Appearance, Matrix, Unit, Vec } from '../core/types';
import { fromPt, formatNumber } from '../core/units';
import { locate, makeFill, makeStroke, worldMatrix } from '../core/document';
import { nodeSubpaths } from '../core/geometry/node';
import { drawOutline } from '../render/overlay';
import { getState } from '../state/store';
import type { ToolApi } from './types';

export const fmt = (pt: number, unit: Unit, d = 1) => formatNumber(fromPt(pt, unit), d);

export function hudXY(p: Vec, unit: Unit) {
  return `X ${fmt(p[0], unit)}  Y ${fmt(p[1], unit)}`;
}

/** Point relative to the artboard that contains it (what users read as coordinates). */
export function artboardRelative(api: ToolApi, p: Vec): Vec {
  const ab = api.doc.artboards.find((a) => a.id === api.artboardAt(p)) ?? api.doc.artboards[0];
  return ab ? [p[0] - ab.x, p[1] - ab.y] : p;
}

export function drawSelectionOutlines(
  ctx: CanvasRenderingContext2D,
  api: ToolApi,
  ids = api.od.selection,
  width?: number,
) {
  for (const id of ids) {
    const loc = locate(api.doc, id);
    if (!loc) continue;
    const n = loc.node;
    drawOutline(ctx, nodeSubpaths(n, api.doc), worldMatrix(loc), api.view, width);
  }
}

export function drawHover(ctx: CanvasRenderingContext2D, api: ToolApi) {
  const id = api.overlay.hoverId;
  if (!id || api.od.selection.includes(id)) return;
  drawSelectionOutlines(ctx, api, [id], 1);
}

/** Appearance for newly drawn shapes from the toolbar fill/stroke swatches. */
export function newShapeAppearance(openPath = false): Appearance {
  const d = getState().defaults;
  const items: Appearance['items'] = [];
  if (d.fill && !openPath) items.push(makeFill(d.fill));
  if (d.stroke) items.push(makeStroke(d.stroke, d.strokeWidth));
  if (!items.length) items.push(makeStroke(undefined, 1));
  return { items };
}

export const isRotated = (m: Matrix) => Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9;

export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 12-5l2 2M19 4v5h-5" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12a7 7 0 0 1 12-5l2 2M19 4v5h-5" fill="none" stroke="#1A1820" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}") 12 12, crosshair`;

export const PEN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21l4-11 7-7 7 7-7 7zM3 21l7-7" fill="white" stroke="#1A1820" stroke-width="1.4" stroke-linejoin="round"/></svg>',
)}") 2 22, crosshair`;

export const resizeCursor = (id: string, rotation: number) => {
  const base: Record<string, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const a = (((base[id] + (rotation * 180) / Math.PI) % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nesw-resize';
};
