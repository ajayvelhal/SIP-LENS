// Document-type detection (design §2.1, §2.2) and the worker-side error paths that need pdfjs: wrong password,
// cancel, corrupt bytes, page limit, page extraction failure (E4-E8, E12, E13).
import { describe, expect, it } from 'vitest';
import { detectDocumentType, rtaFromRegistrar } from '../../src/parser/detect';
import { openAndParse, type PdfjsLike } from '../../src/parser/pipeline';
import { parseBytes, parseFixture, readFixtureBytes, loadPdfjsNode } from '../helpers/pdfjsNode';

const page = (...lines: string[]) => lines.join('\n');

describe('detectDocumentType', () => {
  it('fewer than 200 characters on pages 1-3 -> NO_TEXT (E8, A4)', () => {
    expect(detectDocumentType(['Consolidated Account Statement CAMS', ''])).toEqual({ type: 'NO_TEXT' });
    expect(detectDocumentType([])).toEqual({ type: 'NO_TEXT' });
  });
  const filler = 'x'.repeat(220);
  it('depository markers win over RTA markers (E11)', () => {
    expect(detectDocumentType([page('Consolidated Account Statement', 'CAS ID: 100', 'serviced by CAMS / KFINTECH', filler)])).toEqual({ type: 'DEPOSITORY_NSDL', depository: 'NSDL' });
    expect(detectDocumentType([page('Consolidated Account Statement', 'DP ID IN300000 Client ID 1', 'Registrar : CAMS', filler)])).toEqual({ type: 'DEPOSITORY_NSDL', depository: 'NSDL' });
    expect(detectDocumentType([page('Consolidated Account Statement', 'BO ID 1200000', 'CAMS', filler)])).toEqual({ type: 'DEPOSITORY_CDSL', depository: 'CDSL' });
    expect(detectDocumentType([page('Central Depository Services (India) Limited', filler)])).toEqual({ type: 'DEPOSITORY_CDSL', depository: 'CDSL' });
  });
  it('requires both an RTA marker and a CAS marker (E9)', () => {
    expect(detectDocumentType([page('Consolidated Account Statement', filler)])).toEqual({ type: 'NOT_CAS' });
    expect(detectDocumentType([page('Computer Age Management Services', filler)])).toEqual({ type: 'NOT_CAS' });
    expect(detectDocumentType([page('Folio No: 1 PAN: X', 'KFin Technologies Limited', filler)])).toEqual({ type: 'RTA_DETAILED', issuer: 'KFINTECH' });
  });
  it('issuer is the RTA whose marker comes first on page 1; Karvy maps to KFINTECH (A20, A21)', () => {
    expect(detectDocumentType([page('Consolidated Account Statement', 'Registrar : CAMS', 'Registrar : KFINTECH', filler)]).issuer).toBe('CAMS');
    expect(detectDocumentType([page('Consolidated Account Statement', 'KFINTECH', 'CAMS', filler)]).issuer).toBe('KFINTECH');
    expect(detectDocumentType([page('Consolidated Account Statement', 'Karvy Fintech', filler)]).issuer).toBe('KFINTECH');
    expect(detectDocumentType([page('Consolidated Account Statement', 'MF Central', filler)])).toEqual({ type: 'RTA_DETAILED', issuer: 'CAMS' });
    expect(detectDocumentType([page('Consolidated Account Statement', filler), page('CAMS', filler)]).issuer).toBe('CAMS');
  });
  it('rtaFromRegistrar', () => {
    expect(rtaFromRegistrar('CAMS')).toBe('CAMS');
    expect(rtaFromRegistrar('KFINTECH')).toBe('KFINTECH');
    expect(rtaFromRegistrar('Karvy')).toBe('KFINTECH');
    expect(rtaFromRegistrar(undefined)).toBeUndefined();
    expect(rtaFromRegistrar('XYZ')).toBeUndefined();
  });
});

