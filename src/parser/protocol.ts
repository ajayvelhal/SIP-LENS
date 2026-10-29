// src/parser/protocol.ts
// Worker protocol (design §3.2). Every message is a plain structured-cloneable object.
import type { ParseResult, ParseError, ParseWarning, DocumentType } from './types';

export const PROTOCOL_VERSION = 1 as const;

export type WorkerRequest =
  | {
      type: 'open';
      requestId: string;
      /** Transferred, not copied: postMessage(msg, [msg.bytes]). The main thread's copy is detached. */
      bytes: ArrayBuffer;
      /** Optional first attempt (e.g. the user typed it before dropping). Never persisted. */
      password?: string;
      source: 'user' | 'sample';
      fileSizeBytes: number;
    }
  | {
      /** Answer to a needs-password event. */
      type: 'password';
      requestId: string;
      password: string;
    }
  | {
      /** Abort the request; worker replies with { type: 'cancelled' } and frees the document. */
      type: 'cancel';
      requestId: string;
    }
  | {
      /** Drop every document, buffer and callback the worker holds. Reply: 'reset-done'. The client
       *  then terminates the worker anyway (US-21); reset exists for the case where termination fails. */
      type: 'reset';
    }
  | {
      /** Capability handshake sent once after creation; worker replies 'ready'. */
      type: 'hello';
      protocolVersion: typeof PROTOCOL_VERSION;
    };

export type WorkerEvent =
  | { type: 'ready'; protocolVersion: typeof PROTOCOL_VERSION; pdfjsVersion: string }
  | {
      type: 'needs-password';
      requestId: string;
      reason: 'required' | 'incorrect';
      /** 1 for the first prompt, incremented on each wrong attempt. No limit. */
      attempt: number;
    }
  | { type: 'opened'; requestId: string; pageCount: number }
  | {
      type: 'progress';
      requestId: string;
      /** 1-based page just finished. */
      page: number;
      pageCount: number;
      /** 'extract' = pdfjs text extraction per page; 'parse' = state machine over all rows (reported as
       *  page = pageCount, so the bar reaches 100% only when the Portfolio is built). */
      phase: 'extract' | 'parse';
    }
  | {
      /** Emitted once after pages 1-3 so the UI can show "Reading a CAMS statement..." early. */
      type: 'detected';
      requestId: string;
      documentType: DocumentType;
    }
  | {
      /** Emitted during the walk whenever a fund is flagged, so the banner can build up live.
       *  The same warnings are also present in the final ParseResult; the UI dedupes by `id`. */
      type: 'partial-warning';
      requestId: string;
      warning: ParseWarning;
    }
  | { type: 'result'; requestId: string; result: ParseResult; elapsedMs: number }
  | { type: 'error'; requestId: string; error: ParseError }
  | { type: 'cancelled'; requestId: string }
  | { type: 'reset-done' };
