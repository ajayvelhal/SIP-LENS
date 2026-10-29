// Main-thread client (design §3.2 rules, §3.3): handshake, transfer, late-event filtering, crash surfacing, reset.
import { describe, expect, it, vi } from 'vitest';
import { createClient, type WorkerLike } from '../../src/workers/client';
import type { WorkerEvent, WorkerRequest } from '../../src/parser/protocol';

function fakeWorker() {
  const sent: WorkerRequest[] = [];
  const transfers: Transferable[][] = [];
  const w: WorkerLike & { emit: (e: WorkerEvent) => void; terminated: boolean } = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: false,
    postMessage(m, t) { sent.push(m); if (t) transfers.push(t); if (m.type === 'hello') queueMicrotask(() => w.emit({ type: 'ready', protocolVersion: 1, pdfjsVersion: 'fake' })); if (m.type === 'reset') queueMicrotask(() => w.emit({ type: 'reset-done' })); },
    terminate() { w.terminated = true; },
    emit(e) { w.onmessage?.({ data: e }); },
  };
  return { w, sent, transfers };
}

describe('createClient', () => {
  it('sends hello, resolves ready with the pdfjs version', async () => {
    const { w, sent } = fakeWorker();
    const c = createClient({ workerFactory: () => w });
    expect(sent[0]).toEqual({ type: 'hello', protocolVersion: 1 });
    await expect(c.ready).resolves.toEqual({ pdfjsVersion: 'fake' });
    c.terminate();
  });
  it('times out ready with WORKER_CRASH when the worker never answers', async () => {
    const w: WorkerLike = { onmessage: null, onerror: null, postMessage() {}, terminate() {} };
    const c = createClient({ workerFactory: () => w, readyTimeoutMs: 10 });
    await expect(c.ready).rejects.toMatchObject({ code: 'WORKER_CRASH' });
    c.terminate();
  });
  it('open transfers the buffer and routes events; late events of a cancelled request are dropped', async () => {
    const { w, sent, transfers } = fakeWorker();
    const c = createClient({ workerFactory: () => w });
    await c.ready;
    const events: WorkerEvent[] = [];
    c.on((e) => events.push(e));
    const buf = new ArrayBuffer(8);
    const id = c.open(buf, { source: 'user', fileSizeBytes: 8 });
    expect(sent[1]).toMatchObject({ type: 'open', requestId: id, source: 'user', fileSizeBytes: 8 });
    expect(transfers[0]).toEqual([buf]);
    w.emit({ type: 'opened', requestId: id, pageCount: 3 });
    w.emit({ type: 'progress', requestId: 'stale-request', page: 1, pageCount: 3, phase: 'extract' });
    w.emit({ type: 'error', requestId: id, error: { code: 'NOT_CAS', message: 'ui.error.NOT_CAS' } });
    expect(events.map((e) => e.type)).toEqual(['opened', 'error']);
    c.password(id, 'secret');
    expect(sent[2]).toEqual({ type: 'password', requestId: id, password: 'secret' });
    c.cancel(id);
    expect(sent[3]).toEqual({ type: 'cancel', requestId: id });
    c.terminate();
  });
  it('reset cancels the active request, waits for reset-done; terminate stops the worker', async () => {
    const { w, sent } = fakeWorker();
    const c = createClient({ workerFactory: () => w });
    await c.ready;
    const id = c.open(new ArrayBuffer(1), { source: 'sample', fileSizeBytes: 1 });
    await c.reset();
    expect(sent.slice(2)).toEqual([{ type: 'cancel', requestId: id }, { type: 'reset' }]);
    c.terminate();
    expect(w.terminated).toBe(true);
  });
  it('a worker crash surfaces as WORKER_CRASH and terminates the worker (§3.2)', async () => {
    const { w } = fakeWorker();
    const c = createClient({ workerFactory: () => w });
    await c.ready;
    const listener = vi.fn();
    c.on(listener);
    const id = c.open(new ArrayBuffer(1), { source: 'user', fileSizeBytes: 1 });
    w.onerror?.(new Error('boom'));
    expect(listener).toHaveBeenCalledWith({ type: 'error', requestId: id, error: { code: 'WORKER_CRASH', message: 'ui.error.WORKER_CRASH' } });
    expect(w.terminated).toBe(true);
  });
});
