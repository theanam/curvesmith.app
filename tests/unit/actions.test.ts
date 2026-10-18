import { beforeEach, describe, expect, it } from 'vitest';
import * as A from '../../src/state/actions';
import { activeDoc, mutate, select, setNodeSelection, getState } from '../../src/state/store';
import { locate, makePath, makeRect, worldMatrix } from '../../src/core/document';
import { selectionBounds } from '../../src/core/transform';
import { parsePathData } from '../../src/core/geometry/pathdata';
import { apply, translate } from '../../src/core/matrix';
import { freshDoc, children, doc } from './helpers';

function addRects(...rs: [number, number, number, number][]) {
  const nodes = rs.map(([x, y, w, h]) => makeRect(x, y, w, h));
  mutate('Add', (d) => void d.artboards[0].children.push(...(nodes as never[])));
  return nodes.map((n) => n.id);
}

const bounds = (id: string) => selectionBounds(doc(), [id])!;

describe('object actions', () => {
  beforeEach(() => freshDoc());

  it('groups and ungroups without moving anything', () => {
    const ids = addRects([10, 10, 20, 20], [100, 50, 30, 30]);
    select(ids);
    A.groupSelection();
    expect(children()).toHaveLength(1);
    expect(children()[0].type).toBe('group');
    expect(bounds(ids[1])).toMatchObject({ x: 100, y: 50 });
    A.ungroupSelection();
    expect(children()).toHaveLength(2);
    expect(bounds(ids[0])).toMatchObject({ x: 10, y: 10, width: 20 });
  });

  it('arranges the stacking order', () => {
    const [a, b, c] = addRects([0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]);
    select([a]);
    A.arrange('front');
    expect(children().map((n) => n.id)).toEqual([b, c, a]);
    A.arrange('backward');
    expect(children().map((n) => n.id)).toEqual([b, a, c]);
    A.arrange('back');
    expect(children().map((n) => n.id)).toEqual([a, b, c]);
  });

  it('duplicates, deletes and selects all', () => {
    const [a] = addRects([0, 0, 10, 10]);
    select([a]);
    A.duplicateSelection(10);
    expect(children()).toHaveLength(2);
    expect(bounds(activeDoc()!.selection[0])).toMatchObject({ x: 10, y: 10 });
    A.selectAll();
    expect(activeDoc()!.selection).toHaveLength(2);
    A.deleteSelection();
    expect(children()).toHaveLength(0);
  });

  it('aligns and distributes', () => {
    const ids = addRects([0, 0, 10, 10], [50, 20, 10, 10], [200, 40, 10, 10]);
    select(ids);
    A.align('top');
    expect(ids.map((id) => bounds(id).y)).toEqual([0, 0, 0]);
    mutate('Move', (d) => void ((d.artboards[0].children[1].transform as number[])[4] = 20));
    A.distribute('h');
    expect(bounds(ids[1]).x).toBeCloseTo(100);
  });

  it('flips around the selection center', () => {
    const [a] = addRects([10, 0, 20, 10]);
    select([a]);
    A.flip('h');
    expect(bounds(a)).toMatchObject({ x: 10, width: 20 });
    expect(locate(doc(), a)!.node.transform[0]).toBeLessThan(0);
  });

  it('makes a live boolean and expands it to a path', async () => {
    const ids = addRects([0, 0, 100, 100], [50, 50, 100, 100]);
    select(ids);
    await A.makeBoolean('union');
    expect(children()).toHaveLength(1);
    expect(children()[0].type).toBe('boolean');
    expect(bounds(children()[0].id)).toMatchObject({ x: 0, y: 0, width: 150, height: 150 });
    await A.convertToPath();
    expect(children()[0].type).toBe('path');
    expect(bounds(children()[0].id).width).toBeCloseTo(150);
  });

  it('divides overlapping shapes into pieces', async () => {
    select(addRects([0, 0, 100, 100], [50, 0, 100, 100]));
    await A.divideSelection();
    const g = children()[0];
    expect(g.type).toBe('group');
    expect(g.type === 'group' && g.children.length).toBe(3);
  });

  it('outlines a stroke into a filled path', async () => {
    const p = makePath(parsePathData('M0 0L100 0'), undefined, 'Line');
    mutate('Add', (d) => void d.artboards[0].children.push(p as never), [p.id]);
    await A.outlineStroke();
    const n = children()[0];
    expect(n.type).toBe('path');
    expect(n.appearance.items[0].kind).toBe('fill');
  });

  it('makes and releases a compound path', async () => {
    select(addRects([0, 0, 100, 100], [25, 25, 50, 50]));
    await A.makeCompoundPath();
    const n = children()[0];
    expect(n.type === 'path' && n.subpaths.length).toBe(2);
    A.releaseCompoundPath();
    expect(children()).toHaveLength(2);
  });

  it('copies and pastes with an offset', () => {
    const [a] = addRects([0, 0, 10, 10]);
    select([a]);
    A.copySelection();
    A.paste();
    expect(children()).toHaveLength(2);
    expect(bounds(activeDoc()!.selection[0])).toMatchObject({ x: 10, y: 10 });
    A.paste(true);
    expect(bounds(activeDoc()!.selection[0])).toMatchObject({ x: 0, y: 0 });
  });

  it('reorders through the layers tree into a group', () => {
    const [a, b] = addRects([0, 0, 10, 10], [20, 20, 10, 10]);
    select([b]);
    A.groupSelection();
    const g = children().find((n) => n.type === 'group')!;
    A.moveNodeTo(a, { parentId: g.id, artboardId: doc().artboards[0].id, index: 0 });
    expect(children()).toHaveLength(1);
    expect(bounds(a)).toMatchObject({ x: 0, y: 0 });
  });

  it('locks, hides and solos', () => {
    const [a, b] = addRects([0, 0, 10, 10], [20, 0, 10, 10]);
    A.setLocked(a, true);
    expect(locate(doc(), a)!.node.locked).toBe(true);
    A.soloVisibility(a);
    expect(locate(doc(), b)!.node.visible).toBe(false);
    A.soloVisibility(a);
    expect(locate(doc(), b)!.node.visible).toBe(true);
  });

  it('transform again repeats the last transform', () => {
    const [a] = addRects([0, 0, 10, 10]);
    select([a]);
    A.transformSelection('Move', translate(5, 0));
    A.transformAgain();
    expect(bounds(a).x).toBe(10);
  });
});

