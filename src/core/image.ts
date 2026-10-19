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
