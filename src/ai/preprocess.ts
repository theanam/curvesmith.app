/**
 * Turning pixels into the tensors the models expect. Pure functions, so they are tested without ONNX Runtime.
 */

/** U²-Netp's fixed input edge. */
export const U2NET_SIZE = 320;

/** ImageNet statistics, which is what U²-Net was trained against. */
export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

/** Bilinear resample of an RGBA buffer (pixel centres aligned, edges clamped). */
export function resizeRgba(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(dw * dh * 4);
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
      const a = (y0 * sw + x0) * 4;
      const b = (y0 * sw + x1) * 4;
      const c = (y1 * sw + x0) * 4;
      const d = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = src[a + k] + (src[b + k] - src[a + k]) * tx;
        const bottom = src[c + k] + (src[d + k] - src[c + k]) * tx;
        out[o + k] = top + (bottom - top) * ty;
      }
    }
  }
  return out;
}

/**
 * U²-Netp input: the picture squashed to 320×320, composited over white (transparent areas read as
 * background), then NCHW float normalised with ImageNet mean and std.
 */
export function u2netInput(rgba: ArrayLike<number>, w: number, h: number, size = U2NET_SIZE): Float32Array {
  const small = resizeRgba(rgba, w, h, size, size);
  const plane = size * size;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const a = small[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const v = (small[i * 4 + c] * a + 255 * (1 - a)) / 255;
      input[c * plane + i] = (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return input;
}
