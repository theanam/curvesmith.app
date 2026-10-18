import type { FormatAdapter } from '../types';
import { baseAdapter, type PdfExportOptions } from '../registry';
import { exportPdfBytes } from './export';
import { importPdf } from './import';
import { bytesBlob } from '../shared/bytes';

export { exportPdfBytes } from './export';
export { importPdf } from './import';

export const pdfAdapter: FormatAdapter<PdfExportOptions> = {
  ...baseAdapter<PdfExportOptions>('pdf'),
  import: (bytes, opts) => importPdf(bytes, opts, 'pdf'),
  async export(doc, scope, opts, ctx) {
    return bytesBlob(await exportPdfBytes(doc, scope, opts, ctx), 'application/pdf');
  },
};

/** AI = a PDF-based file with the .ai extension. Illustrator opens it as a PDF; import reads its PDF content. */
export const aiAdapter: FormatAdapter<PdfExportOptions> = {
  ...baseAdapter<PdfExportOptions>('ai'),
  import: (bytes, opts) => importPdf(bytes, opts, 'ai'),
  async export(doc, scope, opts, ctx) {
    return bytesBlob(await exportPdfBytes(doc, scope, opts, ctx), 'application/illustrator');
  },
};
