import { applyPatches, enablePatches, type Draft, type Patch, produce, produceWithPatches } from 'immer';
import type { CurvsDocument } from './types';

enablePatches();

export type Recipe = (draft: Draft<CurvsDocument>) => void;

export type HistoryEntry = {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  selBefore: string[];
  selAfter: string[];
  at: number;
};

export type History = { past: HistoryEntry[]; future: HistoryEntry[] };

export const emptyHistory = (): History => ({ past: [], future: [] });

export type Applied = { doc: CurvsDocument; entry: HistoryEntry | null };

/** Apply a recipe and record it. Entries with no changes are dropped. */
export function record(
  doc: CurvsDocument,
  recipe: Recipe,
  label: string,
  selBefore: string[],
  selAfter: string[],
): Applied {
  const [next, patches, inverse] = produceWithPatches(doc, recipe);
  if (!patches.length && sameSelection(selBefore, selAfter)) return { doc, entry: null };
  return { doc: next, entry: { label, patches, inverse, selBefore, selAfter, at: Date.now() } };
}

/** A pure preview of a recipe without recording (for live drags). */
export const preview = (doc: CurvsDocument, recipe: Recipe) => produce(doc, recipe);

export function push(h: History, entry: HistoryEntry, coalesceMs = 0): History {
  const last = h.past[h.past.length - 1];
  // Coalesce repeated edits of the same label (e.g. nudging with arrow keys).
  if (coalesceMs && last && last.label === entry.label && entry.at - last.at < coalesceMs) {
    const merged: HistoryEntry = {
      ...entry,
      patches: [...last.patches, ...entry.patches],
      inverse: [...entry.inverse, ...last.inverse],
      selBefore: last.selBefore,
    };
    return { past: [...h.past.slice(0, -1), merged], future: [] };
  }
  return { past: [...h.past, entry], future: [] };
}

export function undo(
  doc: CurvsDocument,
  h: History,
): { doc: CurvsDocument; history: History; selection: string[] } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.inverse),
    history: { past: h.past.slice(0, -1), future: [entry, ...h.future] },
    selection: entry.selBefore,
  };
}

export function redo(
  doc: CurvsDocument,
  h: History,
): { doc: CurvsDocument; history: History; selection: string[] } | null {
  const entry = h.future[0];
  if (!entry) return null;
  return {
    doc: applyPatches(doc, entry.patches),
    history: { past: [...h.past, entry], future: h.future.slice(1) },
    selection: entry.selAfter,
  };
}

/** Jump to a point in history: index = number of past entries to keep. */
export function jumpTo(doc: CurvsDocument, h: History, index: number) {
  let state = { doc, history: h, selection: [] as string[] };
  while (state.history.past.length > index) {
    const r = undo(state.doc, state.history);
    if (!r) break;
    state = r;
  }
  while (state.history.past.length < index) {
    const r = redo(state.doc, state.history);
    if (!r) break;
    state = r;
  }
  return state;
}

function sameSelection(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
