/**
 * The arithmetic around upscaling, kept apart from the model so it is tested without one: pixel caps, how a
 * picture is cut into overlapping tiles, and how each tile's result is stitched back (×4, or ×2 by halving).
 */

export type AiBackend = 'webgpu' | 'wasm';

/** Real-ESRGAN general x4v3 only has a ×4 head; ×2 is the same pass box-halved. */
export const MODEL_SCALE = 4;
/** Bigger tiles are faster per pixel on the GPU; smaller ones keep CPU progress moving. */
export const TILE: Record<AiBackend, number> = { webgpu: 256, wasm: 192 };
/** Real-ESRGAN's own tile padding is 10; a little more costs little and never shows. */
export const OVERLAP = 16;

/** Ceiling on the result: four bytes a pixel, held a couple of times on the way out. */
export const MAX_OUTPUT_PIXELS = 16e6;
/** Ceiling on the input per backend. The CPU runs at roughly 15 s per 512² tile. */
export const MAX_INPUT_PIXELS: Record<AiBackend, number> = { webgpu: 4e6, wasm: 1e6 };

/** Largest input (in pixels) that may be upscaled by `factor` on `backend`. */
export function maxInputPixels(backend: AiBackend, factor: 2 | 4 = 2): number {
  return Math.min(MAX_INPUT_PIXELS[backend], Math.floor(MAX_OUTPUT_PIXELS / (factor * factor)));
}

export interface Tile {
  /** The region read from the source, overlap included. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Where the clean region starts within that read, and its size. */
  ox: number;
  oy: number;
  ow: number;
  oh: number;
  /** Where the clean region lands in the source picture. */
  dx: number;
  dy: number;
}

/** Tiles of `tile` px, each read with `overlap` px of its neighbours; only the clean middle is kept. */
export function planTiles(width: number, height: number, tile: number, overlap: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const ow = Math.min(tile, width - x);
      const oh = Math.min(tile, height - y);
      const sx = Math.max(0, x - overlap);
      const sy = Math.max(0, y - overlap);
      const ex = Math.min(width, x + ow + overlap);
      const ey = Math.min(height, y + oh + overlap);
      tiles.push({ sx, sy, sw: ex - sx, sh: ey - sy, ox: x - sx, oy: y - sy, ow, oh, dx: x, dy: y });
    }
  }
  return tiles;
}

/** The tile's read region as NCHW float RGB in 0..1 (alpha dropped; it is resampled separately). */
export function tileInput(rgba: ArrayLike<number>, width: number, t: Tile): Float32Array {
  const plane = t.sw * t.sh;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < t.sh; y++) {
    for (let x = 0; x < t.sw; x++) {
      const s = ((t.sy + y) * width + t.sx + x) * 4;
      const p = y * t.sw + x;
      out[p] = rgba[s] / 255;
      out[plane + p] = rgba[s + 1] / 255;
      out[2 * plane + p] = rgba[s + 2] / 255;
    }
  }
  return out;
}

/** The clean middle of a ×4 tile result (NCHW, 0..1, (sw·4)×(sh·4)) as opaque RGBA bytes. */
export function tileClean(data: ArrayLike<number>, t: Tile): Uint8ClampedArray<ArrayBuffer> {
  const ow4 = t.sw * MODEL_SCALE;
  const plane = ow4 * t.sh * MODEL_SCALE;
  const cx = t.ox * MODEL_SCALE;
  const cy = t.oy * MODEL_SCALE;
  const cw = t.ow * MODEL_SCALE;
  const ch = t.oh * MODEL_SCALE;
  const rgba = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const row = (cy + y) * ow4 + cx;
    for (let x = 0; x < cw; x++) {
      const s = row + x;
      const d = (y * cw + x) * 4;
      rgba[d] = data[s] * 255;
      rgba[d + 1] = data[plane + s] * 255;
      rgba[d + 2] = data[2 * plane + s] * 255;
      rgba[d + 3] = 255;
    }
  }
  return rgba;
}

/** 2×2 box average. Odd trailing rows/columns are dropped. */
export function halveRgba(rgba: ArrayLike<number>, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const hw = w >> 1;
  const hh = h >> 1;
  const out = new Uint8ClampedArray(hw * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const a = (2 * y * w + 2 * x) * 4;
      const b = a + 4;
      const c = a + w * 4;
      const e = c + 4;
      const d = (y * hw + x) * 4;
      for (let k = 0; k < 4; k++)
        out[d + k] = (rgba[a + k] + rgba[b + k] + rgba[c + k] + rgba[e + k] + 2) >> 2;
    }
  }
  return out;
}

/** Copy a w×h RGBA block into `dst` (dstW wide) at (dx, dy). */
export function blit(
  dst: Uint8ClampedArray,
  dstW: number,
  src: Uint8ClampedArray,
  w: number,
  h: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < h; y++) {
    dst.set(src.subarray(y * w * 4, (y + 1) * w * 4), ((dy + y) * dstW + dx) * 4);
  }
}

/** Write one tile's model output into the final picture (`outW` = source width × factor). */
export function stitchTile(
  out: Uint8ClampedArray,
  outW: number,
  data: ArrayLike<number>,
  t: Tile,
  factor: 2 | 4,
): void {
  const clean = tileClean(data, t);
  const cw = t.ow * MODEL_SCALE;
  const ch = t.oh * MODEL_SCALE;
  if (factor === MODEL_SCALE) blit(out, outW, clean, cw, ch, t.dx * 4, t.dy * 4);
  else blit(out, outW, halveRgba(clean, cw, ch), cw / 2, ch / 2, t.dx * 2, t.dy * 2);
}

/**
 * Carry the source's alpha into the result (bilinear). The model is RGB only; returns false and leaves the
 * result opaque when the source has no transparency.
 */
export function stitchAlpha(
  out: Uint8ClampedArray,
  src: ArrayLike<number>,
  w: number,
  h: number,
  factor: number,
): boolean {
  let opaque = true;
  for (let i = 3; i < w * h * 4; i += 4) {
    if (src[i] !== 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) return false;
  const ow = w * factor;
  const oh = h * factor;
  for (let y = 0; y < oh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < ow; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[(y0 * w + x0) * 4 + 3];
      const b = src[(y0 * w + x1) * 4 + 3];
      const c = src[(y1 * w + x0) * 4 + 3];
      const d = src[(y1 * w + x1) * 4 + 3];
      const top = a + (b - a) * tx;
      out[(y * ow + x) * 4 + 3] = top + (c + (d - c) * tx - top) * ty;
    }
  }
  return true;
}
