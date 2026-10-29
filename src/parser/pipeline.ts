// src/parser/pipeline.ts
// The shared open -> extract -> detect -> walk -> reconcile pipeline (design §2.1, §3.4). The browser worker
// (pdfWorker.ts) and the Node test harness call this with their own pdfjs build; everything below the pdfjs
// surface is identical, which is what makes the golden tests representative of the app.

import type { DocumentType, ISODate, ParseError, ParseResult, ParseWarning } from './types';
import { LIMITS, uiErrorKey } from './types';
import { dropPageFurniture, groupRows, itemsFromTextContent, type Row, type TextContentLike } from './textExtract';
import { detectDocumentType } from './detect';
import { parseRows } from './casParser';

/** The slice of the pdfjs API the pipeline uses, kept structural so both builds (modern, legacy) fit. */
export interface PdfjsLike {
  version?: string;
  getDocument(src: Record<string, unknown>): PdfLoadingTaskLike;
}
export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  onPassword: ((updatePassword: (password: string) => void, reason: number) => void) | null;
  destroy(): Promise<void>;
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(options?: Record<string, unknown>): Promise<TextContentLike>;
  cleanup(): unknown;
}

export interface PipelineCallbacks {
  /** Resolve with the password to try, or null to cancel the request (US-03). */
  requestPassword(reason: 'required' | 'incorrect', attempt: number): Promise<string | null>;
  onOpened?(pageCount: number): void;
  onProgress?(page: number, pageCount: number, phase: 'extract' | 'parse'): void;
  onDetected?(documentType: DocumentType): void;
  onWarning?(warning: ParseWarning): void;
  isCancelled?(): boolean;
  /** Monotonic clock for the timing stats, injected by the caller; absent -> timings are 0. */
  now?(): number;
}

export interface PipelineOptions {
  password?: string;
  cMapUrl?: string;
  standardFontDataUrl?: string;
  /** ISO 8601 datetime stamped into Portfolio.parsedAt (the caller's single wall-clock read). */
  parsedAt: string;
}

export type ParseOutcome = { ok: true; result: ParseResult } | { ok: false; error: ParseError };

const err = (error: ParseError): ParseOutcome => ({ ok: false, error });
const simple = (code: Extract<ParseError, { message: string }>['code'] & ('PDF_CORRUPT' | 'TOO_MANY_PAGES' | 'NO_TEXT' | 'NOT_CAS' | 'CANCELLED' | 'NO_FOLIOS_PARSED')): ParseOutcome =>
  err({ code, message: uiErrorKey(code) });

const PASSWORD_NEED = 1;

export async function openAndParse(pdfjs: PdfjsLike, bytes: Uint8Array, opts: PipelineOptions, cb: PipelineCallbacks): Promise<ParseOutcome> {
  const now = cb.now ?? (() => 0);
  const cancelled = () => cb.isCancelled?.() === true;
  const t0 = now();

  const src: Record<string, unknown> = {
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  };
  if (opts.password !== undefined) src.password = opts.password;
  if (opts.cMapUrl !== undefined) { src.cMapUrl = opts.cMapUrl; src.cMapPacked = true; }
  if (opts.standardFontDataUrl !== undefined) src.standardFontDataUrl = opts.standardFontDataUrl;

  let task: PdfLoadingTaskLike;
  try {
    task = pdfjs.getDocument(src);
  } catch (e) {
    return err({ code: 'INTERNAL', message: uiErrorKey('INTERNAL'), stage: 'open', errorName: nameOf(e) });
  }
  let attempt = 0;
  let userCancelled = false;
  task.onPassword = (updatePassword, reason) => {
    attempt += 1;
    void cb.requestPassword(reason === PASSWORD_NEED ? 'required' : 'incorrect', attempt).then(
      (pw) => {
        if (pw === null) { userCancelled = true; void task.destroy().catch(() => undefined); return; }
        updatePassword(pw);
      },
      () => { userCancelled = true; void task.destroy().catch(() => undefined); },
    );
  };

  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (e) {
    if (userCancelled || cancelled()) return simple('CANCELLED');
    const name = nameOf(e);
    if (/InvalidPDF|MissingPDF|FormatError|UnexpectedResponse|UnknownError|PasswordException/.test(name)) return simple('PDF_CORRUPT');
    if (/Abort/.test(name)) return simple('CANCELLED');
    return err({ code: 'INTERNAL', message: uiErrorKey('INTERNAL'), stage: 'open', errorName: name });
  }

  try {
    const pageCount = doc.numPages;
    if (pageCount > LIMITS.maxPages) return simple('TOO_MANY_PAGES');
    cb.onOpened?.(pageCount);

    const pages: Row[][] = [];
    const failedPages: number[] = [];
    const detectAfter = Math.min(3, pageCount);
    let detected: ReturnType<typeof detectDocumentType> | undefined;

    for (let p = 1; p <= pageCount; p++) {
      if (cancelled()) return simple('CANCELLED');
      try {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        pages.push(groupRows(itemsFromTextContent(content, p, viewport.height), p));
        page.cleanup();
      } catch (e) {
        if (cancelled()) return simple('CANCELLED');
        if (/Abort/.test(nameOf(e))) return simple('CANCELLED');
        failedPages.push(p);
        pages.push([]);
      }
      cb.onProgress?.(p, pageCount, 'extract');
      if (p === detectAfter) {
        detected = detectDocumentType(pages.map((rows) => rows.map((r) => r.text).join('\n')));
        if (detected.type === 'NO_TEXT') return simple('NO_TEXT');
        if (detected.type === 'DEPOSITORY_NSDL' || detected.type === 'DEPOSITORY_CDSL') {
          return err({ code: 'DEPOSITORY_CAS', message: uiErrorKey('DEPOSITORY_CAS'), depository: detected.depository ?? 'NSDL' });
        }
        if (detected.type === 'NOT_CAS') return simple('NOT_CAS');
        cb.onDetected?.(detected.type);
      }
    }
    const tExtract = now();
    const issuer = detected?.issuer ?? 'CAMS';

    let outcome: ReturnType<typeof parseRows>;
    try {
      outcome = parseRows(dropPageFurniture(pages), { issuer, pageCount, failedPages, onWarning: cb.onWarning }, opts.parsedAt);
    } catch (e) {
      return err({ code: 'INTERNAL', message: uiErrorKey('INTERNAL'), stage: 'parse', errorName: nameOf(e) });
    }
    cb.onProgress?.(pageCount, pageCount, 'parse');
    if (outcome.kind === 'not-cas') return simple('NOT_CAS');
    if (outcome.kind === 'summary') {
      const e: ParseError = { code: 'SUMMARY_CAS', message: uiErrorKey('SUMMARY_CAS'), issuer, schemeNames: outcome.schemeNames };
      if (outcome.statementDate !== undefined) e.statementDate = outcome.statementDate as ISODate;
      return err(e);
    }
    const tParse = now();
    const result: ParseResult = {
      ...outcome.result,
      stats: { ...outcome.result.stats, extractMs: Math.round(tExtract - t0), parseMs: Math.round(tParse - tExtract) },
    };
    return { ok: true, result };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

function nameOf(e: unknown): string {
  if (e && typeof e === 'object' && 'name' in e && typeof (e as { name: unknown }).name === 'string') return (e as { name: string }).name;
  return 'Error';
}
