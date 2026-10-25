import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageNode, Vec } from '../../src/core/types';
import { bitmapRect, panBitmap, reframe, resizeFrame } from '../../src/core/image';
import { locate, worldMatrix } from '../../src/core/document';
import { apply, invert, multiply, rotate } from '../../src/core/matrix';
import { getState, mutate, select } from '../../src/state/store';
import { resetCrop, startCrop } from '../../src/state/crop';
import { cropTool } from '../../src/tools/crop';
import { TOOL_IMPLS } from '../../src/tools';
import { api, doc, drag, freshDoc } from './helpers';

/** A PNG header that reads as 200×100 pixels (crop only needs the natural size). */
function pngOfSize(w: number, h: number) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
}

const NATURAL = { width: 200, height: 100 };

function placeImage(transform: ImageNode['transform'] = [1, 0, 0, 1, 50, 50]) {
  const img: ImageNode = {
    id: 'nd_photo',
    name: 'Photo',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform,
    appearance: { items: [] },
    type: 'image',
    asset: 'assets/p.png',
    width: 200,
    height: 100,
  };
  mutate('Place', (d) => {
    d.assets['assets/p.png'] = pngOfSize(NATURAL.width, NATURAL.height);
    d.artboards[0].children.push(img);
  });
  select([img.id]);
}

const image = () => locate(doc(), 'nd_photo')!.node as ImageNode;

/** Source pixel shown at a world point (what must not move while cropping). */
function sourceAt(world: Vec): Vec {
  const n = image();
  const local = apply(invert(worldMatrix(locate(doc(), n.id)!)), world);
  const c = n.crop ?? { x: 0, y: 0, ...NATURAL };
  return [c.x + (local[0] * c.width) / n.width, c.y + (local[1] * c.height) / n.height];
}

describe('crop geometry', () => {
  it('places the whole bitmap around the visible part', () => {
    const n = { width: 100, height: 50, crop: { x: 50, y: 25, width: 100, height: 50 } };
    expect(bitmapRect(n, NATURAL)).toEqual({ x: -50, y: -25, width: 200, height: 100 });
  });

  it('drops the crop when the frame shows everything', () => {
    const bitmap = { x: -10, y: 0, width: 200, height: 100 };
    expect(reframe(bitmap, bitmap, NATURAL)).toEqual({
      offset: [-10, 0],
      width: 200,
      height: 100,
      crop: undefined,
    });
  });

  it('keeps dragged edges inside the bitmap and above a minimum size', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 };
    const bitmap = { ...start };
    expect(resizeFrame(start, bitmap, [1, 0.5], [300, 40], 4)).toEqual(start);
    expect(resizeFrame(start, bitmap, [0, 0.5], [500, 40], 4)).toEqual({
      x: 196,
      y: 0,
      width: 4,
      height: 100,
    });
    expect(resizeFrame(start, bitmap, [1, 1], [150, 90], 4)).toEqual({ x: 0, y: 0, width: 150, height: 90 });
  });

  it('keeps proportions on a corner with shift', () => {
    const start = { x: 0, y: 0, width: 200, height: 100 };
    const r = resizeFrame(start, start, [1, 1], [100, 90], 4, true);
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.width).toBeCloseTo(180);
  });

  it('never slides the bitmap off the frame', () => {
    const frame = { x: 0, y: 0, width: 100, height: 50 };
    const bitmap = { x: -50, y: -25, width: 200, height: 100 };
    expect(panBitmap(frame, bitmap, 80, 0).x).toBe(0);
    expect(panBitmap(frame, bitmap, -80, 0).x).toBe(-100);
    expect(panBitmap(frame, bitmap, 10, 5)).toMatchObject({ x: -40, y: -20 });
  });
});

describe('crop on canvas', () => {
  beforeEach(() => {
    freshDoc();
    placeImage();
  });

  it('double-click with Move enters crop; Enter leaves it', () => {
    TOOL_IMPLS.move.dblclick!(
      {
        world: [100, 80],
        screen: [100, 80],
        shift: false,
        alt: false,
        mod: false,
        button: 0,
        pressure: 0.5,
        dragging: false,
        downWorld: [100, 80],
        downScreen: [100, 80],
        moved: false,
        clickCount: 2,
      },
      api(),
    );
    expect(getState().croppingImage).toBe('nd_photo');
    expect(cropTool.key!(new KeyboardEvent('keydown', { key: 'Enter' }), api())).toBe(true);
    expect(getState().croppingImage).toBeNull();
  });

  it('dragging an edge crops without moving the picture', () => {
    startCrop();
    const before = sourceAt([150, 80]);
    drag(cropTool, [250, 100], [200, 100]); // right edge in by 50
    drag(cropTool, [50, 100], [80, 100]); // left edge in by 30
    const n = image();
    expect(n.width).toBeCloseTo(120);
    expect(n.crop).toMatchObject({ x: 30, y: 0, width: 120, height: 100 });
    expect(sourceAt([150, 80])).toEqual(before);
    expect(n.transform[4]).toBeCloseTo(80);
    expect(getState().docs[0].history.past.at(-1)?.label).toBe('Crop image');
  });

  it('grabs a frame edge anywhere along it', () => {
    startCrop();
    drag(cropTool, [250, 70], [220, 70]); // right edge, well away from its middle handle
    expect(image().width).toBeCloseTo(170);
    expect(image().crop).toMatchObject({ x: 0, width: 170 });
  });

  it('dragging inside slides the picture under the frame', () => {
    startCrop();
    drag(cropTool, [250, 100], [150, 100]);
    drag(cropTool, [100, 100], [60, 100]);
    expect(image().crop).toMatchObject({ x: 40, width: 100 });
    // The frame stays where it was.
    expect(image().transform[4]).toBe(50);
    drag(cropTool, [100, 100], [-400, 100]);
    expect(image().crop!.x).toBe(100);
  });

  it('crops a rotated image along its own edges', () => {
    freshDoc();
    placeImage(multiply([1, 0, 0, 1, 200, 50], rotate(Math.PI / 2)));
    startCrop();
    // Rotated 90°: the image's right edge (local x = 200) is at world y = 250.
    const before = sourceAt([150, 100]);
    drag(cropTool, [150, 250], [150, 200]);
    expect(image().width).toBeCloseTo(150);
    expect(sourceAt([150, 100])[0]).toBeCloseTo(before[0]);
    expect(sourceAt([150, 100])[1]).toBeCloseTo(before[1]);
  });

  it('reset shows the whole picture again, in place', () => {
    startCrop();
    drag(cropTool, [50, 100], [100, 100]);
    const before = sourceAt([150, 80]);
    resetCrop();
    expect(image().crop).toBeUndefined();
    expect(image().width).toBeCloseTo(200);
    expect(image().transform[4]).toBeCloseTo(50);
    expect(sourceAt([150, 80])).toEqual(before);
  });

  it('a click away from the image finishes cropping', () => {
    startCrop();
    drag(cropTool, [380, 280], [380, 280]);
    expect(getState().croppingImage).toBeNull();
    expect(getState().docs[0].selection).toEqual([]);
  });

  it('selecting something else ends cropping; locked images cannot be cropped', () => {
    startCrop();
    select([]);
    expect(getState().croppingImage).toBeNull();
    mutate('Lock', (d) => void (d.artboards[0].children[0].locked = true));
    startCrop('nd_photo');
    expect(getState().croppingImage).toBeNull();
  });
});
