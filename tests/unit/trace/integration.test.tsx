import * as T from '@radix-ui/react-tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mutate, getState, select, undo } from '../../../src/state/store';
import { COMMANDS } from '../../../src/state/commands';
import { placeTrace, selectedImage, openTrace } from '../../../src/state/trace';
import { applyMask, hasTransparency, traceSize, traceToGroup } from '../../../src/trace/nodes';
import { setTraceWorkerFactory, stopTrace, trace } from '../../../src/trace/client';
import { tracePreset } from '../../../src/trace/presets';
import type { TraceReply, TraceRequest } from '../../../src/trace/client';
import type { ImageNode, PathShape } from '../../../src/core/types';
import { children, freshDoc } from '../helpers';
import { box, disc, picture } from './fixtures';

const scene = picture(
  120,
  80,
  [250, 248, 240, 255],
  [disc(35, 40, 22, [220, 40, 60, 255]), box(70, 15, 110, 65, [30, 90, 200, 255])],
);

vi.mock('../../../src/trace/nodes', async (orig) => ({
  ...(await orig<typeof import('../../../src/trace/nodes')>()),
  imagePixels: vi.fn(async () => scene),
}));

function addImage(): ImageNode {
  const img: ImageNode = {
    id: 'nd_photo',
    name: 'Photo',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: [1, 0, 0, 1, 40, 30],
    appearance: { items: [] },
    type: 'image',
    asset: 'assets/p.png',
    width: 240,
    height: 160,
  };
  mutate('Place', (d) => {
    d.assets['assets/p.png'] = 'data:image/png;base64,AAAA';
    d.artboards[0].children.push(img);
  });
  select([img.id]);
  return img;
}

afterEach(() => {
  setTraceWorkerFactory(null);
});

describe('trace results in the document', () => {
  it('scales paths onto the image box, one even-odd path per color', async () => {
    const r = await trace(scene, tracePreset('logo').options);
    const g = traceToGroup(r, { width: 240, height: 160, transform: [1, 0, 0, 1, 5, 6], name: 'Photo' });
    expect(g.name).toBe('Photo (traced)');
    expect(g.transform).toEqual([1, 0, 0, 1, 5, 6]);
    const paths = g.children as PathShape[];
    expect(paths).toHaveLength(r.layers.length);
    expect(paths.every((p) => p.fillRule === 'evenodd' && p.appearance.items[0].kind === 'fill')).toBe(true);
    const xs = paths[0].subpaths.flatMap((s) => s.nodes.map((n) => n.x));
    expect(Math.max(...xs)).toBe(240);
    expect(paths[0].name).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('sizes work under the pixel budget and handles alpha', () => {
    expect(traceSize(4000, 3000, 1_200_000)).toEqual({ width: 1265, height: 949 });
    expect(traceSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(hasTransparency(scene)).toBe(false);
    const cut = applyMask(scene, new Uint8ClampedArray(120 * 80));
    expect(hasTransparency(cut)).toBe(true);
    expect(scene.data[3]).toBe(255);
  });

  it('replaces the image, or keeps it hidden underneath, in one undo step', async () => {
    freshDoc();
    const img = addImage();
    expect(selectedImage()?.id).toBe(img.id);
    const r = await trace(scene, tracePreset('logo').options);
    placeTrace(img.id, traceToGroup(r, img), false);
    expect(children().map((n) => n.type)).toEqual(['group']);
    expect(getState().docs[0].selection).toEqual([children()[0].id]);
    undo();
    expect(children().map((n) => n.type)).toEqual(['image']);
    placeTrace(img.id, traceToGroup(r, img), true);
    expect(children().map((n) => [n.type, n.visible])).toEqual([
      ['image', false],
      ['group', true],
    ]);
  });

  it('offers Trace image only for a single selected image', () => {
    freshDoc();
    const cmd = COMMANDS.find((c) => c.id === 'object.traceImage')!;
    expect(cmd.enabled!()).toBe(false);
    const img = addImage();
    expect(cmd.enabled!()).toBe(true);
    cmd.run();
    expect(getState().dialog).toBe('trace');
    expect(getState().dialogArg).toBe(img.id);
  });
});

describe('trace worker client', () => {
  type Fake = {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((e: MessageEvent<TraceReply>) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
  };
  const fakes: Fake[] = [];
  const install = () => {
    fakes.length = 0;
    setTraceWorkerFactory(() => {
      const f: Fake = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
      fakes.push(f);
      return f as never;
    });
  };
  const reply = (f: Fake, m: TraceReply) => f.onmessage?.({ data: m } as MessageEvent<TraceReply>);
  const lastId = (f: Fake) => (f.postMessage.mock.calls.at(-1)![0] as TraceRequest).id;

  it('posts a copy of the pixels and resolves with the result', async () => {
    install();
    const progress: number[] = [];
    const p = trace(scene, tracePreset('logo').options, { onProgress: (v) => progress.push(v) });
    const [req, transfer] = fakes[0].postMessage.mock.calls[0] as [TraceRequest, ArrayBuffer[]];
    expect(req.image.data).not.toBe(scene.data);
    expect(transfer).toEqual([req.image.data.buffer]);
    reply(fakes[0], { id: req.id, progress: 0.5 });
    const result = { width: 1, height: 1, layers: [], nodes: 0 };
    reply(fakes[0], { id: req.id, ok: true, result });
    await expect(p).resolves.toEqual(result);
    expect(progress).toEqual([0.5]);
  });

  it('restarts the worker when a newer trace replaces a running one', async () => {
    install();
    const first = trace(scene, tracePreset('logo').options);
    const second = trace(scene, tracePreset('photo').options);
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(fakes[0].terminate).toHaveBeenCalled();
    reply(fakes[1], {
      id: lastId(fakes[1]),
      ok: true,
      result: { width: 1, height: 1, layers: [], nodes: 0 },
    });
    await expect(second).resolves.toBeTruthy();
  });

  it('stops on abort and reports worker errors', async () => {
    install();
    const ctrl = new AbortController();
    const p = trace(scene, tracePreset('logo').options, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const q = trace(scene, tracePreset('logo').options);
    reply(fakes[1], { id: lastId(fakes[1]), ok: false, error: 'Out of memory' });
    await expect(q).rejects.toThrow('Out of memory');
    stopTrace();
  });
});

describe('Trace dialog', () => {
  it('previews live and places the traced group', async () => {
    freshDoc();
    addImage();
    openTrace();
    const { TraceDialog } = await import('../../../src/ui/trace/TraceDialog');
    render(
      <T.Provider>
        <TraceDialog />
      </T.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('trace-stats')).toHaveTextContent(/\d+ colors/), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByRole('radio', { name: /Logo/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'B&W' }));
    await waitFor(() => expect(screen.getByTestId('trace-stats')).toHaveTextContent(/^1 color ·/), {
      timeout: 3000,
    });
    expect(screen.getByRole('checkbox', { name: 'Auto' })).toBeChecked();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trace' }));
    });
    await waitFor(() => expect(getState().dialog).toBe(null));
    const g = children()[0];
    expect(g.type).toBe('group');
    expect(g.type === 'group' && g.children).toHaveLength(1);
  });
});
