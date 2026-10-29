// Golden-output test per fixture (US-09 "the test suite fails on any difference"; 02-database-design.md §4.4, §4.6).
import { describe, expect, it } from 'vitest';
import { fixtureNames, parseFixture, readMeta } from '../helpers/pdfjsNode';
import { comparable, comparableGolden, digestResult, loadGolden, normaliseDescriptions, warningsById } from '../helpers/golden';

const names = fixtureNames();

describe('golden outputs: parsed fixtures', () => {
  for (const name of names) {
    const golden = loadGolden(name);
    if (golden.expect !== 'result') continue;
    it(`${name} matches its golden ParseResult`, async () => {
      const trace = await parseFixture(name);
      expect(trace.outcome.ok, JSON.stringify(trace.outcome)).toBe(true);
      if (!trace.outcome.ok) return;
      const result = trace.outcome.result;
      const expected = normaliseDescriptions(comparableGolden(golden.result as unknown as { portfolio: Record<string, unknown>; stats: Record<string, unknown> }) as Record<string, unknown>) as unknown as { warnings: Array<{ id: string }>; digest?: unknown } & Record<string, unknown>;
      const actual = normaliseDescriptions(golden.digest ? digestResult(result) : comparable(result)) as unknown as { warnings: Array<{ id: string }> } & Record<string, unknown>;
      // warnings: set keyed by id, each compared field by field
      expect(warningsById(actual.warnings)).toEqual(warningsById(expected.warnings));
      const { warnings: _a, ...actualRest } = actual;
      const { warnings: _b, digest: _d, ...expectedRest } = expected;
      expect(actualRest).toEqual(expectedRest);
      // stats that are measured, not compared, must still be sane
      expect(result.stats.rows).toBeGreaterThan(0);
      expect(result.stats.pages).toBe(readMeta(name).pageCount);
    });
  }
});

describe('golden outputs: rejected fixtures', () => {
  for (const name of names) {
    const golden = loadGolden(name);
    if (golden.expect !== 'error') continue;
    if (golden.error.code === 'NOT_PDF') continue; // main-thread preflight; covered in preflight.test.ts
    it(`${name} is rejected with ${golden.error.code}`, async () => {
      const trace = await parseFixture(name);
      expect(trace.outcome.ok).toBe(false);
      if (trace.outcome.ok) return;
      const { message: _m, ...actual } = trace.outcome.error as Record<string, unknown>;
      const { message: _g, ...expected } = golden.error as Record<string, unknown>;
      expect(actual).toEqual(expected);
    });
  }
});
