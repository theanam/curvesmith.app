import type { AiErrorCode, AiReply, AiRequest } from './protocol';

/**
 * Main-thread side of the AI worker: request ids, progress, a silence timeout, cancellation. Knows nothing
 * about the models; the worker factory is injected so the protocol is tested with a fake.
 */

export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

/** Shown in toasts, so short and plain. */
export interface FriendlyMessages {
  load: string;
  run: string;
}

export const TIMEOUT_MESSAGE = 'The AI model stopped responding. Try again.';
export const INTERRUPTED_MESSAGE = 'The AI task was interrupted. Try again.';

/** Long enough for a first engine download on a slow line; progress resets it, so a hang is still caught. */
export const SILENCE_TIMEOUT_MS = 180_000;

export interface RequestOptions {
  signal?: AbortSignal;
  onProgress?(p: number): void;
  messages: FriendlyMessages;
}

type Payload = AiRequest extends infer R ? (R extends AiRequest ? Omit<R, 'id'> : never) : never;

interface Pending {
  resolve(value: unknown): void;
  reject(err: unknown): void;
  options: RequestOptions;
  timer: ReturnType<typeof setTimeout> | undefined;
  cleanup(): void;
}

export function abortError(): Error {
  return typeof DOMException === 'function'
    ? new DOMException('Cancelled', 'AbortError')
    : Object.assign(new Error('Cancelled'), { name: 'AbortError' });
}

export class AiClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly create: () => WorkerLike,
    private readonly timeoutMs = SILENCE_TIMEOUT_MS,
  ) {}

  request<T>(payload: Payload, transfer: Transferable[], options: RequestOptions): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    const worker = this.ensure();
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.settle(id, abortError());
        // The only way to stop a running inference is to drop the worker; anything else in flight goes too.
        this.reset(INTERRUPTED_MESSAGE);
      };
      const entry: Pending = {
        resolve: resolve as (v: unknown) => void,
        reject,
        options,
        timer: undefined,
        cleanup: () => options.signal?.removeEventListener('abort', onAbort),
      };
      this.pending.set(id, entry);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.arm(id);
      worker.postMessage({ ...payload, id }, transfer);
    });
  }

  /** Terminate the worker (sessions are dropped); pending requests are rejected. */
  dispose(): void {
    this.reset(INTERRUPTED_MESSAGE);
  }

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.create();
    worker.addEventListener('message', (event: MessageEvent) => {
      if (this.worker === worker) this.onReply(event.data as AiReply);
    });
    worker.addEventListener('error', (event: Event) => {
      if (this.worker !== worker) return;
      // A worker that fails to start (its chunk did not load, say) is a load failure for everything queued.
      event.preventDefault?.();
      for (const [id, p] of [...this.pending]) this.settle(id, new Error(p.options.messages.load));
      this.drop();
    });
    this.worker = worker;
    return worker;
  }

  private onReply(reply: AiReply): void {
    const p = this.pending.get(reply.id);
    if (!p) return;
    if ('progress' in reply) {
      this.arm(reply.id);
      p.options.onProgress?.(reply.progress);
      return;
    }
    if (reply.ok) this.settle(reply.id, null, reply.result);
    else {
      console.warn(`[ai] ${reply.code} error:`, reply.error);
      this.settle(reply.id, new Error(friendly(reply.code, p.options.messages)));
    }
  }

  private arm(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      this.settle(id, new Error(TIMEOUT_MESSAGE));
      this.reset(INTERRUPTED_MESSAGE);
    }, this.timeoutMs);
  }

  private settle(id: number, err: unknown, value?: unknown): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.cleanup();
    if (err) p.reject(err);
    else p.resolve(value);
  }

  private reset(message: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, new Error(message));
    this.drop();
  }

  private drop(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function friendly(code: AiErrorCode, messages: FriendlyMessages): string {
  return code === 'load' ? messages.load : messages.run;
}
