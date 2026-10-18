import type { FormatAdapter } from '../types';
import { baseAdapter, type EpsExportOptions } from '../registry';
import { exportEpsString } from './export';

export { exportEpsString } from './export';

export const epsAdapter: FormatAdapter<EpsExportOptions> = {
  ...baseAdapter<EpsExportOptions>('eps'),
  async export(doc, scope, opts, ctx) {
    return new Blob([await exportEpsString(doc, scope, opts, ctx)], { type: 'application/postscript' });
  },
};
