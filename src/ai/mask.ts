import { resizeRgba } from './preprocess';

/**
 * Post-processing for the background model: stretch the coarse 320×320 map to the full range, then bring it
 * back to the picture's size and re-cut its edges along the picture's own (guided filter, ported from 35mm).
 */

/** Longest edge the guided filter runs at; bigger pictures are refined at this size and resampled. */
export const REFINE_MAX_EDGE = 1024;
/** Regularisation: low, so fine structure in the picture is followed. */
export const REFINE_EPS = 1e-4;

/** Min/max stretch to 0–255 (U²-Net's own post-processing). A flat map comes back empty. */
export function stretch(data: ArrayLike<number>, n = data.length): Uint8ClampedArray<ArrayBuffer> {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const out = new Uint8ClampedArray(n);
  if (!(span > 1e-6)) return out;
  for (let i = 0; i < n; i++) out[i] = Math.round(((data[i] - lo) / span) * 255);
  return out;
}

/** Bilinear resample of a single-channel plane; values are kept as they are. */
export function resizePlane(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] + (src[y0 * sw + x1] - src[y0 * sw + x0]) * tx;
      const bottom = src[y1 * sw + x0] + (src[y1 * sw + x1] - src[y1 * sw + x0]) * tx;
      out[y * dw + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** Luminance 0..1, composited over white so transparent areas read as background. */
export function luminance(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const n = w * h;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const y = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    out[i] = (y * a + 255 * (1 - a)) / 255;
  }
  return out;
}

/** Mean over a square window, as two sliding sums, normalised by the part of the window that fits. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x < Math.min(r + 1, w); x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < w) sum += src[row + x + r + 1];
      if (x - r >= 0) sum -= src[row + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(r + 1, h); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) sum -= tmp[(y - r) * w + x];
    }
  }
  return out;
}

/** Guided filter (He, Sun and Tang 2010): `input` re-cut along the edges of `guide`. Both 0..1, w×h. */
export function guidedFilter(
  guide: Float32Array,
  input: Float32Array,
  w: number,
  h: number,
  radius: number,
  eps = REFINE_EPS,
): Float32Array {
  const n = w * h;
  const gp = new Float32Array(n);
  const gg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gp[i] = guide[i] * input[i];
    gg[i] = guide[i] * guide[i];
  }
  const meanG = boxBlur(guide, w, h, radius);
  const meanP = boxBlur(input, w, h, radius);
  const meanGp = boxBlur(gp, w, h, radius);
  const meanGg = boxBlur(gg, w, h, radius);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varG = meanGg[i] - meanG[i] * meanG[i];
    a[i] = (meanGp[i] - meanG[i] * meanP[i]) / (varG + eps);
    b[i] = meanP[i] - a[i] * meanG[i];
  }
  const meanA = boxBlur(a, w, h, radius);
  const meanB = boxBlur(b, w, h, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = meanA[i] * guide[i] + meanB[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/** Guided-filter window radius for a refine map of this size (16 px at 1024). */
export function refineRadius(w: number, h: number): number {
  return Math.max(2, Math.round(Math.max(w, h) / 64));
}

/**
 * Coarse map (cw×ch, 0–255) plus the picture, in; a w×h foreground mask, out. Refined at no more than
 * REFINE_MAX_EDGE on the long edge, then resampled. Transparent pixels are never foreground.
 */
export function refineMask(
  coarse: ArrayLike<number>,
  cw: number,
  ch: number,
  rgba: ArrayLike<number>,
  w: number,
  h: number,
): Uint8ClampedArray<ArrayBuffer> {
  const scale = Math.min(1, REFINE_MAX_EDGE / Math.max(w, h));
  const ww = Math.max(1, Math.round(w * scale));
  const wh = Math.max(1, Math.round(h * scale));
  const guideRgba = scale < 1 ? resizeRgba(rgba, w, h, ww, wh) : rgba;
  const guide = luminance(guideRgba, ww, wh);
  const input = resizePlane(coarse, cw, ch, ww, wh);
  for (let i = 0; i < input.length; i++) input[i] /= 255;
  const refined = guidedFilter(guide, input, ww, wh, refineRadius(ww, wh));
  const full = scale < 1 ? resizePlane(refined, ww, wh, w, h) : refined;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(full[i] * rgba[i * 4 + 3]);
  return out;
}
