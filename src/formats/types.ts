import type { CurvsDocument, ExportScope, ImportReport } from '../core/types';

export type ImportOptions = {
  /** File name without directories, used to name the document and its artboards. */
  fileName: string;
};

export type ExportContext = {
  /** Base file name without extension. */
  name: string;
  /** Current selection (node ids), used when scope.kind === 'selection'. */
  selection: string[];
  /** Id of the active artboard. */
  activeArtboard: string;
  /** Receives short, user-facing notes about what the format could not keep (deduplicated by the caller). */
  warn?: (message: string) => void;
};

export type FormatGroup = 'native' | 'vector' | 'raster';

export interface FormatAdapter<Opts = Record<string, unknown>> {
  id: string;
  label: string;
  /** Short descriptor for the export list ("Web, code, icons"). */
  descriptor: string;
  group: FormatGroup;
  extensions: string[];
  mime: string[];
  canImport: boolean;
  canExport: boolean;
  /** Default export options (persisted per format and per document). */
  defaults?: Opts;
  /** One-line honesty note shown in the export dialog (e.g. AI is PDF-based). */
  note?: string;
  import?(bytes: Uint8Array, opts: ImportOptions): Promise<{ doc: CurvsDocument; report: ImportReport }>;
  export?(doc: CurvsDocument, scope: ExportScope, opts: Opts, ctx: ExportContext): Promise<Blob>;
}

export const emptyReport = (format: string): ImportReport => ({ format, warnings: [], notes: {} });

export function note(report: ImportReport, key: string, n = 1) {
  report.notes[key] = (report.notes[key] ?? 0) + n;
}

/** Collects export notes so each message is reported once. */
export function warner(ctx: Pick<ExportContext, 'warn'>) {
  const seen = new Set<string>();
  return (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    ctx.warn?.(message);
  };
}

/** "1 mask was dropped." / "3 masks were dropped." */
export function countMessage(n: number, singular: string, plural: string, verb: string): string {
  return n === 1 ? `1 ${singular} was ${verb}.` : `${n} ${plural} were ${verb}.`;
}
