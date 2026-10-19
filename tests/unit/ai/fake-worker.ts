import type { WorkerLike } from '../../../src/ai/client';
import type { AiReply } from '../../../src/ai/protocol';

/** A stand-in Worker: records posts and lets the test reply. */
export class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  posted: { message: any; transfer: Transferable[] }[] = [];
  terminated = false;
  private listeners: Record<string, ((e: any) => void)[]> = {};
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: unknown, transfer: Transferable[]): void {
    this.posted.push({ message, transfer });
  }
  addEventListener(type: string, listener: (e: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: AiReply): void {
    for (const l of this.listeners.message ?? []) l({ data } as MessageEvent);
  }
  crash(): void {
    for (const l of this.listeners.error ?? []) l(new Event('error'));
  }
  get lastId(): number {
    return this.posted[this.posted.length - 1].message.id;
  }
}
