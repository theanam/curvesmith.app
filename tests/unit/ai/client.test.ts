import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClient, INTERRUPTED_MESSAGE, TIMEOUT_MESSAGE } from '../../../src/ai/client';
import { FakeWorker } from './fake-worker';

const messages = { load: 'Could not load.', run: 'It failed.' };
const payload = {
  kind: 'background' as const,
  modelUrl: 'http://x/models/u2netp.onnx',
  rgba: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};

describe('AiClient', () => {
  let client: AiClient;
  beforeEach(() => {
    FakeWorker.all = [];
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    client = new AiClient(() => new FakeWorker(), 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts with an id and transferables, and resolves the matching reply', async () => {
    const buf = new ArrayBuffer(8);
    const a = client.request<{ n: number }>(payload, [buf], { messages });
    const b = client.request<{ n: number }>(payload, [], { messages });
    const w = FakeWorker.all[0];
    expect(FakeWorker.all).toHaveLength(1);
    expect(w.posted[0].transfer).toEqual([buf]);
    const [idA, idB] = w.posted.map((p) => p.message.id);
    expect(idA).not.toBe(idB);
    expect(w.posted[0].message).toMatchObject({ kind: 'background', width: 1 });
    w.reply({ id: idB, ok: true, result: { n: 2 } });
    w.reply({ id: idA, ok: true, result: { n: 1 } });
    await expect(a).resolves.toEqual({ n: 1 });
    await expect(b).resolves.toEqual({ n: 2 });
  });

  it('reports progress and ignores replies for other ids', async () => {
    const onProgress = vi.fn();
    const p = client.request(payload, [], { messages, onProgress });
    const w = FakeWorker.all[0];
    w.reply({ id: 999, ok: true, result: 'wrong' });
    w.reply({ id: w.lastId, progress: 0.5 });
    w.reply({ id: w.lastId, ok: true, result: 'right' });
    await expect(p).resolves.toBe('right');
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it('maps worker errors to friendly messages by code', async () => {
    const load = client.request(payload, [], { messages });
    const w = FakeWorker.all[0];
    w.reply({ id: w.lastId, ok: false, code: 'load', error: 'HTTP 404' });
    await expect(load).rejects.toThrow('Could not load.');
    const run = client.request(payload, [], { messages });
    w.reply({ id: w.lastId, ok: false, code: 'run', error: 'OOM' });
    await expect(run).rejects.toThrow('It failed.');
    expect(w.terminated).toBe(false);
  });

  it('times out after silence, terminates the worker and starts a new one next time', async () => {
    const p = client.request(payload, [], { messages });
    const w = FakeWorker.all[0];
    const settled = expect(p).rejects.toThrow(TIMEOUT_MESSAGE);
    vi.advanceTimersByTime(1001);
    await settled;
    expect(w.terminated).toBe(true);
    void client.request(payload, [], { messages }).catch(() => undefined);
    expect(FakeWorker.all).toHaveLength(2);
  });

  it('progress resets the silence timer', async () => {
    const p = client.request(payload, [], { messages });
    const w = FakeWorker.all[0];
    vi.advanceTimersByTime(800);
    w.reply({ id: w.lastId, progress: 0.1 });
    vi.advanceTimersByTime(800);
    w.reply({ id: w.lastId, ok: true, result: 1 });
    await expect(p).resolves.toBe(1);
    expect(w.terminated).toBe(false);
  });

  it('aborts: rejects with AbortError, terminates, and interrupts other requests', async () => {
    const ctrl = new AbortController();
    const p = client.request(payload, [], { messages, signal: ctrl.signal });
    const other = client.request(payload, [], { messages });
    const w = FakeWorker.all[0];
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await expect(other).rejects.toThrow(INTERRUPTED_MESSAGE);
    expect(w.terminated).toBe(true);
    // Late replies from the dead worker are ignored.
    w.reply({ id: 1, ok: true, result: 1 });
  });

  it('rejects at once for an already-aborted signal without starting a worker', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(client.request(payload, [], { messages, signal: ctrl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('a worker that fails to start rejects pending requests with the load message', async () => {
    const p = client.request(payload, [], { messages });
    FakeWorker.all[0].crash();
    await expect(p).rejects.toThrow('Could not load.');
    expect(FakeWorker.all[0].terminated).toBe(true);
  });
});
