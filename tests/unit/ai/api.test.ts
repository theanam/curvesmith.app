import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MODELS,
  TOO_LARGE_MESSAGE,
  aiSupported,
  isModelReady,
  maxUpscaleInput,
  removeBackground,
  setWorkerFactoryForTests,
  upscale,
} from '../../../src/ai';
import { FakeWorker } from './fake-worker';

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

function image(w: number, h: number): ImageData {
  return new FakeImageData(new Uint8ClampedArray(w * h * 4), w, h) as unknown as ImageData;
}

/** Answer every request the latest fake worker gets, asynchronously. */
function autoReply(result: (msg: any) => unknown): void {
  setWorkerFactoryForTests(() => {
    const w = new FakeWorker();
    const post = w.postMessage.bind(w);
    w.postMessage = (message: any, transfer: Transferable[]) => {
      post(message, transfer);
      queueMicrotask(() => {
        w.reply({ id: message.id, progress: 0.5 });
        w.reply({ id: message.id, ok: true, result: result(message) });
      });
    };
    return w;
  });
}

describe('src/ai public API', () => {
  beforeEach(() => {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('ImageData', FakeImageData);
    setWorkerFactoryForTests(() => new FakeWorker());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists both models with real sizes and licences', () => {
    expect(AI_MODELS.background).toMatchObject({ bytes: 2_373_690, license: 'Apache-2.0' });
    expect(AI_MODELS.upscale).toMatchObject({ bytes: 4_866_428, license: 'BSD-3-Clause' });
    expect(AI_MODELS.background.engineBytes).toBeGreaterThan(10e6);
  });

  it('is supported with WebAssembly and Worker', () => {
    expect(aiSupported()).toBe(true);
    vi.stubGlobal('Worker', undefined);
    expect(aiSupported()).toBe(false);
  });

  it('removeBackground sends a copy of the pixels and returns the mask', async () => {
    autoReply((msg) => ({ mask: new Uint8ClampedArray(msg.width * msg.height).fill(7) }));
    const img = image(3, 2);
    const progress = vi.fn();
    const mask = await removeBackground(img, { onProgress: progress });
    expect(mask.length).toBe(6);
    expect(mask[0]).toBe(7);
    expect(progress).toHaveBeenCalledWith(0.5);
    const sent = FakeWorker.all[0].posted[0];
    expect(sent.message).toMatchObject({ kind: 'background', width: 3, height: 2 });
    expect(sent.message.modelUrl).toMatch(/\/models\/u2netp\.onnx$/);
    expect(sent.message.rgba).not.toBe(img.data);
    expect(sent.transfer).toEqual([sent.message.rgba.buffer]);
  });

  it('upscale returns an ImageData of the scaled size and the backend used', async () => {
    autoReply((msg) => ({
      rgba: new Uint8ClampedArray(msg.width * msg.factor * msg.height * msg.factor * 4),
      width: msg.width * msg.factor,
      height: msg.height * msg.factor,
      backend: 'wasm',
    }));
    const { image: out, backend } = await upscale(image(10, 6), 2);
    expect([out.width, out.height]).toEqual([20, 12]);
    expect(backend).toBe('wasm');
    expect(FakeWorker.all[0].posted[0].message).toMatchObject({
      kind: 'upscale',
      factor: 2,
      backend: 'wasm',
    });
  });

  it('refuses images over the pixel cap before starting a worker', async () => {
    const cap = maxUpscaleInput('wasm', 2);
    await expect(upscale(image(cap + 1, 1), 2)).rejects.toThrow(TOO_LARGE_MESSAGE);
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('turns a load failure into a friendly message', async () => {
    setWorkerFactoryForTests(() => {
      const w = new FakeWorker();
      w.postMessage = (message: any) =>
        queueMicrotask(() => w.reply({ id: message.id, ok: false, code: 'load', error: 'HTTP 404' }));
      return w;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(removeBackground(image(2, 2))).rejects.toThrow(
      'Could not load the background model. Check your connection and try again.',
    );
  });

  it('isModelReady checks the cache for the model and its engine', async () => {
    const stored = new Set<string>();
    vi.stubGlobal('caches', { match: vi.fn(async (url: string) => (stored.has(url) ? {} : undefined)) });
    expect(await isModelReady('background')).toBe(false);

    stored.add(new URL('/models/u2netp.onnx', location.href).href);
    expect(await isModelReady('background')).toBe(false); // engine still missing

    const urls = (caches.match as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const engine = urls.find((u) => /ort-wasm-simd-threaded[^/]*\.wasm/.test(u));
    expect(engine).toBeDefined();
    stored.add(engine!);
    expect(await isModelReady('background')).toBe(true);
    expect(await isModelReady('upscale')).toBe(false);
  });

  it('isModelReady is true once a model has run, and false without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await isModelReady('background')).toBe(false);
    autoReply(() => ({ mask: new Uint8ClampedArray(1) }));
    await removeBackground(image(1, 1));
    expect(await isModelReady('background')).toBe(true);
  });
});
