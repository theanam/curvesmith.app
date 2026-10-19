/* Builds the ToolApi from editor state. Shared by the canvas and the tool tests. */
import { toleranceScale } from '../state/input';
import type { CurvsDocument } from '../core/types';
import { getState, type OpenDoc } from '../state/store';
import type { Overlay, PixelSample, ToolApi } from './types';
import type { Vec } from '../core/types';
import { rgb } from '../core/color';
import { toScreen, toWorld } from '../render/viewport';
import { addRectCandidates, emptyCandidates, snapPoint, type SnapCandidates } from '../core/snapping';
import { childrenOf, locate, worldMatrix } from '../core/document';
import { nodeBounds } from '../core/geometry/node';
import { apply, multiply, translate } from '../core/matrix';
import { artboardAt } from '../render/hittest';

export const sharedOverlay = (): Overlay => ({
  guides: [],
  hud: null,
  marquee: null,
  draw: null,
  hoverId: null,
  cursor: null,
});

let cache: { doc: CurvsDocument | null; key: string; c: SnapCandidates } = {
  doc: null,
  key: '',
  c: emptyCandidates(),
};

/** Snap targets in world space: artboard edges/centers, guides, other objects' bounds, and (optionally) path nodes. */
export function snapCandidates(d: OpenDoc, exclude: string[], includeNodes: boolean): SnapCandidates {
  const key =
    exclude.join(',') +
    (includeNodes ? '|n' : '') +
    JSON.stringify(getState().snapping) +
    getState().ui.guides;
  if (cache.doc === d.doc && cache.key === key) return cache.c;
  const s = getState().snapping;
  const c = emptyCandidates();
  const ex = new Set(exclude);
  for (const ab of d.doc.artboards) {
    if (s.objects) addRectCandidates(c, { x: ab.x, y: ab.y, width: ab.width, height: ab.height }, 'artboard');
    if (s.guides && getState().ui.guides)
      for (const g of ab.guides) {
        if (g.axis === 'x') c.xs.push({ pos: ab.x + g.pos, kind: 'guide', span: [ab.y, ab.y + ab.height] });
        else c.ys.push({ pos: ab.y + g.pos, kind: 'guide', span: [ab.x, ab.x + ab.width] });
      }
    let roots = ab.children;
    let base = translate(ab.x, ab.y);
    if (d.isolation) {
      const loc = locate(d.doc, d.isolation);
      if (loc && loc.artboard.id === ab.id) {
        roots = childrenOf(loc.node);
        base = worldMatrix(loc);
      }
    }
    if (s.objects)
      for (const n of roots) {
        if (!n.visible || ex.has(n.id)) continue;
        const b = nodeBounds(n, d.doc, base);
        if (b) addRectCandidates(c, b, 'edge');
      }
    if (includeNodes && s.nodes) {
      let count = 0;
      const visit = (nodes: typeof ab.children, m: typeof base) => {
        for (const n of nodes) {
          if (count > 4000 || !n.visible || ex.has(n.id)) continue;
          const nm = multiply(m, n.transform);
          if (n.type === 'path')
            for (const sp of n.subpaths)
              for (const p of sp.nodes) {
                c.points.push(apply(nm, [p.x, p.y]));
                count++;
              }
          if (n.type === 'group') visit(n.children, nm);
        }
      };
      visit(ab.children, translate(ab.x, ab.y));
    }
  }
  cache = { doc: d.doc, key, c };
  return c;
}

/** Reads pixels from the document canvas that sits next to the overlay canvas. */
export function canvasSampler(overlayCanvas: HTMLCanvasElement) {
  return (screen: Vec, size = 1): PixelSample | null => {
    const doc = overlayCanvas.parentElement?.querySelector<HTMLCanvasElement>('canvas[data-layer="doc"]');
    const ctx = doc?.getContext('2d', { willReadFrequently: true });
    if (!doc || !ctx || !doc.clientWidth) return null;
    const dpr = doc.width / doc.clientWidth;
    const half = Math.floor(size / 2);
    const cx = Math.round(screen[0] * dpr);
    const cy = Math.round(screen[1] * dpr);
    try {
      const data = ctx.getImageData(cx - half, cy - half, size, size).data;
      const i = (half * size + half) * 4;
      return {
        color: rgb(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255),
        data,
        size,
      };
    } catch {
      // A tainted canvas (an image linked from another site) cannot be read.
      return null;
    }
  };
}

export function createToolApi(
  canvas: HTMLCanvasElement,
  overlay: Overlay,
  render: () => void,
  sample: ToolApi['sample'] = canvasSampler(canvas),
): ToolApi | null {
  const s = getState();
  const d = s.docs.find((x) => x.key === s.activeKey);
  if (!d || !d.view) return null;
  const view = d.view;
  return {
    od: d,
    doc: d.doc,
    view,
    toScreen: (p) => toScreen(view, p),
    toWorld: (p) => toWorld(view, p),
    px: (n) => (n * toleranceScale()) / view.zoom,
    overlay,
    render,
    snapCandidates: (exclude, includeNodes) => snapCandidates(d, exclude, !!includeNodes),
    snap: (p, exclude = []) => {
      const sn = getState().snapping;
      let q = p;
      let guides: ReturnType<typeof snapPoint>['guides'] = [];
      if (sn.objects || sn.guides || sn.nodes) {
        const r = snapPoint(p, snapCandidates(d, exclude, sn.nodes), 6 / view.zoom);
        q = r.point;
        guides = r.guides;
      }
      if (sn.pixel) q = [Math.round(q[0]), Math.round(q[1])];
      return { point: q, guides };
    },
    worldMatrixOf: (id) => {
      const loc = locate(d.doc, id);
      return loc ? worldMatrix(loc) : null;
    },
    artboardAt: (p) => artboardAt(d.doc, p)?.id ?? d.activeArtboard,
    canvas,
    sample,
  };
}
