// tests/helpers/pdfjsNode.ts
// Node harness for the parser: pdfjs-dist's legacy build with its worker module imported into the same thread
// (the same in-thread path the browser worker uses, A24), driving src/parser/pipeline.ts exactly as pdfWorker.ts does.

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openAndParse, type ParseOutcome, type PdfjsLike, type PipelineCallbacks } from '../../src/parser/pipeline';
import type { ParseWarning } from '../../src/parser/types';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'fixtures');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

/** parsedAt stamped into every test parse so results are byte-identical across runs. */
export const FIXED_PARSED_AT = '2026-01-01T00:00:00.000Z';

let pdfjsPromise: Promise<PdfjsLike> | null = null;
export function loadPdfjsNode(): Promise<PdfjsLike> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
    return lib as unknown as PdfjsLike;
  })();
  return pdfjsPromise;
}

export interface ParseBytesOptions {
  /** Passwords to offer, in order, when pdfjs asks; null cancels. */
  passwords?: Array<string | null>;
  initialPassword?: string;
  onEvent?: (e: { type: string; [k: string]: unknown }) => void;
  isCancelled?: () => boolean;
  parsedAt?: string;
}

export interface ParseTrace {
  outcome: ParseOutcome;
  passwordPrompts: Array<{ reason: 'required' | 'incorrect'; attempt: number }>;
  progress: Array<{ page: number; pageCount: number; phase: 'extract' | 'parse' }>;
  detected: string[];
  warnings: ParseWarning[];
  elapsedMs: number;
}

export async function parseBytes(bytes: Uint8Array, opts: ParseBytesOptions = {}): Promise<ParseTrace> {
  const pdfjs = await loadPdfjsNode();
  const trace: ParseTrace = { outcome: { ok: false, error: { code: 'INTERNAL', message: '', stage: 'open', errorName: 'unset' } }, passwordPrompts: [], progress: [], detected: [], warnings: [], elapsedMs: 0 };
  const passwords = [...(opts.passwords ?? [])];
  const cb: PipelineCallbacks = {
    requestPassword: async (reason, attempt) => {
      trace.passwordPrompts.push({ reason, attempt });
      if (passwords.length === 0) return null;
      return passwords.shift() ?? null;
    },
    onProgress: (page, pageCount, phase) => trace.progress.push({ page, pageCount, phase }),
    onDetected: (t) => trace.detected.push(t),
    onWarning: (w) => trace.warnings.push(w),
    isCancelled: opts.isCancelled,
    now: () => performance.now(),
  };
  const started = performance.now();
  const pipelineOpts: Parameters<typeof openAndParse>[2] = { parsedAt: opts.parsedAt ?? FIXED_PARSED_AT };
  if (opts.initialPassword !== undefined) pipelineOpts.password = opts.initialPassword;
  trace.outcome = await openAndParse(pdfjs, bytes, pipelineOpts, cb);
  trace.elapsedMs = performance.now() - started;
  return trace;
}

export interface FixtureMeta {
  fixture: string;
  kind: string;
  expect: string;
  password?: string;
  encryption?: string;
  ownerPasswordOnly?: true;
  pageCount: number;
  bytes?: number;
  sha256?: string;
}

export function fixtureNames(): string[] {
  return fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.golden.json')).map((f) => f.replace(/\.golden\.json$/, '')).sort();
}

export function readMeta(name: string): FixtureMeta {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.meta.json`), 'utf8')) as FixtureMeta;
}

export function readGolden<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.golden.json`), 'utf8')) as T;
}

export function fixturePdfPath(name: string): string {
  const inFixtures = path.join(FIXTURES_DIR, `${name}.pdf`);
  if (fs.existsSync(inFixtures)) return inFixtures;
  return path.join(PUBLIC_DIR, `${name}.pdf`);
}

export function readFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(fixturePdfPath(name)));
}

/** Parses a fixture the way the app would: initial password from the meta file when the PDF is protected. */
export async function parseFixture(name: string, extra: ParseBytesOptions = {}): Promise<ParseTrace> {
  const meta = readMeta(name);
  const opts: ParseBytesOptions = { ...extra };
  if (meta.password !== undefined && opts.passwords === undefined && opts.initialPassword === undefined) opts.passwords = [meta.password];
  return parseBytes(readFixtureBytes(name), opts);
}
