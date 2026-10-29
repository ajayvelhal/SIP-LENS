// Determinism and performance: the same PDF produces byte-identical JSON; the 100+ page fixture stays within budget (E44, §7.1).
import { describe, expect, it } from 'vitest';
import { parseFixture } from '../helpers/pdfjsNode';
import { comparable } from '../helpers/golden';

describe('determinism', () => {
  for (const name of ['sample-cas', 'kfin-2023-4dp', 'cams-2025-parse-warnings']) {
    it(`${name}: parsing twice gives byte-identical JSON (parsedAt and timings aside)`, async () => {
      const a = await parseFixture(name);
      const b = await parseFixture(name);
      expect(a.outcome.ok && b.outcome.ok).toBe(true);
      if (!a.outcome.ok || !b.outcome.ok) return;
      expect(JSON.stringify(comparable(a.outcome.result))).toBe(JSON.stringify(comparable(b.outcome.result)));
      expect(a.outcome.result.portfolio.parsedAt).toBe(b.outcome.result.portfolio.parsedAt);
    });
  }
});

describe('performance', () => {
  it('stress fixture (103 pages, 7,398 rows) parses within 8 s and the progress never stalls', async () => {
    const trace = await parseFixture('stress-cams-2025-100p');
    expect(trace.outcome.ok).toBe(true);
    if (!trace.outcome.ok) return;
    const { extractMs, parseMs, pages, transactions } = trace.outcome.result.stats;
    // eslint-disable-next-line no-console
    console.info(`stress fixture: ${pages} pages, ${transactions} transactions, extract ${extractMs} ms, parse ${parseMs} ms, total ${trace.elapsedMs.toFixed(0)} ms`);
    expect(trace.elapsedMs).toBeLessThan(8000);
    expect(trace.progress.filter((p) => p.phase === 'extract')).toHaveLength(103);
  });
  it('growth fixture (29 pages, 1,961 rows): the 40-page / 1,500-transaction class, desktop proxy under 800 ms', async () => {
    const trace = await parseFixture('cams-2025-growth-15f-2000t');
    expect(trace.outcome.ok).toBe(true);
    if (!trace.outcome.ok) return;
    // eslint-disable-next-line no-console
    console.info(`growth fixture: extract ${trace.outcome.result.stats.extractMs} ms, parse ${trace.outcome.result.stats.parseMs} ms, total ${trace.elapsedMs.toFixed(0)} ms`);
    expect(trace.elapsedMs).toBeLessThan(800 * 3); // 3x headroom for slow CI runners; the measured value is printed
  });
});
