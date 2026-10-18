import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeDoc,
  beginGesture,
  cancelGesture,
  closeDocument,
  endGesture,
  getState,
  isDirty,
  jumpHistory,
  mutate,
  redo,
  select,
  undo,
  updateGesture,
} from '../../src/state/store';
import { makeRect } from '../../src/core/document';
import { freshDoc, children } from './helpers';

describe('editor store', () => {
  beforeEach(() => freshDoc());

  it('opens a new document as an unsaved tab', () => {
    const od = activeDoc()!;
    expect(getState().route).toBe('editor');
    expect(od.doc.artboards[0].width).toBe(400);
    expect(isDirty(od)).toBe(true);
  });

  it('records mutations with undo and redo, restoring selection', () => {
    const r = makeRect(10, 10, 20, 20);
    mutate('Add', (d) => void d.artboards[0].children.push(r), [r.id]);
    expect(activeDoc()!.selection).toEqual([r.id]);
    undo();
    expect(children()).toHaveLength(0);
    expect(activeDoc()!.selection).toEqual([]);
    redo();
    expect(children()).toHaveLength(1);
    expect(activeDoc()!.selection).toEqual([r.id]);
  });

  it('records one entry per gesture and keeps "kept" steps', () => {
    const r = makeRect(0, 0, 10, 10);
    beginGesture();
    updateGesture((d) => void d.artboards[0].children.push(structuredClone(r)), true);
    updateGesture((d) => void (d.artboards[0].children[0] as { width: number }).width++);
    updateGesture((d) => void ((d.artboards[0].children[0] as { width: number }).width += 5));
    endGesture('Draw');
    expect(children()).toHaveLength(1);
    expect((children()[0] as { width: number }).width).toBe(15);
    expect(activeDoc()!.history.past).toHaveLength(1);
  });

  it('cancels gestures back to the base document', () => {
    beginGesture();
    updateGesture((d) => void (d.artboards[0].width = 999));
    cancelGesture();
    expect(activeDoc()!.doc.artboards[0].width).toBe(400);
    expect(activeDoc()!.history.past).toHaveLength(0);
  });

  it('jumps through history', () => {
    for (let i = 0; i < 3; i++) mutate(`Step ${i}`, (d) => void (d.artboards[0].width += 10));
    jumpHistory(1);
    expect(activeDoc()!.doc.artboards[0].width).toBe(410);
    jumpHistory(3);
    expect(activeDoc()!.doc.artboards[0].width).toBe(430);
  });

  it('prunes selection of removed nodes and closes tabs', () => {
    select(['missing']);
    expect(activeDoc()!.selection).toEqual([]);
    closeDocument(getState().activeKey!);
    expect(getState().docs).toHaveLength(0);
    expect(getState().route).toBe('home');
  });
});
