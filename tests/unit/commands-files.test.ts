import { beforeEach, describe, expect, it } from 'vitest';
import {
  COMMANDS,
  MENUS,
  command,
  commandForEvent,
  formatShortcut,
  isEnabled,
} from '../../src/state/commands';
import { activeDoc, getState, mutate, resetStore } from '../../src/state/store';
import {
  autosave,
  listAutosaves,
  openAutosave,
  splitName,
  addRecent,
  listRecent,
  removeRecent,
  deleteAutosave,
} from '../../src/state/files';
import { idbGet, idbSet, lsGet, lsSet } from '../../src/state/storage';
import { makeRect } from '../../src/core/document';
import { SAMPLES } from '../../src/samples';
import { colorToHex } from '../../src/core/color';
import { freshDoc } from './helpers';
import { importFile, exportDocument } from '../../src/formats/registry';

const key = (k: string, o: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, ...o });

describe('commands', () => {
  it('every menu item is a registered command', () => {
    for (const m of MENUS) for (const id of m.items) if (id !== '-') expect(command(id), id).toBeTruthy();
  });
  it('command ids and shortcuts are unique', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sc = COMMANDS.filter((c) => c.category !== 'Tool' && c.shortcut).map((c) => c.shortcut);
    expect(new Set(sc).size).toBe(sc.length);
  });
  it('formats shortcuts per platform', () => {
    expect(formatShortcut('Mod+Shift+S', true)).toBe('⌘⇧S');
    expect(formatShortcut('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
  });
  it('maps standard key events to commands (Ctrl on non-mac test env)', () => {
    expect(commandForEvent(key('s', { ctrlKey: true, code: 'KeyS' }))?.id).toBe('file.save');
    expect(commandForEvent(key('S', { ctrlKey: true, shiftKey: true, code: 'KeyS' }))?.id).toBe(
      'file.saveAs',
    );
    expect(commandForEvent(key('z', { ctrlKey: true, code: 'KeyZ' }))?.id).toBe('edit.undo');
    expect(commandForEvent(key('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }))?.id).toBe(
      'object.front',
    );
    expect(commandForEvent(key('k', { ctrlKey: true, code: 'KeyK' }))?.id).toBe('edit.palette');
    expect(commandForEvent(key('a'))).toBeNull();
  });
  it('disables document commands without a document', () => {
    resetStore();
    expect(isEnabled(command('file.save'))).toBe(false);
    expect(isEnabled(command('file.open'))).toBe(true);
    freshDoc();
    expect(isEnabled(command('file.save'))).toBe(true);
    expect(isEnabled(command('edit.copy'))).toBe(false);
  });
});

describe('storage and files', () => {
  beforeEach(() => freshDoc());

  it('splits names', () => {
    expect(splitName('Poster.final.CURVS')).toEqual({ base: 'Poster.final', ext: '.curvs' });
    expect(splitName('README')).toEqual({ base: 'README', ext: '' });
  });

  it('reads and writes local storage safely', () => {
    lsSet('x', { a: 1 });
    expect(lsGet('x', null)).toEqual({ a: 1 });
    expect(lsGet('missing', 7)).toBe(7);
  });

  it('round-trips IndexedDB values', async () => {
    await idbSet('kv', 'k', { v: 2 });
    expect(await idbGet('kv', 'k')).toEqual({ v: 2 });
  });

  it('autosaves and restores a document with its undo history', async () => {
    mutate('Add', (d) => void d.artboards[0].children.push(makeRect(0, 0, 10, 10) as never));
    const od = activeDoc()!;
    expect(await autosave(od)).toBe(true);
    expect((await listAutosaves()).map((a) => a.id)).toContain(od.doc.id);
    resetStore();
    const k = await openAutosave(od.doc.id);
    expect(k).toBeTruthy();
    const back = activeDoc()!;
    expect(back.doc.artboards[0].children).toHaveLength(1);
    expect(back.history.past).toHaveLength(1);
    await deleteAutosave(od.doc.id);
    expect((await listAutosaves()).map((a) => a.id)).not.toContain(od.doc.id);
  });

  it('tracks recent files', async () => {
    const od = activeDoc()!;
    await addRecent(od, null);
    expect((await listRecent())[0].id).toBe(od.doc.id);
    await removeRecent(od.doc.id);
    expect((await listRecent()).find((r) => r.id === od.doc.id)).toBeUndefined();
  });
});

describe('samples', () => {
  it('builds every sample and survives a .curvs round trip', async () => {
    for (const s of SAMPLES) {
      const doc = s.make();
      expect(doc.artboards[0].children.length).toBeGreaterThan(0);
      const blob = await exportDocument(
        'curvs',
        doc,
        { kind: 'all' },
        {},
        { name: s.id, selection: [], activeArtboard: doc.artboards[0].id },
      );
      const { doc: back } = await importFile({
        name: `${s.id}.curvs`,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
      expect(back.artboards[0].children.length).toBe(doc.artboards[0].children.length);
      const hex = (d: typeof doc) => d.swatches.map((sw) => colorToHex(sw.color as never));
      expect(hex(back)).toEqual(hex(doc));
    }
    expect(getState()).toBeTruthy();
  });
});
