// Main-thread checks before any worker exists (E1-E3, E46; US-02).
import { describe, expect, it } from 'vitest';
import { looksLikePdf, preflight } from '../../src/workers/preflight';
import { readFixtureBytes } from '../helpers/pdfjsNode';
import { LIMITS } from '../../src/parser/types';

describe('preflight', () => {
  it('the not-a-pdf fixture (PNG bytes under a .pdf name) -> NOT_PDF', () => {
    const bytes = readFixtureBytes('not-a-pdf');
    expect(looksLikePdf(bytes)).toBe(false);
    expect(preflight(1, bytes.length, bytes)).toEqual({ code: 'NOT_PDF', message: 'ui.error.NOT_PDF' });
  });
  it('a real fixture passes; junk before the header within 1 KB is accepted', () => {
    const bytes = readFixtureBytes('cams-2019-plain-sip');
    expect(preflight(1, bytes.length, bytes.slice(0, 1024))).toBeNull();
    const junk = new Uint8Array(1024 + 16);
    junk.set(new TextEncoder().encode('%PDF-1.4'), 1000);
    expect(looksLikePdf(junk)).toBe(true);
    const late = new Uint8Array(2048);
    late.set(new TextEncoder().encode('%PDF-1.4'), 1030);
    expect(looksLikePdf(late)).toBe(false);
  });
  it('more than one file -> MULTIPLE_FILES before anything else (E2)', () => {
    expect(preflight(2, 10, new Uint8Array())).toEqual({ code: 'MULTIPLE_FILES', message: 'ui.error.MULTIPLE_FILES' });
    expect(preflight(0, 10, new Uint8Array())).toEqual({ code: 'MULTIPLE_FILES', message: 'ui.error.MULTIPLE_FILES' });
  });
  it('over 50 MB -> FILE_TOO_LARGE with the limit (E3, A14)', () => {
    const head = new TextEncoder().encode('%PDF-1.7');
    expect(preflight(1, LIMITS.maxFileBytes + 1, head)).toEqual({ code: 'FILE_TOO_LARGE', message: 'ui.error.FILE_TOO_LARGE', sizeBytes: LIMITS.maxFileBytes + 1, limitBytes: LIMITS.maxFileBytes });
    expect(preflight(1, LIMITS.maxFileBytes, head)).toBeNull();
  });
});
