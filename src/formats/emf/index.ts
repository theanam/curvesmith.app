import type { FormatAdapter } from '../types';
import { baseAdapter, type EmfExportOptions } from '../registry';
import { exportEmfBytes } from './export';
import { bytesBlob } from '../shared/bytes';

export { exportEmfBytes } from './export';

export const emfAdapter: FormatAdapter<EmfExportOptions> = {
  ...baseAdapter<EmfExportOptions>('emf'),
  async export(doc, scope, opts, ctx) {
    return bytesBlob(await exportEmfBytes(doc, scope, opts, ctx), 'image/emf');
  },
};
