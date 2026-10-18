/* Bitmap import (PNG, JPG, WebP, GIF): places the image as an image node. Sizes come from the file headers,
   so this works without a canvas. 1 image pixel = 1 pt. */
import type { CurvsDocument, ImageNode, ImportReport } from '../../core/types';
import { createDocument, makeGroup } from '../../core/document';
import { emptyReport, note, type ImportOptions } from '../types';
import { bytesToDataUrl, extForMime, readImageSize, sha256Hex, sniffImageMime } from '../shared/bytes';

export const IMAGE_NOTE = 'Placed as an image. Image Trace arrives in a later version.';

/** An image node for placing a bitmap into any document, plus its asset key and data URL. */
export async function imageNodeFromFile(
  bytes: Uint8Array,
  mime?: string,
): Promise<{ node: ImageNode; assetKey: string; dataUrl: string }> {
  const type = sniffImageMime(bytes) ?? mime;
  if (!type || !type.startsWith('image/')) throw new Error('This file is not an image Curvesmith can place.');
  const size = readImageSize(bytes);
  if (!size || !size.width || !size.height)
    throw new Error('This image could not be read. It may be damaged.');
  const hash = await sha256Hex(bytes);
  const assetKey = `assets/${hash}.${extForMime(type)}`;
  const { children: _c, type: _t, ...base } = makeGroup([], 'Image');
  const node: ImageNode = { ...base, type: 'image', asset: assetKey, width: size.width, height: size.height };
  return { node, assetKey, dataUrl: bytesToDataUrl(bytes, type) };
}

export async function importImage(
  bytes: Uint8Array,
  opts: ImportOptions,
): Promise<{ doc: CurvsDocument; report: ImportReport }> {
  const { node, assetKey, dataUrl } = await imageNodeFromFile(bytes);
  const name = opts.fileName.replace(/\.[a-z0-9]+$/i, '') || 'Image';
  node.name = name;
  const doc = createDocument({ name, width: node.width, height: node.height, units: 'px' });
  doc.assets[assetKey] = dataUrl;
  doc.artboards[0].children = [node];
  const report = emptyReport('image');
  report.warnings.push(IMAGE_NOTE);
  note(report, 'images', 1);
  return { doc, report };
}
