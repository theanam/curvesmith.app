import { beforeEach, describe, expect, it } from 'vitest';
import { builderTool, edgeAt, overlappingCluster } from '../../src/tools/builder';
import { selectionBounds } from '../../src/core/transform';
import { makeEllipse, makeRect } from '../../src/core/document';
import { mutate, select } from '../../src/state/store';
import { api, children, doc, freshDoc } from './helpers';
import type { ToolPointer } from '../../src/tools/types';
import type { Vec } from '../../src/core/types';

const p = (world: Vec, dragging: boolean, down: Vec = world, alt = false): ToolPointer => ({
  world,
  screen: world,
  shift: false,
  alt,
  mod: false,
  button: 0,
  pressure: 0.5,
  dragging,
  downWorld: down,
  downScreen: down,
  moved: dragging,
  clickCount: 1,
});

function overlapping() {
  const a = makeRect(0, 0, 100, 100);
  const b = makeRect(50, 0, 100, 100);
  const far = makeEllipse(260, 250, 20, 20);
  mutate('Add', (d) => void d.artboards[0].children.push(a as never, b as never, far as never));
  return { a, b, far };
}

/** Hover, then drag from `from` to `to` (the hover is what picks shapes up without a selection). */
function hoverDrag(from: Vec, to: Vec, alt = false) {
  builderTool.move!(p(from, false), api());
  builderTool.down!(p(from, true, from, alt), api());
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    builderTool.move!(
      p([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], true, from, alt),
      api(),
    );
  }
  builderTool.up!(p(to, false, from, alt), api());
}

describe('Shape builder', () => {
  beforeEach(() => freshDoc());

  it('picks up the overlapping shapes under the pointer, leaving others out', () => {
    const { a, b, far } = overlapping();
    const ids = overlappingCluster(doc(), [20, 50], 1, null);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
    expect(ids).not.toContain(far.id);
    expect(overlappingCluster(doc(), [260, 250], 1, null)).toEqual([]);
  });

  it('merges regions without selecting first', () => {
    overlapping();
    select([]);
    // Drag from the left-only region into the overlap: the two merge; the right remainder stays.
    hoverDrag([25, 50], [75, 50]);
    const types = children().map((n) => n.type);
    expect(types.filter((t) => t === 'path')).toHaveLength(2);
    expect(types).toContain('ellipse');
  });

  it('⌥-drag erases a region', () => {
    overlapping();
    hoverDrag([75, 50], [75, 50], true);
    // The overlap is gone: left and right remainders stay as separate pieces.
    expect(children().filter((n) => n.type === 'path')).toHaveLength(2);
  });

  it('works on overlapping shapes inside a group', async () => {
    const { a, b } = overlapping();
    const { groupSelection } = await import('../../src/state/actions');
    select([a.id, b.id]);
    groupSelection();
    select([]);
    expect(overlappingCluster(doc(), [20, 50], 1, null).sort()).toEqual([a.id, b.id].sort());
    hoverDrag([25, 50], [75, 50]);
    const g = children().find((n) => n.type === 'group');
    expect(g && g.type === 'group' && g.children.every((c) => c.type === 'path')).toBe(true);
  });

  it('still respects an explicit selection of two or more', () => {
    const { a, b } = overlapping();
    select([a.id, b.id]);
    hoverDrag([25, 50], [140, 50]);
    expect(children().filter((n) => n.type === 'path')).toHaveLength(1);
  });

  it('builds shapes from different groups together', async () => {
    const { a, b, far } = overlapping();
    const { groupSelection } = await import('../../src/state/actions');
    select([a.id, far.id]);
    groupSelection();
    select([]);
    expect(overlappingCluster(doc(), [120, 50], 1, null).sort()).toEqual([a.id, b.id].sort());
    hoverDrag([25, 50], [140, 50]);
    // The merged shape lands where the front-most source was (inside the group); b is gone from the top level.
    expect(children().some((n) => n.id === b.id)).toBe(false);
    const g = children().find((n) => n.type === 'group');
    const kids = g && g.type === 'group' ? g.children : [];
    expect(kids.map((c) => c.type).sort()).toEqual(['ellipse', 'path']);
    const merged = kids.find((c) => c.type === 'path')!;
    expect(selectionBounds(doc(), [merged.id])).toMatchObject({ x: 0, width: 150 });
  });

  it('finds the line between two regions, never an outer outline', () => {
    overlapping();
    builderTool.move!(p([25, 50], false), api());
    expect(edgeAt(api(), [50, 50])).not.toBeNull();
    expect(edgeAt(api(), [100, 50])).not.toBeNull();
    expect(edgeAt(api(), [0, 50])).toBeNull();
    expect(edgeAt(api(), [25, 50])).toBeNull();
  });

  it('⌥-drag along a line removes it, joining the regions on both sides', () => {
    overlapping();
    hoverDrag([50, 40], [50, 60], true);
    const paths = children().filter((n) => n.type === 'path');
    expect(paths).toHaveLength(2);
    const widths = paths.map((n) => Math.round(selectionBounds(doc(), [n.id])!.width)).sort((x, y) => x - y);
    expect(widths).toEqual([50, 100]);
  });

  it('⌥-dragging across both lines leaves one shape', () => {
    overlapping();
    builderTool.move!(p([50, 50], false), api());
    builderTool.down!(p([50, 50], true, [50, 50], true), api());
    builderTool.move!(p([75, 50], true, [50, 50], true), api());
    builderTool.move!(p([100, 50], true, [50, 50], true), api());
    builderTool.up!(p([100, 50], false, [50, 50], true), api());
    const paths = children().filter((n) => n.type === 'path');
    expect(paths).toHaveLength(1);
    expect(Math.round(selectionBounds(doc(), [paths[0].id])!.width)).toBe(150);
  });

  it('previews removal in red while ⌥ is held', () => {
    overlapping();
    builderTool.move!(p([50, 50], false), api());
    const styles: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => (k === 'setLineDash' || typeof k !== 'string' ? () => undefined : () => undefined),
        set: (_t, k, v) => {
          if (k === 'strokeStyle' || k === 'fillStyle') styles.push(String(v));
          return true;
        },
      },
    ) as CanvasRenderingContext2D;
    builderTool.overlay!(ctx, api());
    expect(styles).not.toContain('#e5484d');
    builderTool.key!(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }), api());
    builderTool.overlay!(ctx, api());
    expect(styles).toContain('#e5484d');
    builderTool.keyUp!(new KeyboardEvent('keyup', { key: 'Alt' }), api());
    styles.length = 0;
    builderTool.overlay!(ctx, api());
    expect(styles).not.toContain('#e5484d');
  });
});
