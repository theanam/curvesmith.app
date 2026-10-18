/* PNG / JPG / WebP export through the canvas renderer. PNG files get a pHYs chunk with the DPI (72 × scale). */
import type { CurvsDocument, ExportScope } from '../../core/types';
import { canvasToBlob, renderToCanvas, scopeBounds } from '../../render/raster';
import { type ExportContext, warner } from '../types';
import type { RasterExportOptions } from '../registry';
import { blobToBytes, bytesBlob } from '../shared/bytes';
import { setPngDpi } from '../shared/png';

export type RasterKind = 'png' | 'jpg' | 'webp';
export const RASTER_MIME: Record<RasterKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export const RASTER_DEFAULTS: RasterExportOptions = {
  scale: 1,
  quality: 90,
  transparent: true,
  antialias: true,
};

/** Largest side the exporter will render (browsers cap canvas size). */
export const MAX_SIDE = 16384;

export type RasterPlan = {
  scale: number;
  width: number;
  height: number;
  transparent: boolean;
  quality: number;
  dpi: number;
};

/** Resolve options into output pixels. width/height override scale; the other side keeps the aspect ratio. */
export function planRaster(
  kind: RasterKind,
  area: { width: number; height: number },
  o: Partial<RasterExportOptions>,
): RasterPlan {
  const aw = Math.max(area.width, 1e-6);
  const ah = Math.max(area.height, 1e-6);
  let scale = o.scale && o.scale > 0 ? o.scale : 1;
  if (o.width && o.width > 0) scale = o.width / aw;
  else if (o.height && o.height > 0) scale = o.height / ah;
  const limit = MAX_SIDE / Math.max(aw, ah);
  if (scale > limit) scale = limit;
  const width = Math.max(1, Math.round(aw * scale));
  const height = Math.max(1, Math.round(ah * scale));
  const quality = Math.max(0, Math.min(100, o.quality ?? 90));
  return {
    scale,
    width,
    height,
    transparent: kind !== 'jpg' && (o.transparent ?? true),
    quality,
    dpi: Math.round(72 * scale * 100) / 100,
  };
}

export async function exportRaster(
  kind: RasterKind,
  doc: CurvsDocument,
  scope: ExportScope,
  o: Partial<RasterExportOptions>,
  ctx: ExportContext,
): Promise<Blob> {
  const warn = warner(ctx);
  if (scope.kind === 'all' && doc.artboards.length > 1)
    warn('Images hold one artboard. The active artboard was exported.');
  const area = scopeBounds(doc, scope, ctx.activeArtboard);
  const plan = planRaster(kind, area.rect, o);
  const canUseCanvas =
    typeof OffscreenCanvas !== 'undefined' ||
    (typeof document !== 'undefined' && !!document.createElement('canvas').getContext);
  if (!canUseCanvas) throw new Error('Image export needs a browser with canvas support.');
  // Matte white for JPG, or when the background is not transparent and the artboard has none.
  const canvas = renderToCanvas(doc, area, scope, {
    scale: plan.scale,
    transparent: plan.transparent,
    antialias: o.antialias ?? true,
    matte: '#ffffff',
  });
  const mime = RASTER_MIME[kind];
  const blob = await canvasToBlob(canvas, mime, kind === 'png' ? undefined : plan.quality / 100);
  if (kind === 'webp' && blob.type && blob.type !== 'image/webp')
    warn('This browser cannot write WebP, so the image was saved as PNG.');
  if (kind !== 'png' || (blob.type && blob.type !== 'image/png')) return blob;
  const bytes = await blobToBytes(blob);
  try {
    return bytesBlob(setPngDpi(bytes, plan.dpi), 'image/png');
  } catch {
    return blob;
  }
}
