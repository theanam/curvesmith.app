import { beforeEach, describe, expect, it } from 'vitest';
import { TOOL_IMPLS } from '../../src/tools';
import { toolForKey, TOOLS } from '../../src/tools/ids';
import { activeDoc, getState, select, setNodeSelection, setState, mutate } from '../../src/state/store';
import { selectionBounds } from '../../src/core/transform';
import { locate, makePath, makeRect } from '../../src/core/document';
import { parsePathData } from '../../src/core/geometry/pathdata';
import { api, children, click, doc, drag, freshDoc } from './helpers';

const T = TOOL_IMPLS;

describe('tool registry', () => {
  it('has an implementation for every tool in tools.json', () => {
    for (const t of TOOLS) expect(T[t.id]).toBeTruthy();
  });
  it('maps single-key shortcuts', () => {
    expect(toolForKey({ key: 'p', shiftKey: false })).toBe('pen');
    expect(toolForKey({ key: 'M', shiftKey: true })).toBe('builder');
    expect(toolForKey({ key: '*', shiftKey: true })).toBe('star');
    expect(toolForKey({ key: 'q', shiftKey: false })).toBeNull();
  });
});

describe('drawing tools', () => {
  beforeEach(() => freshDoc());

  it('rectangle draws from corner, square with shift', () => {
    drag(T.rect, [10, 10], [110, 60]);
    expect(selectionBounds(doc(), [children()[0].id])).toMatchObject({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    });
    drag(T.rect, [200, 10], [260, 30], { shift: true });
    const b = selectionBounds(doc(), [children()[1].id])!;
    expect(b.width).toBeCloseTo(b.height);
    expect(activeDoc()!.history.past).toHaveLength(2);
  });

  it('ellipse draws from center with alt', () => {
    drag(T.ellipse, [100, 100], [150, 120], { alt: true });
    const n = children()[0];
    expect(n.type === 'ellipse' && [n.rx, n.ry]).toEqual([50, 20]);
  });

  it('star changes points with arrow keys while drawing', () => {
    const a = api();
    T.star.down!(
      {
        world: [100, 100],
        screen: [100, 100],
        shift: true,
        alt: false,
        mod: false,
        button: 0,
        pressure: 0.5,
        dragging: true,
        downWorld: [100, 100],
        downScreen: [100, 100],
        moved: false,
        clickCount: 1,
      },
      a,
    );
    T.star.move!(
      {
        world: [140, 140],
        screen: [140, 140],
        shift: true,
        alt: false,
        mod: false,
        button: 0,
        pressure: 0.5,
        dragging: true,
        downWorld: [100, 100],
        downScreen: [100, 100],
        moved: true,
        clickCount: 1,
      },
      api(),
    );
    T.star.key!(new KeyboardEvent('keydown', { key: 'ArrowUp' }), api());
    T.star.up!(
      {
        world: [140, 140],
        screen: [140, 140],
        shift: true,
        alt: false,
        mod: false,
        button: 0,
        pressure: 0.5,
        dragging: false,
        downWorld: [100, 100],
        downScreen: [100, 100],
        moved: true,
        clickCount: 1,
      },
      api(),
    );
    const n = children()[0];
    expect(n.type === 'star' && n.points).toBe(6);
  });

  it('pen makes corners on click and curves on drag, Enter finishes', () => {
    click(T.pen, [10, 10]);
    drag(T.pen, [100, 10], [140, 40]);
    click(T.pen, [200, 100]);
    T.pen.key!(new KeyboardEvent('keydown', { key: 'Enter' }), api());
    const n = children()[0];
    expect(n.type).toBe('path');
    if (n.type !== 'path') return;
    expect(n.subpaths[0].nodes).toHaveLength(3);
    expect(n.subpaths[0].nodes[1].out).toEqual([140, 40]);
    expect(n.subpaths[0].nodes[1].in).toEqual([60, -20]);
    expect(n.subpaths[0].closed).toBe(false);
  });

  it('pen closes on the first anchor', () => {
    click(T.pen, [10, 10]);
    click(T.pen, [100, 10]);
    click(T.pen, [100, 100]);
    click(T.pen, [11, 11]);
    const n = children()[0];
    expect(n.type === 'path' && n.subpaths[0].closed).toBe(true);
  });

  it('pencil fits a freehand stroke into few nodes', () => {
    const t = T.pencil;
    const p = (x: number, y: number) => ({
      world: [x, y] as [number, number],
      screen: [x, y] as [number, number],
      shift: false,
      alt: false,
      mod: false,
      button: 0,
      pressure: 0.5,
      dragging: true,
      downWorld: [0, 0] as [number, number],
      downScreen: [0, 0] as [number, number],
      moved: true,
      clickCount: 1,
    });
    t.down!(p(0, 100), api());
    for (let i = 1; i <= 60; i++) t.move!(p(i * 5, 100 + Math.sin(i / 8) * 40), api());
    t.up!({ ...p(300, 100), dragging: false }, api());
    const n = children()[0];
    expect(n.type === 'path' && n.subpaths[0].nodes.length).toBeLessThan(15);
  });

  it('text tool creates a point text node and starts editing', () => {
    click(T.text, [50, 50]);
    expect(children()[0].type).toBe('text');
    expect(getState().editingText).toBe(children()[0].id);
  });
});

