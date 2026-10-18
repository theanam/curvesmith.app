import type { FormatAdapter } from '../types';
import { baseAdapter, type SvgExportOptions } from '../registry';
import { importSvg } from './import';
import { exportSvgString } from './export';

export { importSvg } from './import';
export { artboardToSvgString, buildSvg, exportSvgString } from './export';

export const svgAdapter: FormatAdapter<SvgExportOptions> = {
  ...baseAdapter<SvgExportOptions>('svg'),
  import: importSvg,
  async export(doc, scope, opts, ctx) {
    const text = await exportSvgString(doc, scope, opts, ctx);
    return new Blob([text], { type: 'image/svg+xml' });
  },
};
