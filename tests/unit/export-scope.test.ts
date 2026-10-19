import { describe, expect, it } from 'vitest';
import { makeRect, makeFill } from '../../src/core/document';
import { rgb } from '../../src/core/color';
import { mutate } from '../../src/state/store';
import { addNode } from '../../src/state/actions';
import { artworkIds, scopeFor } from '../../src/state/io';
import { pagesForScope } from '../../src/formats/shared/pages';
import { activeDoc } from '../../src/state/store';
import { freshDoc } from './helpers';

describe('export scope: artwork only', () => {
  it('crops to the drawing on the artboard, without its background or a selection', () => {
    freshDoc();
    expect(artworkIds()).toEqual([]);
    expect(scopeFor('artwork')).toMatchObject({ kind: 'artboard' });
    const a = makeRect(40, 30, 100, 50, { items: [makeFill(rgb(1, 0, 0))] });
    const b = makeRect(200, 120, 20, 40, { items: [makeFill(rgb(0, 0, 1))] });
    const hidden = makeRect(0, 0, 400, 300, { items: [makeFill(rgb(0, 1, 0))] });
    hidden.visible = false;
    addNode(a);
    addNode(b);
    addNode(hidden);
    mutate('Deselect', () => {}, []);
    expect(activeDoc()!.selection).toEqual([]);
    expect(artworkIds()).toEqual([a.id, b.id]);
    const od = activeDoc()!;
    const [page] = pagesForScope(
      od.doc,
      scopeFor('artwork'),
      { activeArtboard: od.activeArtboard, name: 'x' },
      false,
    );
    expect(page).toMatchObject({ x: 40, y: 30, width: 180, height: 130, backgrounds: [] });
  });
});
