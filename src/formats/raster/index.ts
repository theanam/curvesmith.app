import type { FormatAdapter } from '../types';
import { baseAdapter, type FormatId, type RasterExportOptions } from '../registry';
import { importImage } from './import';

export { imageNodeFromFile, importImage, IMAGE_NOTE } from './import';

/** PNG/JPG/WebP (export + import) and GIF (import only). The renderer loads on first export. */
export function rasterAdapter(id: 'png' | 'jpg' | 'webp' | 'gif'): FormatAdapter<RasterExportOptions> {
  const base = baseAdapter<RasterExportOptions>(id as FormatId);
  if (id === 'gif') return { ...base, import: importImage };
  return {
    ...base,
    import: importImage,
    async export(doc, scope, opts, ctx) {
      const { exportRaster } = await import('./export');
      return exportRaster(id, doc, scope, opts, ctx);
    },
  };
}
