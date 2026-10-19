import wasmEngineUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import webgpuEngineUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { AiClient, abortError, type FriendlyMessages, type WorkerLike } from './client';
import { modelUrl, type AiModel } from './models';
import type { BackgroundResult, UpscaleResult } from './protocol';
import { maxInputPixels, type AiBackend } from './tiles';

/**
 * Optional local AI: background removal (U²-Netp) and upscaling (Real-ESRGAN x4v3), run with ONNX Runtime
 * Web in a module worker. Nothing is downloaded until a function here is first called. React-free.
 */

export { AI_MODELS, formatBytes, ENGINE_WASM_BYTES, ENGINE_WEBGPU_BYTES } from './models';
export type { AiModel, AiModelInfo } from './models';
export type { AiBackend } from './tiles';

const MESSAGES: Record<AiModel, FriendlyMessages> = {
  background: {
    load: 'Could not load the background model. Check your connection and try again.',
    run: 'Background removal failed. Try a smaller image.',
  },
  upscale: {
    load: 'Could not load the upscale model. Check your connection and try again.',
    run: 'Upscaling failed. Try a smaller image.',
  },
};

export const UNSUPPORTED_MESSAGE = 'AI tools need a browser with WebAssembly and Web Workers.';
export const TOO_LARGE_MESSAGE = 'Image is too large to upscale.';

export function aiSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function';
}

let client: AiClient | null = null;
let createWorker = (): WorkerLike =>
  new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module', name: 'curvesmith-ai' });

function getClient(): AiClient {
  client ??= new AiClient(createWorker);
  return client;
}

/** Drop the worker and its sessions (frees memory). The next call starts a fresh one. */
export function disposeAi(): void {
  client?.dispose();
  client = null;
}

/** Tests only: swap the worker factory. */
export function setWorkerFactoryForTests(factory: () => WorkerLike): void {
  disposeAi();
  createWorker = factory;
  warm.clear();
  probed = undefined;
  probing = null;
  persisted = false;
}

// ---- readiness ------------------------------------------------------------------------------------

const warm = new Set<AiModel>();
let persisted = false;

function markWarm(m: AiModel): void {
  warm.add(m);
  if (persisted) return;
  persisted = true;
  // Ask the browser not to evict the cached models under storage pressure. Best effort.
  void navigator.storage?.persist?.().catch(() => undefined);
}

function absolute(url: string): string {
  return new URL(url, self.location.href).href;
}

async function cached(url: string): Promise<boolean> {
  try {
    return Boolean(await caches.match(absolute(url)));
  } catch {
    return false;
  }
}

/** Whether the model and its engine are already on this machine, so the UI can skip the download prompt. */
export async function isModelReady(m: AiModel): Promise<boolean> {
  if (warm.has(m)) return true;
  if (typeof caches === 'undefined') return false;
  const engine = m === 'upscale' && (await probeBackend()) === 'webgpu' ? webgpuEngineUrl : wasmEngineUrl;
  const [model, runtime] = await Promise.all([cached(modelUrl(m)), cached(engine)]);
  return model && runtime;
}

// ---- backend --------------------------------------------------------------------------------------

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<object | null> } };

let probed: AiBackend | undefined;
let probing: Promise<AiBackend> | null = null;

/** WebGPU when this browser hands out an adapter (`navigator.gpu` alone proves nothing), else wasm. Cached. */
export function probeBackend(): Promise<AiBackend> {
  if (probed) return Promise.resolve(probed);
  probing ??= (async () => {
    try {
      const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter();
      probed = adapter ? 'webgpu' : 'wasm';
    } catch {
      probed = 'wasm';
    }
    return probed;
  })();
  return probing;
}

/**
 * Largest input, in pixels, that `upscale` accepts for `factor` (default 2). Without a backend it uses the
 * probed one, or the conservative wasm cap before the probe has answered.
 */
export function maxUpscaleInput(backend?: AiBackend, factor: 2 | 4 = 2): number {
  return maxInputPixels(backend ?? probed ?? 'wasm', factor);
}

// ---- operations -----------------------------------------------------------------------------------

export interface AiOptions {
  signal?: AbortSignal;
  onProgress?(p: number): void;
}

function check(img: ImageData): void {
  if (!aiSupported()) throw new Error(UNSUPPORTED_MESSAGE);
  if (!(img.width > 0 && img.height > 0)) throw new Error('Image is empty.');
}

/** Foreground mask (0–255 per pixel, same w×h as input), U²-Netp + min/max stretch + guided-filter refine. */
export async function removeBackground(img: ImageData, opts: AiOptions = {}): Promise<Uint8ClampedArray> {
  check(img);
  if (opts.signal?.aborted) throw abortError();
  // A copy goes to the worker, so the caller's ImageData stays usable.
  const rgba = new Uint8ClampedArray(img.data);
  const { mask } = await getClient().request<BackgroundResult>(
    { kind: 'background', modelUrl: modelUrl('background'), rgba, width: img.width, height: img.height },
    [rgba.buffer],
    { signal: opts.signal, onProgress: opts.onProgress, messages: MESSAGES.background },
  );
  markWarm('background');
  return mask;
}

/** ×4 (or ×2 = ×4 box-halved) Real-ESRGAN with tiling + overlap, WebGPU when available else wasm. */
export async function upscale(
  img: ImageData,
  factor: 2 | 4,
  opts: AiOptions = {},
): Promise<{ image: ImageData; backend: AiBackend }> {
  check(img);
  if (opts.signal?.aborted) throw abortError();
  const backend = await probeBackend();
  if (img.width * img.height > maxUpscaleInput(backend, factor)) throw new Error(TOO_LARGE_MESSAGE);
  const rgba = new Uint8ClampedArray(img.data);
  const result = await getClient().request<UpscaleResult>(
    {
      kind: 'upscale',
      modelUrl: modelUrl('upscale'),
      rgba,
      width: img.width,
      height: img.height,
      factor,
      backend,
    },
    [rgba.buffer],
    { signal: opts.signal, onProgress: opts.onProgress, messages: MESSAGES.upscale },
  );
  markWarm('upscale');
  return { image: new ImageData(result.rgba, result.width, result.height), backend: result.backend };
}
