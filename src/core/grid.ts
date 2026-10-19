/* The document grid: evenly spaced major lines with optional subdivisions, measured from each artboard's
   top-left corner. Settings live in the document; whether it shows is a view setting. */
import type { Artboard, CurvsDocument, GridSettings, Unit } from './types';
import { toPt } from './units';

/** A comfortable default per unit: graph paper for print units, an 8-point rhythm for screen units. */
export function defaultGrid(units: Unit): GridSettings {
  switch (units) {
    case 'mm':
    case 'cm':
      return { spacing: toPt(10, 'mm'), subdivisions: 5, style: 'lines' };
    case 'in':
      return { spacing: toPt(1, 'in'), subdivisions: 8, style: 'lines' };
    default:
      return { spacing: 64, subdivisions: 8, style: 'lines' };
  }
}

export const gridOf = (doc: Pick<CurvsDocument, 'grid' | 'units'>): GridSettings =>
  doc.grid ?? defaultGrid(doc.units);

/** Distance between the finest lines (a subdivision). */
export const gridStep = (g: GridSettings) => g.spacing / Math.max(1, Math.round(g.subdivisions));

/** Positions from 0 to `length` every `step` (inclusive), or none when there would be more than `max`. */
export function gridPositions(length: number, step: number, max = 4000): number[] {
  if (!(step > 0) || length / step > max) return [];
  const out: number[] = [];
  for (let i = 0; i * step <= length + 1e-6; i++) out.push(i * step);
  return out;
}

/** Grid lines of an artboard in world space, at the finest spacing that stays under the line budget. */
export function gridLines(ab: Pick<Artboard, 'x' | 'y' | 'width' | 'height'>, g: GridSettings) {
  let step = gridStep(g);
  if (Math.max(ab.width, ab.height) / step > 4000) step = g.spacing;
  return {
    xs: gridPositions(ab.width, step).map((v) => ab.x + v),
    ys: gridPositions(ab.height, step).map((v) => ab.y + v),
  };
}
