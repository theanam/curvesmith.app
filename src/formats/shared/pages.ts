/* Export scopes resolved into pages: what to draw, in which coordinate frame. */
import type { Artboard, Color, CurvsDocument, ExportScope, Matrix, SceneNode } from '../../core/types';
import { locate, parentWorldMatrix } from '../../core/document';
import { multiply, translate } from '../../core/matrix';
import { type Rect, unionRect } from '../../core/geometry/bezier';
import { strokePadding, worldBounds } from '../../core/geometry/node';
import type { ExportContext } from '../types';

export type PageRoot = {
  node: SceneNode;
  /** Parent space of the node → page space (page origin top-left, y down, points). */
  m: Matrix;
  /** Layer name: the top-level group's name, else the artboard's name. */
  layer: string;
};

export type Page = {
  name: string;
  width: number;
  height: number;
  /** World position of the page's top-left corner. */
  x: number;
  y: number;
  /** Artboard backgrounds, in page space. */
  backgrounds: { rect: Rect; color: Color }[];
  roots: PageRoot[];
  artboards: Artboard[];
};

const layerOf = (n: SceneNode, ab: Artboard) => (n.type === 'group' ? n.name : ab.name);

function artboardPage(ab: Artboard): Page {
  return {
    name: ab.name,
    width: ab.width,
    height: ab.height,
    x: ab.x,
    y: ab.y,
    backgrounds: ab.background
      ? [{ rect: { x: 0, y: 0, width: ab.width, height: ab.height }, color: ab.background }]
      : [],
    roots: ab.children.map((node) => ({ node, m: [1, 0, 0, 1, 0, 0], layer: layerOf(node, ab) })),
    artboards: [ab],
  };
}

/** All artboards on one page, at their world positions (union bounds). */
function combinedPage(doc: CurvsDocument, name: string): Page {
  let r: Rect | null = null;
  for (const ab of doc.artboards) r = unionRect(r, { x: ab.x, y: ab.y, width: ab.width, height: ab.height });
  const rect = r ?? { x: 0, y: 0, width: 1, height: 1 };
  const page: Page = {
    name,
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y,
    backgrounds: [],
    roots: [],
    artboards: doc.artboards,
  };
  for (const ab of doc.artboards) {
    const ox = ab.x - rect.x;
    const oy = ab.y - rect.y;
    if (ab.background)
      page.backgrounds.push({
        rect: { x: ox, y: oy, width: ab.width, height: ab.height },
        color: ab.background,
      });
    for (const node of ab.children) page.roots.push({ node, m: translate(ox, oy), layer: layerOf(node, ab) });
  }
  return page;
}

/**
 * Resolve an export scope into pages.
 * - selection: one page with the tight bounds of the selection (padded by stroke widths), no background;
 * - artboard: one page per the artboard;
 * - all: one page per artboard when `multiPage`, else one page covering all artboards side by side.
 */
export function pagesForScope(
  doc: CurvsDocument,
  scope: ExportScope,
  ctx: Pick<ExportContext, 'activeArtboard' | 'name'>,
  multiPage: boolean,
): Page[] {
  if (scope.kind === 'selection') {
    let r: Rect | null = null;
    const locs = scope.ids.map((id) => locate(doc, id)).filter((l) => l !== null);
    for (const loc of locs) {
      const b = worldBounds(loc, doc);
      const pad = strokePadding(loc.node);
      if (b)
        r = unionRect(r, {
          x: b.x - pad,
          y: b.y - pad,
          width: b.width + pad * 2,
          height: b.height + pad * 2,
        });
    }
    if (r && locs.length) {
      const toPage = translate(-r.x, -r.y);
      return [
        {
          name: ctx.name,
          width: Math.max(r.width, 1),
          height: Math.max(r.height, 1),
          x: r.x,
          y: r.y,
          backgrounds: [],
          roots: locs.map((loc) => ({
            node: loc.node,
            m: multiply(toPage, parentWorldMatrix(loc)),
            layer: loc.node.name,
          })),
          artboards: [...new Set(locs.map((l) => l.artboard))],
        },
      ];
    }
  }
  if (scope.kind === 'all') {
    if (multiPage) return doc.artboards.map(artboardPage);
    if (doc.artboards.length === 1) return [artboardPage(doc.artboards[0])];
    return [combinedPage(doc, ctx.name)];
  }
  const id = scope.kind === 'artboard' ? scope.id : ctx.activeArtboard;
  const ab = doc.artboards.find((a) => a.id === id) ?? doc.artboards[0];
  return ab ? [artboardPage(ab)] : [];
}
