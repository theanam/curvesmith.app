/* Guides: straight lines across an artboard, positioned from its top-left corner (in points). */
import type { Draft } from 'immer';
import type { Artboard, CurvsDocument, Vec } from '../core/types';
import { activeDoc, getState, mutate, setUi, type OpenDoc } from './store';

export type GuideRef = { artboard: string; index: number };

const round = (v: number) => Math.round(v * 100) / 100;

function activeArtboard(d: Draft<CurvsDocument> | CurvsDocument, id: string | undefined) {
  return d.artboards.find((a) => a.id === id) ?? d.artboards[0];
}

/** Add a guide to the active artboard; without a position it goes through the artboard's middle. */
export function addGuide(axis: 'x' | 'y', pos?: number) {
  const od = activeDoc();
  if (!od) return;
  if (!getState().ui.guides) setUi({ guides: true });
  mutate(axis === 'x' ? 'Add vertical guide' : 'Add horizontal guide', (d) => {
    const ab = activeArtboard(d, od.activeArtboard) as Draft<Artboard>;
    if (!ab) return;
    ab.guides.push({ axis, pos: round(pos ?? (axis === 'x' ? ab.width : ab.height) / 2) });
  });
}

export function setGuidePos(ref: GuideRef, pos: number) {
  mutate(
    'Move guide',
    (d) => {
      const g = d.artboards.find((a) => a.id === ref.artboard)?.guides[ref.index];
      if (g) g.pos = round(pos);
    },
    undefined,
    { coalesce: 700 },
  );
}

export function removeGuide(ref: GuideRef) {
  mutate('Delete guide', (d) => {
    d.artboards.find((a) => a.id === ref.artboard)?.guides.splice(ref.index, 1);
  });
}

export function clearGuides(all = false) {
  const od = activeDoc();
  if (!od) return;
  mutate('Clear guides', (d) => {
    for (const ab of d.artboards) if (all || ab.id === od.activeArtboard) ab.guides = [];
  });
}

export const guideCount = (od: OpenDoc | null) =>
  od
    ? ((od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0])?.guides.length ?? 0)
    : 0;

/** The guide nearest to a world point, within `tol` (world units). Guides run across the whole canvas. */
export function guideAt(
  doc: CurvsDocument,
  world: Vec,
  tol: number,
): (GuideRef & { axis: 'x' | 'y' }) | null {
  let best: (GuideRef & { axis: 'x' | 'y' }) | null = null;
  let bestD = tol;
  for (const ab of doc.artboards)
    ab.guides.forEach((g, index) => {
      const d = g.axis === 'x' ? Math.abs(world[0] - (ab.x + g.pos)) : Math.abs(world[1] - (ab.y + g.pos));
      if (d <= bestD) {
        bestD = d;
        best = { artboard: ab.id, index, axis: g.axis };
      }
    });
  return best;
}
