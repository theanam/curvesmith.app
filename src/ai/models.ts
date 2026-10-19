/** Model catalogue: what each optional AI feature downloads, and from where. */

export type AiModel = 'background' | 'upscale';

export interface AiModelInfo {
  label: string;
  /** Weights, bytes (exact file size). */
  bytes: number;
  /** ONNX Runtime WebAssembly the model needs, bytes. Upscaling lists the WebGPU build, the larger of its two. */
  engineBytes: number;
  license: string;
  /** File under `public/models/`. */
  file: string;
}

/** onnxruntime-web 1.30.0: `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.asyncify.wasm`. */
export const ENGINE_WASM_BYTES = 14_239_897;
export const ENGINE_WEBGPU_BYTES = 26_781_914;

export const AI_MODELS: Record<AiModel, AiModelInfo> = {
  background: {
    label: 'Background removal (U²-Netp)',
    bytes: 2_373_690,
    engineBytes: ENGINE_WASM_BYTES,
    license: 'Apache-2.0',
    file: 'u2netp.onnx',
  },
  upscale: {
    label: 'Upscaling (Real-ESRGAN x4v3)',
    bytes: 4_866_428,
    engineBytes: ENGINE_WEBGPU_BYTES,
    license: 'BSD-3-Clause',
    file: 'realesr-general-x4v3.onnx',
  },
};

/** Same-origin model URL, resolved against the build's base path. */
export function modelUrl(m: AiModel): string {
  const base = new URL(import.meta.env.BASE_URL, self.location.href);
  return new URL(`models/${AI_MODELS[m].file}`, base).href;
}

/** "2.4 MB" style size for consent copy. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
