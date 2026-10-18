import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setPathKit, type PathKit } from '../../src/core/booleans';

const require = createRequire(import.meta.url);
const init = require('pathkit-wasm/bin/pathkit.js');
const wasmBinary = readFileSync(require.resolve('pathkit-wasm/bin/pathkit.wasm'));
setPathKit((await init({ wasmBinary })) as PathKit);

// jsdom has no layout or canvas: give components the bits they touch.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as never;
Element.prototype.scrollIntoView ??= () => undefined;
if (!globalThis.DOMMatrix) (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = class {};

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());
