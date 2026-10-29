// src/parser/pdfWorker.ts
// Worker entry: protocol handler (design §3.2), pdfjs lifecycle and the password callback. pdfjs runs
// single-threaded inside this worker (A24): the worker module is imported into this thread and registered
// as `globalThis.pdfjsWorker`, so pdfjs takes its in-thread path and never spawns a nested Worker.
// The only wall-clock read of the engine (Portfolio.parsedAt) happens here.

import type { WorkerEvent, WorkerRequest } from './protocol';
import { PROTOCOL_VERSION } from './protocol';
import { openAndParse, type PdfjsLike } from './pipeline';
import { uiErrorKey } from './types';

interface WorkerScope {
  postMessage(message: WorkerEvent): void;
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  location?: { origin: string };
}

const scope = globalThis as unknown as WorkerScope;
const post = (event: WorkerEvent) => scope.postMessage(event);

let pdfjsPromise: Promise<PdfjsLike> | null = null;
function loadPdfjs(): Promise<PdfjsLike> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs')]);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
    return lib as unknown as PdfjsLike;
  })();
  return pdfjsPromise;
}

interface ActiveRequest {
  requestId: string;
  cancelled: boolean;
  pendingPassword: ((password: string | null) => void) | null;
}

let active: ActiveRequest | null = null;

function assetUrl(path: string): string | undefined {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  if (!scope.location) return undefined;
  const origin = scope.location.origin;
  return new URL(`${base.replace(/\/$/, '')}/pdfjs/${path}/`, origin).toString();
}

async function handleOpen(req: Extract<WorkerRequest, { type: 'open' }>): Promise<void> {
  if (active) {
    active.cancelled = true;
    active.pendingPassword?.(null);
    post({ type: 'cancelled', requestId: active.requestId });
  }
  const me: ActiveRequest = { requestId: req.requestId, cancelled: false, pendingPassword: null };
  active = me;
  const started = performance.now();
  let pdfjs: PdfjsLike;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    post({ type: 'error', requestId: me.requestId, error: { code: 'WORKER_CRASH', message: uiErrorKey('WORKER_CRASH') } });
    if (active === me) active = null;
    return;
  }
  const bytes = new Uint8Array(req.bytes);
  const outcome = await openAndParse(
    pdfjs,
    bytes,
    {
      password: req.password,
      cMapUrl: assetUrl('cmaps'),
      standardFontDataUrl: assetUrl('standard_fonts'),
      parsedAt: new Date().toISOString(),
    },
    {
      requestPassword: (reason, attempt) =>
        new Promise<string | null>((resolve) => {
          if (me.cancelled) { resolve(null); return; }
          me.pendingPassword = (pw) => { me.pendingPassword = null; resolve(pw); };
          post({ type: 'needs-password', requestId: me.requestId, reason, attempt });
        }),
      onOpened: (pageCount) => post({ type: 'opened', requestId: me.requestId, pageCount }),
      onProgress: (page, pageCount, phase) => post({ type: 'progress', requestId: me.requestId, page, pageCount, phase }),
      onDetected: (documentType) => post({ type: 'detected', requestId: me.requestId, documentType }),
      onWarning: (warning) => post({ type: 'partial-warning', requestId: me.requestId, warning }),
      isCancelled: () => me.cancelled,
      now: () => performance.now(),
    },
  );
  // req.password is dropped with the request object; nothing retains it.
  if (active === me) active = null;
  if (me.cancelled) { post({ type: 'cancelled', requestId: me.requestId }); return; }
  if (outcome.ok) post({ type: 'result', requestId: me.requestId, result: outcome.result, elapsedMs: Math.round(performance.now() - started) });
  else post({ type: 'error', requestId: me.requestId, error: outcome.error });
}

scope.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'hello':
      void loadPdfjs().then(
        (lib) => post({ type: 'ready', protocolVersion: PROTOCOL_VERSION, pdfjsVersion: lib.version ?? 'unknown' }),
        () => post({ type: 'error', requestId: '', error: { code: 'WORKER_CRASH', message: uiErrorKey('WORKER_CRASH') } }),
      );
      break;
    case 'open':
      void handleOpen(msg);
      break;
    case 'password':
      if (active && active.requestId === msg.requestId && active.pendingPassword) active.pendingPassword(msg.password);
      break;
    case 'cancel':
      if (active && active.requestId === msg.requestId) {
        active.cancelled = true;
        active.pendingPassword?.(null);
      }
      break;
    case 'reset':
      if (active) {
        active.cancelled = true;
        active.pendingPassword?.(null);
        active = null;
      }
      post({ type: 'reset-done' });
      break;
    default:
      break;
  }
};
