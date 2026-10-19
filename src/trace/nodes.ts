/* From a trace result to document nodes, and from an image node to pixels worth tracing. */
import { rgb, colorToHex } from '../core/color';
import { makeFill, makeGroup, makePath } from '../core/document';
import type { GroupNode, ImageNode } from '../core/types';
import type { Pixels, TraceResult } from './types';

/** Pixel budget for tracing; larger images are scaled down first. */
export const TRACE_MAX_PIXELS = 2_000_000;

/** Working size for an image of w×h under the pixel budget. */
export function traceSize(w: number, h: number, maxPixels = TRACE_MAX_PIXELS) {
  const s = Math.min(1, Math.sqrt(maxPixels / Math.max(1, w * h)));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * A group of filled paths sized to `target` (the image's box), one path per color, bottom layer first.
 * The group takes the target's transform, so it lands exactly over the image.
 */
export function traceToGroup(
  result: TraceResult,
  target: Pick<ImageNode, 'width' | 'height' | 'transform' | 'name'>,
): GroupNode {
  const sx = target.width / result.width;
  const sy = target.height / result.height;
  const tx = (x: number) => round(x * sx);
  const ty = (y: number) => round(y * sy);
  const paths = result.layers.map((layer) => {
    const color = rgb(layer.color.r, layer.color.g, layer.color.b);
    const path = makePath(
      layer.subpaths.map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.map((n) => ({
          x: tx(n.x),
          y: ty(n.y),
          in: n.in && [tx(n.in[0]), ty(n.in[1])],
          out: n.out && [tx(n.out[0]), ty(n.out[1])],
          kind: n.kind,
        })),
      })),
      { items: [makeFill(color)] },
      `#${colorToHex(color)}`,
    );
    path.fillRule = 'evenodd';
    return path;
  });
  const group = makeGroup(paths, `${target.name} (traced)`);
  group.transform = [...target.transform];
  return group;
}

/** Decode an image source (data URL) into pixels at the working size, honoring an image node's crop. */
export async function imagePixels(
  src: string,
  crop?: ImageNode['crop'],
  maxPixels = TRACE_MAX_PIXELS,
): Promise<Pixels> {
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const c = crop ?? { x: 0, y: 0, width: bmp.width, height: bmp.height };
    const { width, height } = traceSize(c.width, c.height, maxPixels);
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('This browser cannot read image pixels.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, c.x, c.y, c.width, c.height, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bmp.close();
  }
}

/** True when any pixel is less than fully opaque. */
export function hasTransparency(px: Pixels): boolean {
  for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 250) return true;
  return false;
}

/** Copy of `px` with `mask` (0–255 per pixel) multiplied into its alpha. */
export function applyMask(px: Pixels, mask: Uint8ClampedArray): Pixels {
  const data = px.data.slice();
  for (let i = 0; i < mask.length; i++) data[i * 4 + 3] = (data[i * 4 + 3] * mask[i]) / 255;
  return { width: px.width, height: px.height, data };
}

/** Scale pixels down (never up) to fit the pixel budget. */
export function fitPixels(px: Pixels, maxPixels = TRACE_MAX_PIXELS): Pixels {
  const { width, height } = traceSize(px.width, px.height, maxPixels);
  if (width === px.width && height === px.height) return px;
  const src = new OffscreenCanvas(px.width, px.height);
  src
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  const dst = new OffscreenCanvas(width, height);
  const ctx = dst.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
