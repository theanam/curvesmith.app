import type { AppearanceItem, ImageNode, Subpath } from './types';
import { rectSubpaths, uniformCorners } from './geometry/shapes';

/**
 * An image is a rectangle with an appearance stack. Drop shadows and fills paint below the bitmap
 * (fills show through transparent pixels); strokes and inner shadows paint on top of it.
 */
export function imageLayers(n: Pick<ImageNode, 'appearance'>): {
  below: AppearanceItem[];
  above: AppearanceItem[];
} {
  const below = n.appearance.items.filter(
    (i) => i.kind === 'fill' || (i.kind === 'effect' && i.effect.type === 'dropShadow'),
  );
  const above = n.appearance.items.filter(
    (i) => i.kind === 'stroke' || (i.kind === 'effect' && i.effect.type !== 'dropShadow'),
  );
  return { below, above };
}

export const imageRect = (n: Pick<ImageNode, 'width' | 'height'>): Subpath[] =>
  rectSubpaths({ width: n.width, height: n.height, corners: uniformCorners(0) });

type Box = { x: number; y: number; width: number; height: number };
export type ImageSize = { width: number; height: number };

/**
 * The whole bitmap in the image's local space, where the visible part fills (0,0)–(width,height).
 * Cropping moves the visible frame over this rectangle; the bitmap's scale never changes.
 */
export function bitmapRect(n: Pick<ImageNode, 'width' | 'height' | 'crop'>, natural: ImageSize): Box {
  const c = n.crop ?? { x: 0, y: 0, ...natural };
  const sx = n.width / c.width;
  const sy = n.height / c.height;
  return { x: -c.x * sx, y: -c.y * sy, width: natural.width * sx, height: natural.height * sy };
}

/**
 * Show `frame` of a bitmap drawn at `bitmap` (both in the image's current local space). Returns the
 * new size and crop, plus the local offset of the new frame's origin (to fold into the transform).
 * A frame that shows the whole bitmap drops the crop.
 */
export function reframe(
  frame: Box,
  bitmap: Box,
  natural: ImageSize,
): { offset: [number, number]; width: number; height: number; crop: ImageNode['crop'] } {
  const sx = bitmap.width / natural.width;
  const sy = bitmap.height / natural.height;
  const crop = {
    x: (frame.x - bitmap.x) / sx,
    y: (frame.y - bitmap.y) / sy,
    width: frame.width / sx,
    height: frame.height / sy,
  };
  const eps = 1e-6 * Math.max(natural.width, natural.height);
  const whole =
    Math.abs(crop.x) < eps &&
    Math.abs(crop.y) < eps &&
    Math.abs(crop.width - natural.width) < eps &&
    Math.abs(crop.height - natural.height) < eps;
  return {
    offset: [frame.x, frame.y],
    width: frame.width,
    height: frame.height,
    crop: whole ? undefined : crop,
  };
}

/**
 * Drag a frame handle (`u` is its position on the unit box: 0, 0.5 or 1 on each axis) to `p`. Only the
 * dragged edges move; they stay inside the bitmap and at least `min` from the opposite edge. With
 * `keepAspect`, corner drags keep the frame's proportions.
 */
export function resizeFrame(
  start: Box,
  bitmap: Box,
  u: [number, number],
  p: [number, number],
  min: number,
  keepAspect = false,
): Box {
  let [l, t, r, b] = [start.x, start.y, start.x + start.width, start.y + start.height];
  const [bl, bt, br, bb] = [bitmap.x, bitmap.y, bitmap.x + bitmap.width, bitmap.y + bitmap.height];
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  if (u[0] === 0) l = clamp(p[0], bl, r - min);
  if (u[0] === 1) r = clamp(p[0], l + min, br);
  if (u[1] === 0) t = clamp(p[1], bt, b - min);
  if (u[1] === 1) b = clamp(p[1], t + min, bb);
  if (keepAspect && u[0] !== 0.5 && u[1] !== 0.5) {
    const maxW = u[0] === 0 ? r - bl : br - l;
    const maxH = u[1] === 0 ? b - bt : bb - t;
    const s = Math.min(
      Math.max((r - l) / start.width, (b - t) / start.height),
      maxW / start.width,
      maxH / start.height,
    );
    const w = start.width * s;
    const h = start.height * s;
    if (u[0] === 0) l = r - w;
    else r = l + w;
    if (u[1] === 0) t = b - h;
    else b = t + h;
  }
  return { x: l, y: t, width: r - l, height: b - t };
}

/** Slide the bitmap under a fixed frame by (dx, dy), never uncovering the frame. */
export function panBitmap(frame: Box, bitmap: Box, dx: number, dy: number): Box {
  const x = Math.min(frame.x, Math.max(frame.x + frame.width - bitmap.width, bitmap.x + dx));
  const y = Math.min(frame.y, Math.max(frame.y + frame.height - bitmap.height, bitmap.y + dy));
  return { ...bitmap, x, y };
}
