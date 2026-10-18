import { beforeEach, describe, expect, it } from 'vitest';
import { eyedropperTool } from '../../src/tools/eyedropper';
import { getState, mutate, select, setState } from '../../src/state/store';
import { makeRect, locate } from '../../src/core/document';
import type { ImageNode, SceneNode } from '../../src/core/types';
import { click, doc, freshDoc, setSampledColor } from './helpers';

const RED = { r: 0.9, g: 0.28, b: 0.3 };

function addImageAndRect() {
  const img: ImageNode = {
    ...makeRect(0, 0, 100, 100),
    type: 'image',
    asset: 'assets/x.png',
    width: 100,
    height: 100,
  } as unknown as ImageNode;
  img.appearance = { items: [] };
  const rect = makeRect(200, 0, 50, 50);
  mutate('Add', (d) => void d.artboards[0].children.push(img as never, rect as never));
  return { img, rect };
}

const fillOf = (id: string) => {
  const n = locate(doc(), id)!.node as SceneNode;
  const f = n.appearance.items.find((i) => i.kind === 'fill');
  return f && f.kind === 'fill' && f.paint.type === 'solid' ? f.paint.color : null;
};

describe('eyedropper', () => {
  beforeEach(() => {
    freshDoc();
    setSampledColor(RED);
  });

  it('with the picked image itself selected, the color becomes the default fill', () => {
    const { img } = addImageAndRect();
    select([img.id]);
    click(eyedropperTool, [50, 50]);
    expect(getState().defaults.fill).toMatchObject(RED);
  });

  it('with nothing selected, the color becomes the default fill', () => {
    addImageAndRect();
    click(eyedropperTool, [50, 50]);
    expect(getState().defaults.fill).toMatchObject(RED);
  });

  it('recolors the selected object from an image pixel', () => {
    const { rect } = addImageAndRect();
    select([rect.id]);
    click(eyedropperTool, [50, 50]);
    expect(fillOf(rect.id)).toMatchObject(RED);
  });

  it('picks into the stroke when the stroke swatch has focus, adding one if needed', () => {
    const { rect } = addImageAndRect();
    mutate(
      'No stroke',
      (d) =>
        void (d.artboards[0].children[1].appearance.items =
          d.artboards[0].children[1].appearance.items.filter((i) => i.kind !== 'stroke')),
    );
    setState({ defaults: { ...getState().defaults, focus: 'stroke' } });
    select([rect.id]);
    click(eyedropperTool, [50, 50]);
    const s = locate(doc(), rect.id)!.node.appearance.items.find((i) => i.kind === 'stroke');
    expect(s && s.kind === 'stroke' && s.paint.type === 'solid' && s.paint.color).toMatchObject(RED);
  });

  it('clicking a vector object copies its whole appearance; ⇧ copies color only', () => {
    const { rect } = addImageAndRect();
    const src = makeRect(300, 0, 50, 50);
    src.appearance.items.push({
      kind: 'effect',
      id: 'e1',
      visible: true,
      effect: { type: 'blur', radius: 3 },
    });
    mutate('Add', (d) => void d.artboards[0].children.push(src as never));
    select([rect.id]);
    click(eyedropperTool, [320, 20]);
    expect(locate(doc(), rect.id)!.node.appearance.items.some((i) => i.kind === 'effect')).toBe(true);
    mutate(
      'Reset',
      (d) =>
        void (d.artboards[0].children[1].appearance.items =
          d.artboards[0].children[1].appearance.items.filter((i) => i.kind !== 'effect')),
    );
    click(eyedropperTool, [320, 20], { shift: true });
    expect(locate(doc(), rect.id)!.node.appearance.items.some((i) => i.kind === 'effect')).toBe(false);
    expect(fillOf(rect.id)).toMatchObject(RED);
  });

  it('does nothing when the pixel cannot be read', () => {
    const { rect } = addImageAndRect();
    const before = fillOf(rect.id);
    setSampledColor(null);
    select([rect.id]);
    click(eyedropperTool, [50, 50]);
    expect(fillOf(rect.id)).toEqual(before);
  });
});
