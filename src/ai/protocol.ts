import type { AiBackend } from './tiles';

/** Messages between `client.ts` and `ai.worker.ts`. */

export interface BackgroundRequest {
  kind: 'background';
  id: number;
  modelUrl: string;
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface UpscaleRequest {
  kind: 'upscale';
  id: number;
  modelUrl: string;
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  factor: 2 | 4;
  /** What the page believes is available; the worker falls back to wasm if WebGPU fails. */
  backend: AiBackend;
}

export type AiRequest = BackgroundRequest | UpscaleRequest;

export interface BackgroundResult {
  mask: Uint8ClampedArray<ArrayBuffer>;
}

export interface UpscaleResult {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  backend: AiBackend;
}

/** `load`: engine or weights could not be fetched or initialised. `run`: inference failed. */
export type AiErrorCode = 'load' | 'run';

export type AiReply =
  | { id: number; progress: number }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: AiErrorCode; error: string };
