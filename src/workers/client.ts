// src/workers/client.ts
// Main-thread typed wrapper around the parser worker (design §3.3): lazy Worker creation, the hello/ready
// handshake, request ids, and an event subscription. Holds no statement data; the PDF bytes are transferred.

import type { WorkerEvent, WorkerRequest } from '../parser/protocol';
import { PROTOCOL_VERSION } from '../parser/protocol';
import type { ParseError } from '../parser/types';
import { uiErrorKey } from '../parser/types';

export interface OpenOptions {
  source: 'user' | 'sample';
  password?: string;
  fileSizeBytes: number;
}

export type ClientListener = (event: WorkerEvent) => void;

export interface CasParserClient {
  /** Resolves once the worker has loaded pdfjs; rejects with a WORKER_CRASH ParseError after the timeout. */
  ready: Promise<{ pdfjsVersion: string }>;
  /** Starts parsing; the buffer is transferred and becomes detached on the caller's side. Returns the requestId. */
  open(bytes: ArrayBuffer, opts: OpenOptions): string;
  password(requestId: string, password: string): void;
  cancel(requestId: string): void;
  /** cancel + reset; resolves on reset-done (or after a short grace period). The caller then calls terminate(). */
  reset(): Promise<void>;
  terminate(): void;
  on(listener: ClientListener): () => void;
}

export interface CreateClientOptions {
  readyTimeoutMs?: number;
  /** Test seam: supply a Worker-like object instead of constructing the real worker. */
  workerFactory?: () => WorkerLike;
}

export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerEvent }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('../parser/pdfWorker.ts', import.meta.url), { type: 'module', name: 'sip-lens-parser' }) as unknown as WorkerLike;
}

const crash = (): ParseError => ({ code: 'WORKER_CRASH', message: uiErrorKey('WORKER_CRASH') });

export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createClient(options: CreateClientOptions = {}): CasParserClient {
  const worker = (options.workerFactory ?? defaultWorkerFactory)();
  const listeners = new Set<ClientListener>();
  let activeRequestId: string | null = null;
  let terminated = false;
  let resolveReset: (() => void) | null = null;

  const emit = (event: WorkerEvent) => { for (const l of [...listeners]) l(event); };

  const ready = new Promise<{ pdfjsVersion: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(crash()), options.readyTimeoutMs ?? 10_000);
    const onReady = (event: WorkerEvent) => {
      if (event.type === 'ready') {
        clearTimeout(timer);
        listeners.delete(onReady);
        resolve({ pdfjsVersion: event.pdfjsVersion });
      }
    };
    listeners.add(onReady);
  });
  ready.catch(() => undefined);

  worker.onmessage = (event) => {
    const msg = event.data;
    if ('requestId' in msg && msg.requestId && activeRequestId && msg.requestId !== activeRequestId) return; // late event from a cancelled request
    if (msg.type === 'result' || msg.type === 'error' || msg.type === 'cancelled') {
      if ('requestId' in msg && msg.requestId === activeRequestId) activeRequestId = null;
    }
    if (msg.type === 'reset-done' && resolveReset) { resolveReset(); resolveReset = null; }
    emit(msg);
  };
  const onCrash = () => {
    if (terminated) return;
    const requestId = activeRequestId ?? '';
    activeRequestId = null;
    emit({ type: 'error', requestId, error: crash() });
    client.terminate();
  };
  worker.onerror = onCrash;
  if ('onmessageerror' in worker) worker.onmessageerror = onCrash;

  worker.postMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION });

  const client: CasParserClient = {
    ready,
    open(bytes, opts) {
      const requestId = newRequestId();
      activeRequestId = requestId;
      const msg: WorkerRequest = { type: 'open', requestId, bytes, source: opts.source, fileSizeBytes: opts.fileSizeBytes };
      if (opts.password !== undefined) msg.password = opts.password;
      worker.postMessage(msg, [bytes]);
      return requestId;
    },
    password(requestId, password) {
      worker.postMessage({ type: 'password', requestId, password });
    },
    cancel(requestId) {
      worker.postMessage({ type: 'cancel', requestId });
    },
    reset() {
      if (terminated) return Promise.resolve();
      if (activeRequestId) worker.postMessage({ type: 'cancel', requestId: activeRequestId });
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => { resolveReset = null; resolve(); }, 2_000);
        resolveReset = () => { clearTimeout(timer); resolve(); };
        worker.postMessage({ type: 'reset' });
      });
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      listeners.clear();
    },
    on(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return client;
}