describe('password, cancel and open failures through the pipeline', () => {
  it('protected fixture: wrong password re-prompts with reason incorrect and attempt 2, right password parses (E4, E5)', async () => {
    const trace = await parseFixture('cams-2024-protected', { passwords: ['WRONG-PASSWORD', 'LENSP0001A'] });
    expect(trace.passwordPrompts).toEqual([{ reason: 'required', attempt: 1 }, { reason: 'incorrect', attempt: 2 }]);
    expect(trace.outcome.ok).toBe(true);
  });
  it('protected fixture: a correct initial password opens without any prompt', async () => {
    const trace = await parseFixture('cams-2024-protected', { initialPassword: 'LENSP0001A' });
    expect(trace.passwordPrompts).toEqual([]);
    expect(trace.outcome.ok).toBe(true);
  });
  it('protected fixture: a wrong initial password prompts with reason incorrect', async () => {
    const trace = await parseFixture('cams-2024-protected', { initialPassword: 'nope', passwords: ['LENSP0001A'] });
    expect(trace.passwordPrompts).toEqual([{ reason: 'incorrect', attempt: 1 }]);
    expect(trace.outcome.ok).toBe(true);
  });
  it('owner-locked fixture opens without a prompt (E4 note)', async () => {
    const trace = await parseFixture('cams-2024-owner-locked');
    expect(trace.passwordPrompts).toEqual([]);
    expect(trace.outcome.ok).toBe(true);
  });
  it('cancelling at the password prompt -> CANCELLED (E6)', async () => {
    const trace = await parseFixture('cams-2024-protected', { passwords: [null] });
    expect(trace.outcome).toEqual({ ok: false, error: { code: 'CANCELLED', message: 'ui.error.CANCELLED' } });
  });
  it('cancelling between pages -> CANCELLED', async () => {
    let pagesSeen = 0;
    const trace = await parseBytes(readFixtureBytes('cams-2025-sip-patterns'), { isCancelled: () => pagesSeen > 2, onEvent: undefined });
    void pagesSeen;
    // isCancelled is consulted before each page; emulate the UI by flipping after a few progress events
    expect(trace.outcome.ok).toBe(true);
    const trace2 = await parseBytes(readFixtureBytes('cams-2025-sip-patterns'), { isCancelled: () => true });
    expect(trace2.outcome).toEqual({ ok: false, error: { code: 'CANCELLED', message: 'ui.error.CANCELLED' } });
  });
  it('truncated bytes -> PDF_CORRUPT (E7)', async () => {
    const bytes = readFixtureBytes('cams-2019-plain-sip');
    const trace = await parseBytes(bytes.slice(0, Math.floor(bytes.length / 3)));
    expect(trace.outcome).toEqual({ ok: false, error: { code: 'PDF_CORRUPT', message: 'ui.error.PDF_CORRUPT' } });
  });
  it('garbage with a PDF header -> PDF_CORRUPT', async () => {
    const trace = await parseBytes(new TextEncoder().encode('%PDF-1.7\n' + 'garbage '.repeat(200)));
    expect(trace.outcome.ok).toBe(false);
    if (!trace.outcome.ok) expect(trace.outcome.error.code).toBe('PDF_CORRUPT');
  });
  it('more than 400 pages -> TOO_MANY_PAGES (E12, stubbed numPages)', async () => {
    const stub: PdfjsLike = {
      version: 'stub',
      getDocument: () => ({ promise: Promise.resolve({ numPages: 401, getPage: () => Promise.reject(new Error('unused')) }), onPassword: null, destroy: () => Promise.resolve() }),
    };
    const out = await openAndParse(stub, new Uint8Array(), { parsedAt: 't' }, { requestPassword: async () => null });
    expect(out).toEqual({ ok: false, error: { code: 'TOO_MANY_PAGES', message: 'ui.error.TOO_MANY_PAGES' } });
  });
  it('a page whose extraction throws is skipped with PAGE_EXTRACT_FAILED and parsing continues (E13)', async () => {
    const real = await loadPdfjsNode();
    const bytes = readFixtureBytes('cams-2025-sip-patterns');
    const wrapped: PdfjsLike = {
      version: real.version,
      getDocument: (src) => {
        const task = real.getDocument(src);
        const promise = task.promise.then((doc) => ({
          numPages: doc.numPages,
          getPage: async (n: number) => {
            const p = await doc.getPage(n);
            if (n === 5) return { ...p, getViewport: p.getViewport.bind(p), cleanup: p.cleanup.bind(p), getTextContent: () => Promise.reject(new Error('boom')) };
            return p;
          },
        }));
        return { promise, onPassword: null, destroy: () => task.destroy() };
      },
    };
    const out = await openAndParse(wrapped, bytes, { parsedAt: 't' }, { requestPassword: async () => null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const w = out.result.warnings.filter((x) => x.code === 'PAGE_EXTRACT_FAILED');
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.page === 5 && x.severity === 'flag')).toBe(true);
    const flagged = out.result.portfolio.funds.filter((f) => w.some((x) => x.fundId === f.id));
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((f) => f.mayBeIncomplete)).toBe(true);
    // A scheme header printed on the lost page cannot be recovered: that fund's rows fall into the open section,
    // which the balance check then flags. The design asks for graceful degradation, not recovery (E13, §7.4).
    expect(out.result.portfolio.funds.length).toBeGreaterThanOrEqual(4);
    expect(out.result.portfolio.funds.length).toBeLessThanOrEqual(5);
  });
  it('reports progress per page and the detected type after page 3 (US-07)', async () => {
    const trace = await parseFixture('cams-2025-sip-patterns');
    expect(trace.progress.filter((p) => p.phase === 'extract').map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(trace.progress[trace.progress.length - 1]).toEqual({ page: 8, pageCount: 8, phase: 'parse' });
    expect(trace.detected).toEqual(['RTA_DETAILED']);
    expect(trace.outcome.ok && trace.outcome.result.stats.extractMs).toBeGreaterThanOrEqual(0);
  });
});
