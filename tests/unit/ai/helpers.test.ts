import { describe, expect, it } from 'vitest';
import { IMAGENET_MEAN, IMAGENET_STD, U2NET_SIZE, resizeRgba, u2netInput } from '../../../src/ai/preprocess';
import { boxBlur, guidedFilter, luminance, refineMask, resizePlane, stretch } from '../../../src/ai/mask';
import {
  MAX_OUTPUT_PIXELS,
  MODEL_SCALE,
  halveRgba,
  maxInputPixels,
  planTiles,
  stitchAlpha,
  stitchTile,
  tileClean,
  tileInput,
} from '../../../src/ai/tiles';

function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4);
  return out;
}

/** Dark disc on a light background. */
function disc(w: number, h: number): Uint8ClampedArray {
  const out = solid(w, h, [235, 235, 235, 255]);
  const r = Math.min(w, h) / 4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((x + 0.5 - w / 2) ** 2 + (y + 0.5 - h / 2) ** 2 < r * r)
        out.set([30, 30, 30, 255], (y * w + x) * 4);
  return out;
}

describe('preprocess', () => {
  it('resizes RGBA bilinearly and keeps flat colours exact', () => {
    const out = resizeRgba(solid(7, 5, [10, 20, 30, 255]), 7, 5, 3, 4);
    expect(out.length).toBe(3 * 4 * 4);
    for (let i = 0; i < 12; i++) expect([...out.subarray(i * 4, i * 4 + 4)]).toEqual([10, 20, 30, 255]);
  });

  it('interpolates between neighbours', () => {
    const src = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]);
    const out = resizeRgba(src, 2, 1, 4, 1);
    expect([out[0], out[4], out[8], out[12]]).toEqual([0, 50, 150, 200]);
  });

  it('builds a 1×3×320×320 tensor normalised with ImageNet mean and std', () => {
    const t = u2netInput(solid(40, 30, [255, 0, 128, 255]), 40, 30);
    const plane = U2NET_SIZE * U2NET_SIZE;
    expect(t.length).toBe(3 * plane);
    expect(t[0]).toBeCloseTo((1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 5);
    expect(t[plane + 123]).toBeCloseTo((0 - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 5);
    expect(t[2 * plane + plane - 1]).toBeCloseTo((128 / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 5);
  });

  it('reads transparent pixels as white', () => {
    const t = u2netInput(solid(4, 4, [0, 0, 0, 0]), 4, 4, 8);
    expect(t[0]).toBeCloseTo((1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 5);
  });
});

describe('mask', () => {
  it('stretches to the full 0–255 range', () => {
    expect([...stretch([0.2, 0.4, 0.6])]).toEqual([0, 128, 255]);
  });

  it('returns an empty mask for a flat map', () => {
    expect([...stretch(new Float32Array([0.5, 0.5, 0.5]))]).toEqual([0, 0, 0]);
  });

  it('resizes a plane to the requested size, interpolating bilinearly', () => {
    const out = resizePlane([0, 100], 2, 1, 4, 3);
    expect(out.length).toBe(12);
    expect([...out.subarray(0, 4)]).toEqual([0, 25, 75, 100]);
    expect([...out.subarray(8, 12)]).toEqual([0, 25, 75, 100]);
  });

  it('box blur keeps a constant and averages within the window', () => {
    expect([...boxBlur(new Float32Array([2, 2, 2, 2]), 2, 2, 3)]).toEqual([2, 2, 2, 2]);
    const out = boxBlur(new Float32Array([0, 0, 3, 0, 0]), 5, 1, 1);
    expect([...out]).toEqual([0, 1, 1, 1, 0]);
  });

  it('computes luminance in 0..1 with transparent as white', () => {
    const l = luminance(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]), 3, 1);
    expect(l[0]).toBeCloseTo(0);
    expect(l[1]).toBeCloseTo(1);
    expect(l[2]).toBeCloseTo(1);
  });

  it('guided filter snaps a blurry edge to the guide edge', () => {
    const w = 64;
    const guide = new Float32Array(w);
    const input = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      guide[x] = x < 32 ? 0 : 1;
      input[x] = Math.min(1, Math.max(0, (x - 20) / 24)); // soft ramp 20..44
    }
    const out = guidedFilter(guide, input, w, 1, 4);
    expect(out[26]).toBeLessThan(input[26]);
    expect(out[38]).toBeGreaterThan(input[38]);
  });

  it('refines a coarse map back to the picture size along the picture edges', () => {
    const w = 400;
    const h = 300;
    const rgba = disc(w, h);
    // Coarse 20×20 map that roughly marks the centre.
    const cw = 20;
    const coarse = new Uint8ClampedArray(cw * cw);
    for (let y = 0; y < cw; y++)
      for (let x = 0; x < cw; x++) coarse[y * cw + x] = (x - 9.5) ** 2 + (y - 9.5) ** 2 < 25 ? 255 : 0;
    const mask = refineMask(coarse, cw, cw, rgba, w, h);
    expect(mask.length).toBe(w * h);
    expect(mask[150 * w + 200]).toBeGreaterThan(200);
    expect(mask[10 * w + 10]).toBeLessThan(30);
  });

  it('never marks transparent pixels as foreground', () => {
    const rgba = solid(10, 10, [0, 0, 0, 0]);
    const mask = refineMask(new Uint8ClampedArray([255, 255, 255, 255]), 2, 2, rgba, 10, 10);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('refines very large pictures at a capped size and still returns full size', () => {
    const mask = refineMask(
      new Uint8ClampedArray([0, 255, 0, 255]),
      2,
      2,
      solid(2100, 50, [9, 9, 9, 255]),
      2100,
      50,
    );
    expect(mask.length).toBe(2100 * 50);
  });
});

describe('tiles', () => {
  it('covers the picture exactly once with clean regions', () => {
    const w = 700;
    const h = 300;
    const seen = new Uint8Array(w * h);
    for (const t of planTiles(w, h, 256, 16))
      for (let y = t.dy; y < t.dy + t.oh; y++) for (let x = t.dx; x < t.dx + t.ow; x++) seen[y * w + x]++;
    expect(seen.every((n) => n === 1)).toBe(true);
  });

  it('reads overlap on inner sides only', () => {
    const [first, second] = planTiles(700, 300, 256, 16);
    expect(first).toMatchObject({ sx: 0, sy: 0, sw: 272, sh: 272, ox: 0, oy: 0, ow: 256, oh: 256 });
    expect(second).toMatchObject({ sx: 240, sw: 288, ox: 16, ow: 256, dx: 256 });
    for (const t of planTiles(1000, 650, 128, 16)) {
      expect(t.ox + t.ow).toBeLessThanOrEqual(t.sw);
      expect(t.sx + t.ox).toBe(t.dx);
      expect(t.sy + t.oy).toBe(t.dy);
    }
  });

  it('is one tile for a small picture', () => {
    expect(planTiles(100, 80, 256, 16)).toEqual([
      { sx: 0, sy: 0, sw: 100, sh: 80, ox: 0, oy: 0, ow: 100, oh: 80, dx: 0, dy: 0 },
    ]);
  });

  it('extracts the read region as NCHW 0..1', () => {
    const rgba = new Uint8ClampedArray(3 * 2 * 4);
    rgba.set([255, 0, 51, 255], (1 * 3 + 2) * 4); // pixel (2,1)
    const [t] = planTiles(3, 2, 8, 0);
    const input = tileInput(rgba, 3, t);
    expect(input.length).toBe(18);
    expect(input[5]).toBe(1);
    expect(input[6 + 5]).toBe(0);
    expect(input[12 + 5]).toBeCloseTo(0.2);
  });

  /** A fake ×4 model output for a tile: the source pixel's value replicated 4×4 (nearest neighbour). */
  function fakeModel(
    rgba: Uint8ClampedArray,
    w: number,
    t: ReturnType<typeof planTiles>[number],
  ): Float32Array {
    const ow = t.sw * MODEL_SCALE;
    const oh = t.sh * MODEL_SCALE;
    const plane = ow * oh;
    const data = new Float32Array(3 * plane);
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        const s = ((t.sy + (y >> 2)) * w + t.sx + (x >> 2)) * 4;
        for (let c = 0; c < 3; c++) data[c * plane + y * ow + x] = rgba[s + c] / 255;
      }
    return data;
  }

  function gradient(w: number, h: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) rgba.set([x % 256, y % 256, (x + y) % 256, 255], (y * w + x) * 4);
    return rgba;
  }

  it.each([4, 2] as const)('stitches overlapping tiles seamlessly at ×%i', (factor) => {
    const w = 37;
    const h = 23;
    const src = gradient(w, h);
    const ow = w * factor;
    const out = new Uint8ClampedArray(ow * h * factor * 4);
    for (const t of planTiles(w, h, 10, 3)) stitchTile(out, ow, fakeModel(src, w, t), t, factor);
    for (let y = 0; y < h * factor; y++)
      for (let x = 0; x < ow; x++) {
        const s = (Math.floor(y / factor) * w + Math.floor(x / factor)) * 4;
        const d = (y * ow + x) * 4;
        expect([out[d], out[d + 1], out[d + 2], out[d + 3]]).toEqual([src[s], src[s + 1], src[s + 2], 255]);
      }
  });

  it('takes only the clean middle of a tile result', () => {
    const [, second] = planTiles(20, 4, 10, 2);
    const data = new Float32Array(3 * second.sw * 4 * second.sh * 4).fill(0.5);
    const clean = tileClean(data, second);
    expect(clean.length).toBe(second.ow * 4 * second.oh * 4 * 4);
    expect(clean[0]).toBe(128);
  });

  it('halves with a rounded 2×2 box average', () => {
    const src = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255, 20, 20, 20, 255, 32, 32, 32, 255]);
    expect([...halveRgba(src, 2, 2)]).toEqual([16, 16, 16, 255]);
    expect(halveRgba(new Uint8ClampedArray(5 * 3 * 4), 5, 3).length).toBe(2 * 1 * 4);
  });

  it('carries alpha into the result only when the source has some', () => {
    const out = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    expect(stitchAlpha(out, solid(2, 2, [1, 2, 3, 255]), 2, 2, 2)).toBe(false);
    const src = solid(2, 2, [1, 2, 3, 0]);
    expect(stitchAlpha(out, src, 2, 2, 2)).toBe(true);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(0);
  });

  it('caps input pixels by backend and output size', () => {
    expect(maxInputPixels('webgpu', 2)).toBe(4e6);
    expect(maxInputPixels('webgpu', 4)).toBe(MAX_OUTPUT_PIXELS / 16);
    expect(maxInputPixels('wasm', 2)).toBe(1e6);
    expect(maxInputPixels('wasm', 4)).toBe(1e6);
    expect(maxInputPixels('wasm')).toBeLessThan(maxInputPixels('webgpu'));
  });
});