describe('path node actions', () => {
  beforeEach(() => freshDoc());

  function addPath(d: string) {
    const p = makePath(parsePathData(d), undefined, 'P');
    mutate('Add', (dd) => void dd.artboards[0].children.push(p as never), [p.id]);
    return p.id;
  }
  const sub = (id: string) => {
    const n = locate(doc(), id)!.node;
    return n.type === 'path' ? n.subpaths : [];
  };

  it('converts nodes to smooth and back to sharp', () => {
    const id = addPath('M0 0L50 50L100 0');
    setNodeSelection([{ id, sp: 0, i: 1 }]);
    A.convertNodes('smooth');
    expect(sub(id)[0].nodes[1].in).not.toBeNull();
    setNodeSelection([{ id, sp: 0, i: 1 }]);
    A.convertNodes('sharp');
    expect(sub(id)[0].nodes[1].in).toBeNull();
  });

  it('breaks an open path in two and joins endpoints', () => {
    const id = addPath('M0 0L50 0L100 0');
    setNodeSelection([{ id, sp: 0, i: 1 }]);
    A.breakAtNodes();
    expect(sub(id)).toHaveLength(2);
    setNodeSelection([
      { id, sp: 0, i: 1 },
      { id, sp: 1, i: 0 },
    ]);
    A.joinNodes();
    expect(sub(id)).toHaveLength(1);
  });

  it('opens a closed path when breaking', () => {
    const id = addPath('M0 0H100V100H0Z');
    setNodeSelection([{ id, sp: 0, i: 2 }]);
    A.breakAtNodes();
    expect(sub(id)[0].closed).toBe(false);
    expect(sub(id)[0].nodes).toHaveLength(5);
  });

  it('adds and deletes nodes', () => {
    const id = addPath('M0 0L100 0');
    setNodeSelection([{ id, sp: 0, i: 0 }]);
    A.addNodeAfterSelected();
    expect(sub(id)[0].nodes).toHaveLength(3);
    setNodeSelection([{ id, sp: 0, i: 1 }]);
    A.deleteSelectedNodes();
    expect(sub(id)[0].nodes).toHaveLength(2);
  });

  it('reverses and simplifies paths', () => {
    const pts = Array.from({ length: 30 }, (_, i) => `${i ? 'L' : 'M'}${i * 4} ${Math.sin(i / 4) * 20}`).join(
      '',
    );
    const id = addPath(pts);
    select([id]);
    const before = sub(id)[0].nodes.length;
    A.simplifySelection();
    expect(sub(id)[0].nodes.length).toBeLessThan(before);
    const first = sub(id)[0].nodes[0];
    A.reversePath();
    const last = sub(id)[0].nodes[sub(id)[0].nodes.length - 1];
    expect([last.x, last.y]).toEqual([first.x, first.y]);
  });

  it('keeps world position when nodes live in a transformed group', () => {
    const id = addPath('M0 0L10 0');
    select([id]);
    A.groupSelection();
    const g = children()[0];
    mutate('Move group', (d) => void ((d.artboards[0].children[0].transform as number[])[4] = 50));
    const loc = locate(doc(), id)!;
    expect(apply(worldMatrix(loc), [0, 0])[0]).toBe(50);
    expect(g.type).toBe('group');
    expect(getState().docs).toHaveLength(1);
  });
});
