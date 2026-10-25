/* Image crop actions: entering on-canvas crop editing and resetting a crop. */
import { locate } from '../core/document';
import { bitmapRect, reframe, type ImageSize } from '../core/image';
import { multiply, translate } from '../core/matrix';
import type { CurvsDocument, ImageNode } from '../core/types';
import { dataUrlToBytes, readImageSize } from '../formats/shared/bytes';
import { getImage } from '../render/paint';
import { activeDoc, mutate, select, setState } from './store';
import { selectedImage } from './trace';

/** Natural pixel size of an image asset: from its header, or from the decoded bitmap (SVG and others). */
export function naturalSize(src: string): ImageSize | null {
  const bytes = src.startsWith('data:') ? dataUrlToBytes(src) : null;
  const size = bytes ? readImageSize(bytes.bytes) : null;
  if (size) return size;
  const img = getImage(src);
  return img && img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null;
}

export const canCrop = (n: ImageNode | null) => !!n && !n.locked;

/** Edit the crop of an image on canvas (the selected image by default). */
export function startCrop(id = selectedImage()?.id) {
  const od = activeDoc();
  const n = id && od ? locate(od.doc, id)?.node : null;
  if (n?.type !== 'image' || n.locked) return;
  select([n.id]);
  setState({ croppingImage: n.id, editingText: null });
}

export function endCrop() {
  setState({ croppingImage: null });
}

/** Show the whole bitmap again, at its current scale, without moving what was visible. */
export function resetCrop(id = selectedImage()?.id) {
  const od = activeDoc();
  const n = id && od ? locate(od.doc, id)?.node : null;
  if (n?.type !== 'image' || !n.crop) return;
  const src = od!.doc.assets[n.asset];
  const natural = src ? naturalSize(src) : null;
  if (!natural) return;
  const bitmap = bitmapRect(n, natural);
  const r = reframe(bitmap, bitmap, natural);
  mutate('Reset crop', (d) => {
    const m = locate(d as unknown as CurvsDocument, n.id)?.node as ImageNode | undefined;
    if (!m) return;
    m.transform = multiply(n.transform, translate(r.offset[0], r.offset[1]));
    m.width = r.width;
    m.height = r.height;
    delete m.crop;
  });
}
