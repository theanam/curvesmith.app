import type { CurvsDocument, ExportScope } from '../core/types';
import { drawArtboardContent, drawNode } from './paint';
import { type Rect, unionRect } from '../core/geometry/bezier';
import { locate, parentWorldMatrix } from '../core/document';
import { worldBounds } from '../core/geometry/node';

export type RasterOptions = {
  /** Output pixels per point. */
  scale: number;
  transparent: boolean;
  antialias: boolean;
  /** Fill color when not transparent and the artboard has no background. */
  matte?: string;
};

/** World-space area covered by an export scope (the first artboard for 'all'). */
export function scopeBounds(
  doc: CurvsDocument,
  scope: ExportScope,
  activeArtboard: string,
): { rect: Rect; artboardId: string | null } {
  if (scope.kind === 'selection') {
    let r: Rect | null = null;
    for (const id of scope.ids) {
      const loc = locate(doc, id);
      if (loc) r = unionRect(r, worldBounds(loc, doc));
    }
    if (r) return { rect: r, artboardId: null };
  }
  const id = scope.kind === 'artboard' ? scope.id : activeArtboard;
  const ab = doc.artboards.find((a) => a.id === id) ?? doc.artboards[0];
  return { rect: { x: ab.x, y: ab.y, width: ab.width, height: ab.height }, artboardId: ab.id };
}

export function renderToCanvas(
  doc: CurvsDocument,
  area: { rect: Rect; artboardId: string | null },
  scope: ExportScope,
  opts: RasterOptions,
): OffscreenCanvas | HTMLCanvasElement {
  const w = Math.max(1, Math.round(area.rect.width * opts.scale));
  const h = Math.max(1, Math.round(area.rect.height * opts.scale));
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = opts.antialias;
  ctx.imageSmoothingQuality = 'high';
  if (!opts.transparent) {
    ctx.fillStyle = opts.matte ?? '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.scale(opts.scale, opts.scale);
  ctx.translate(-area.rect.x, -area.rect.y);
  const renderOpts = { pixelScale: opts.scale };
  if (scope.kind === 'selection' && !area.artboardId) {
    for (const id of scope.ids) {
      const loc = locate(doc, id);
      if (!loc) continue;
      ctx.save();
      const m = parentWorldMatrix(loc);
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      drawNode(ctx, loc.node, doc, renderOpts);
      ctx.restore();
    }
  } else if (area.artboardId) {
    drawArtboardContent(ctx, doc, area.artboardId, renderOpts, !opts.transparent);
  }
  return canvas;
}

export async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      type,
      quality,
    ),
  );
}

/** Thumbnail PNG of the first artboard (512 px max side) for .curvs files and recent-file grids. */
export async function renderThumbnail(doc: CurvsDocument, maxSide = 512): Promise<Blob | null> {
  const ab = doc.artboards[0];
  if (!ab || typeof document === 'undefined') return null;
  const scale = maxSide / Math.max(ab.width, ab.height);
  try {
    const c = renderToCanvas(
      doc,
      { rect: { x: ab.x, y: ab.y, width: ab.width, height: ab.height }, artboardId: ab.id },
      { kind: 'artboard', id: ab.id },
      { scale, transparent: !ab.background, antialias: true },
    );
    return await canvasToBlob(c, 'image/png');
  } catch {
    return null;
  }
}