describe('selection tools', () => {
  beforeEach(() => {
    freshDoc();
    mutate(
      'Add',
      (d) =>
        void d.artboards[0].children.push(
          makeRect(10, 10, 50, 50) as never,
          makeRect(100, 10, 50, 50) as never,
        ),
    );
  });

  it('move selects on click and drags with one undo step', () => {
    drag(T.move, [30, 30], [70, 50]);
    const id = activeDoc()!.selection[0];
    expect(selectionBounds(doc(), [id])).toMatchObject({ x: 50, y: 30 });
    expect(activeDoc()!.history.past.at(-1)!.label).toBe('Move');
  });

  it('alt-drag duplicates', () => {
    drag(T.move, [30, 30], [30, 130], { alt: true });
    expect(children()).toHaveLength(3);
    expect(selectionBounds(doc(), [children()[0].id])).toMatchObject({ y: 10 });
  });

  it('marquee selects and shift-click toggles', () => {
    drag(T.move, [0, 0], [200, 100]);
    expect(activeDoc()!.selection).toHaveLength(2);
    click(T.move, [120, 30], { shift: true });
    expect(activeDoc()!.selection).toHaveLength(1);
  });

  it('scales from a corner handle', () => {
    select([children()[0].id]);
    drag(T.move, [60, 60], [110, 110]);
    expect(selectionBounds(doc(), [children()[0].id])).toMatchObject({ x: 10, width: 100, height: 100 });
  });

  it('node tool drags a node and bends a segment', () => {
    const p = makePath(parsePathData('M0 200L100 200L200 200'), undefined, 'Line');
    mutate('Add', (d) => void d.artboards[0].children.push(p as never), [p.id]);
    setState({ tool: 'node' });
    drag(T.node, [100, 200], [100, 250]);
    let n = locate(doc(), p.id)!.node;
    expect(n.type === 'path' && n.subpaths[0].nodes[1].y).toBe(250);
    setNodeSelection([]);
    drag(T.node, [150, 225], [150, 180]);
    n = locate(doc(), p.id)!.node;
    expect(n.type === 'path' && n.subpaths[0].nodes[1].out).not.toBeNull();
  });

  it('hand tool pans the view', () => {
    drag(T.hand, [0, 0], [50, 20]);
    expect(activeDoc()!.view).toMatchObject({ panX: 50, panY: 20 });
  });

  it('zoom tool zooms in on click', () => {
    click(T.zoom, [100, 100]);
    expect(activeDoc()!.view!.zoom).toBeGreaterThan(1);
  });

  it('eyedropper copies appearance onto the selection', () => {
    const [a, b] = children();
    mutate(
      'Color',
      (d) => void ((d.artboards[0].children[1].appearance.items[0] as { opacity: number }).opacity = 0.5),
    );
    select([a.id]);
    click(T.eyedropper, [120, 30]);
    expect((locate(doc(), a.id)!.node.appearance.items[0] as { opacity: number }).opacity).toBe(0.5);
    expect(b.id).toBeTruthy();
  });

  it('gradient tool turns a solid fill into a linear gradient', () => {
    drag(T.gradient, [15, 30], [55, 30]);
    const f = children()[0].appearance.items.find((i) => i.kind === 'fill');
    expect(f && f.kind === 'fill' && f.paint.type).toBe('linear');
  });

  it('scissors cuts a path at the click', () => {
    const p = makePath(parsePathData('M0 250L300 250'), undefined, 'Cut me');
    mutate('Add', (d) => void d.artboards[0].children.push(p as never));
    click(T.scissors, [150, 250]);
    const n = locate(doc(), p.id)!.node;
    expect(n.type === 'path' && n.subpaths).toHaveLength(2);
  });

  it('shape builder merges dragged regions', () => {
    freshDoc();
    mutate(
      'Add',
      (d) =>
        void d.artboards[0].children.push(
          makeRect(0, 0, 100, 100) as never,
          makeRect(50, 0, 100, 100) as never,
        ),
    );
    select(children().map((n) => n.id));
    drag(T.builder, [25, 50], [75, 50]);
    // Left piece and overlap merge; the right remainder stays.
    expect(children()).toHaveLength(2);
  });
});
