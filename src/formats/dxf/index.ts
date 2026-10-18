import type { FormatAdapter } from '../types';
import { baseAdapter, type DxfExportOptions } from '../registry';
import { exportDxfString } from './export';
import { importDxf } from './import';

export { exportDxfString } from './export';
export { importDxf, parseDxf } from './import';

export const dxfAdapter: FormatAdapter<DxfExportOptions> = {
  ...baseAdapter<DxfExportOptions>('dxf'),
  import: importDxf,
  async export(doc, scope, opts, ctx) {
    return new Blob([await exportDxfString(doc, scope, opts, ctx)], { type: 'image/vnd.dxf' });
  },
};
