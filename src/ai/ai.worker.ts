import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { refineMask, stretch } from './mask';
import { U2NET_SIZE, u2netInput } from './preprocess';
import type { AiErrorCode, AiReply, AiRequest, BackgroundRequest, UpscaleRequest } from './protocol';
import {
  MODEL_SCALE,
  OVERLAP,
  TILE,
  planTiles,
  stitchAlpha,
  stitchTile,
  tileInput,
  type AiBackend,
} from './tiles';

/**
 * ONNX Runtime, off the main thread. Two engines, each imported only when first needed:
 *
 * - `onnxruntime-web/wasm` (14 MB wasm): background removal, and upscaling where WebGPU is absent.
 * - `onnxruntime-web/webgpu` (27 MB asyncify wasm): upscaling on WebGPU, with its own CPU fallback.
 *
 * No wasmPaths: these entry points reference their WebAssembly as module assets, so Vite emits them as
 * same-origin hashed files (works offline via the service worker, tells no CDN). GitHub Pages cannot send
 * COOP/COEP, so there is no SharedArrayBuffer and threads stay at one.
 */

type Ort = typeof import('onnxruntime-web/wasm');

interface Loaded {
  ort: Ort;
  session: InferenceSession;
  backend: AiBackend;
}

const scope = self as unknown as {
  postMessage(message: AiReply, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<AiRequest>) => void): void;
};

class LoadError extends Error {}

function configure(ort: Ort): Ort {
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
  return ort;
}

let wasmOrt: Promise<Ort> | null = null;
let gpuOrt: Promise<Ort> | null = null;

function engine(kind: AiBackend): Promise<Ort> {
  if (kind === 'wasm') {
    wasmOrt ??= import('onnxruntime-web/wasm').then(configure);
    wasmOrt.catch(() => (wasmOrt = null));
    return wasmOrt;
  }
  gpuOrt ??= (import('onnxruntime-web/webgpu') as Promise<Ort>).then(configure);
  gpuOrt.catch(() => (gpuOrt = null));
  return gpuOrt;
}

/** Sessions memoised as promises; a failed load is forgotten so the next attempt tries again. */
const sessions = new Map<string, Promise<Loaded>>();

function memo(key: string, make: () => Promise<Loaded>): Promise<Loaded> {
  let p = sessions.get(key);
  if (!p) {
    p = make();
    sessions.set(key, p);
    const attempt = p;
    attempt.catch(() => {
      if (sessions.get(key) === attempt) sessions.delete(key);
    });
  }
  return p;
}

/** Fetch the weights ourselves, so the download reports progress (and goes through the service worker). */
async function fetchModel(url: string, onProgress: (f: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const out = new Uint8Array(total);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) return new Uint8Array(await new Response(res.body).arrayBuffer());
    out.set(value, got);
    got += value.length;
    onProgress(got / total);
  }
  return got === total ? out : out.subarray(0, got);
}

async function createSession(kind: AiBackend, ep: AiBackend, model: Uint8Array): Promise<Loaded> {
  const ort = await engine(kind);
  const session = await ort.InferenceSession.create(model, {
    executionProviders: [ep],
    graphOptimizationLevel: 'all',
  });
  return { ort, session, backend: ep };
}

async function loading<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw new LoadError(err instanceof Error ? err.message : String(err));
  }
}

function backgroundSession(modelUrl: string, progress: (p: number) => void): Promise<Loaded> {
  return memo(`background:${modelUrl}`, () =>
    loading(async () => createSession('wasm', 'wasm', await fetchModel(modelUrl, progress))),
  );
}

function upscaleSession(modelUrl: string, wanted: AiBackend, progress: (p: number) => void): Promise<Loaded> {
  return memo(`upscale:${wanted}:${modelUrl}`, () =>
    loading(async () => {
      const model = await fetchModel(modelUrl, progress);
      if (wanted === 'webgpu' && 'gpu' in navigator) {
        try {
          return await createSession('webgpu', 'webgpu', model);
        } catch (err) {
          console.warn('[ai] WebGPU unavailable; upscaling on the CPU', err);
          // The WebGPU build is already here and carries its own CPU backend.
          return await createSession('webgpu', 'wasm', model);
        }
      }
      return createSession('wasm', 'wasm', model);
    }),
  );
}

async function removeBackground(req: BackgroundRequest, progress: (p: number) => void) {
  const { rgba, width, height } = req;
  const { ort, session } = await backgroundSession(req.modelUrl, (f) => progress(0.05 + 0.3 * f));
  progress(0.4);
  const size = U2NET_SIZE;
  const outputs = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', u2netInput(rgba, width, height, size), [
      1,
      3,
      size,
      size,
    ]),
  });
  // U²-Net emits seven maps; the fused prediction is the first.
  const fused = outputs[session.outputNames[0]] as Tensor;
  const data = fused.data as Float32Array;
  if (!data || data.length < size * size) throw new Error('the model returned no map');
  progress(0.8);
  const mask = refineMask(stretch(data, size * size), size, size, rgba, width, height);
  return { result: { mask }, transfer: [mask.buffer] };
}

async function upscale(req: UpscaleRequest, progress: (p: number) => void) {
  const { rgba, width, height, factor } = req;
  const { ort, session, backend } = await upscaleSession(req.modelUrl, req.backend, (f) => progress(0.1 * f));
  progress(0.1);
  const ow = width * factor;
  const oh = height * factor;
  const out = new Uint8ClampedArray(ow * oh * 4);
  const tiles = planTiles(width, height, TILE[backend], OVERLAP);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const result = await session.run({
      [inputName]: new ort.Tensor('float32', tileInput(rgba, width, t), [1, 3, t.sh, t.sw]),
    });
    const tensor = result[outputName] as Tensor;
    const [, , th, tw] = tensor.dims;
    if (tw !== t.sw * MODEL_SCALE || th !== t.sh * MODEL_SCALE) {
      throw new Error(`the model returned ${tw}×${th} for a ${t.sw}×${t.sh} tile`);
    }
    stitchTile(out, ow, tensor.data as Float32Array, t, factor);
    tensor.dispose();
    progress(0.1 + (0.9 * (i + 1)) / tiles.length);
  }
  stitchAlpha(out, rgba, width, height, factor);
  return { result: { rgba: out, width: ow, height: oh, backend }, transfer: [out.buffer] };
}

scope.addEventListener('message', async (event) => {
  const req = event.data;
  const { id } = req;
  let last = -1;
  const progress = (p: number) => {
    // Throttle to whole percent so a fast download does not flood the main thread.
    const pct = Math.floor(p * 100);
    if (pct === last) return;
    last = pct;
    scope.postMessage({ id, progress: pct / 100 });
  };
  try {
    progress(0);
    const { result, transfer } =
      req.kind === 'background' ? await removeBackground(req, progress) : await upscale(req, progress);
    scope.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    const code: AiErrorCode = err instanceof LoadError ? 'load' : 'run';
    scope.postMessage({ id, ok: false, code, error: err instanceof Error ? err.message : String(err) });
  }
});
