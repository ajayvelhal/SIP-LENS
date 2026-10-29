// src/hooks/useCasParser.ts
// Owns the parser worker's lifecycle on the main thread (design §3.3, §3.5): main-thread preflight, lazy import of the
// worker client, the event subscription that drives the reducer, password, cancel and reset. Holds no statement data
// beyond the ParseResult in state; the PDF bytes are transferred to the worker and the File reference is dropped on reset.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { CasParserClient, ParseError, WorkerEvent } from '../engine';
import { preflight, uiErrorKey } from '../engine';
import { initialState, reducer, type Action, type AppState, type Source, type UiError } from '../app/state';
import { loadSampleCas, SAMPLE_FILE_NAME } from '../lib/sampleCas';

export interface PendingInput { bytes: ArrayBuffer; size: number; source: Source }

export interface CasParser {
  state: AppState;
  /** Drop or pick: runs the main-thread checks, then opens the single file. */
  openFiles(files: ArrayLike<File>): void;
  openSample(): void;
  /** OFFLINE panel's "Try again": re-runs the reader import for the same input. */
  retry(): void;
  submitPassword(password: string): void;
  cancel(): void;
  /** "Analyse another statement": cancel, reset, terminate the worker and return to landing (US-22). */
  reset(): void;
}

const crash = (): ParseError => ({ code: 'WORKER_CRASH', message: uiErrorKey('WORKER_CRASH') });

function supported(): boolean {
  return typeof Worker === 'function' && typeof structuredClone === 'function' && typeof Array.prototype.at === 'function';
}

export function useCasParser(onOpened?: () => void): CasParser {
  const [state, dispatch] = useReducer(reducer, initialState, (s) => (supported() ? s : { phase: 'unsupported-browser' as const }));
  const clientRef = useRef<CasParserClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const requestRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingInput | null>(null);
  const fileRef = useRef<File | null>(null);
  const openedRef = useRef(onOpened);
  openedRef.current = onOpened;

  const terminate = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    clientRef.current?.terminate();
    clientRef.current = null;
    requestRef.current = null;
  }, []);

  useEffect(() => terminate, [terminate]);

  const handleEvent = useCallback((event: WorkerEvent) => {
    switch (event.type) {
      case 'needs-password':
        dispatch({ type: 'NEEDS_PASSWORD', requestId: event.requestId, attempt: event.attempt, reason: event.reason });
        break;
      case 'opened':
        pendingRef.current = null;
        dispatch({ type: 'OPENED', requestId: event.requestId, pageCount: event.pageCount });
        openedRef.current?.();
        break;
      case 'progress':
        dispatch({ type: 'PROGRESS', page: event.page, pageCount: event.pageCount, stage: event.phase });
        break;
      case 'detected':
        dispatch({ type: 'DETECTED', documentType: event.documentType });
        break;
      case 'partial-warning':
        dispatch({ type: 'LIVE_WARNING', warning: event.warning });
        break;
      case 'result':
        fileRef.current = null;
        pendingRef.current = null;
        dispatch({ type: 'RESULT', result: event.result });
        break;
      case 'error':
        fileRef.current = null;
        if (event.error.code === 'WORKER_CRASH') terminate();
        dispatch({ type: 'REJECTED', error: event.error });
        break;
      case 'cancelled':
        dispatch({ type: 'RESET' });
        break;
      default:
        break;
    }
  }, [terminate]);

  const start = useCallback(async (input: PendingInput) => {
    pendingRef.current = input;
    dispatch({ type: 'LOADING_ENGINE', source: input.source });
    let createClient: typeof import('../workers/client').createClient;
    try {
      ({ createClient } = await import('../workers/client'));
    } catch {
      dispatch({ type: 'REJECTED', error: { code: 'OFFLINE', message: 'ui.error.OFFLINE' }, source: input.source });
      return;
    }
    terminate();
    const client = createClient();
    clientRef.current = client;
    unsubscribeRef.current = client.on(handleEvent);
    try {
      await client.ready;
    } catch {
      terminate();
      dispatch({ type: 'REJECTED', error: crash(), source: input.source });
      return;
    }
    if (clientRef.current !== client) return;
    requestRef.current = client.open(input.bytes, { source: input.source, fileSizeBytes: input.size });
  }, [handleEvent, terminate]);

  const openFiles = useCallback((picked: ArrayLike<File>) => {
    const files = Array.from(picked);
    void (async () => {
      const file = files[0];
      if (!file) return;
      let head = new Uint8Array(0);
      let bytes: ArrayBuffer | null = null;
      try {
        if (files.length === 1 && file.size <= 50 * 1024 * 1024) {
          bytes = await file.arrayBuffer();
          head = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
        }
      } catch {
        dispatch({ type: 'REJECTED', error: { code: 'PDF_CORRUPT', message: uiErrorKey('PDF_CORRUPT') }, source: 'user' });
        return;
      }
      const rejection = preflight(files.length, file.size, head);
      if (rejection || !bytes) {
        dispatch({ type: 'REJECTED', error: rejection ?? { code: 'NOT_PDF', message: uiErrorKey('NOT_PDF') }, source: 'user' });
        return;
      }
      fileRef.current = file;
      await start({ bytes, size: file.size, source: 'user' });
    })();
  }, [start]);

  const openSample = useCallback(() => {
    void (async () => {
      dispatch({ type: 'LOADING_ENGINE', source: 'sample' });
      let bytes: ArrayBuffer;
      try {
        bytes = await loadSampleCas();
      } catch {
        dispatch({ type: 'REJECTED', error: { code: 'OFFLINE', message: 'ui.error.OFFLINE' }, source: 'sample' });
        return;
      }
      fileRef.current = new File([bytes], SAMPLE_FILE_NAME, { type: 'application/pdf' });
      await start({ bytes, size: bytes.byteLength, source: 'sample' });
    })();
  }, [start]);

  const retry = useCallback(() => {
    const file = fileRef.current;
    const pending = pendingRef.current;
    if (pending && pending.bytes.byteLength > 0) { void start(pending); return; }
    if (file) { void (async () => start({ bytes: await file.arrayBuffer(), size: file.size, source: pending?.source ?? 'user' }))(); return; }
    openSample();
  }, [openSample, start]);

  const submitPassword = useCallback((password: string) => {
    const client = clientRef.current;
    const requestId = requestRef.current;
    if (!client || !requestId) return;
    dispatch({ type: 'PASSWORD_SUBMITTED' });
    client.password(requestId, password);
  }, []);

  const cancel = useCallback(() => {
    const client = clientRef.current;
    const requestId = requestRef.current;
    if (client && requestId) client.cancel(requestId);
    terminate();
    fileRef.current = null;
    pendingRef.current = null;
    dispatch({ type: 'RESET' });
  }, [terminate]);

  const reset = useCallback(() => {
    const client = clientRef.current;
    fileRef.current = null;
    pendingRef.current = null;
    dispatch({ type: 'RESET' });
    if (!client) return;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    clientRef.current = null;
    requestRef.current = null;
    void client.reset().finally(() => client.terminate());
  }, []);

  return { state, openFiles, openSample, retry, submitPassword, cancel, reset };
}

export type { Action, UiError };
