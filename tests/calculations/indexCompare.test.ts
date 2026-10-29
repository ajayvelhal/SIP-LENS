// Index comparison (design §4.7, US-27, US-28, A5, A6, E57-E60) with the synthetic benchmark fixture and hand-built series.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexComparison, type BenchmarkSeries } from '../../src/calculations/indexCompare';
import { buildCashflows } from '../../src/calculations/cashflows';
import { makeBenchmarkSeries } from '../../src/data/benchmark';
import { addDays, dayNumber } from '../../src/calculations/dates';
import type { BenchmarkNavFile } from '../../src/data/types';
import type { Portfolio } from '../../src/parser/types';
import { FIXTURES_DIR } from '../helpers/pdfjsNode';
import { loadGolden } from '../helpers/golden';
import { d, makeFolio, makeFund } from '../helpers/factory';

const fixtureFile = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'benchmarkNav.fixture.json'), 'utf8')) as BenchmarkNavFile;
const fixtureBenchmark = makeBenchmarkSeries(fixtureFile);

/** A benchmark that compounds at exactly `annual` per year on every calendar day (no holidays). */
function flatBenchmark(first: string, last: string, annual: number): BenchmarkSeries {
  const f = d(first), l = d(last);
  const n0 = dayNumber(f);
  return {
    fundName: 'Synthetic Flat Index Fund', amfiCode: '0', isin: 'INF000S01IX8', firstDate: f, lastDate: l,
    navOnOrBefore(date) {
      if (date < f) return null;
      const dt = date > l ? l : date;
      return { date: dt, nav: 100 * Math.pow(1 + annual, (dayNumber(dt) - n0) / 365) };
    },
  };
}

describe('indexComparison: the fixture index fund tracks the fixture benchmark (E5 sanity test)', () => {
  for (const name of ['cams-2025-fully-redeemed', 'sample-cas']) {
    it(`${name}: gap ≈ 0 and value difference within the stamp-duty bound`, () => {
      const golden = loadGolden(name);
      if (golden.expect !== 'result') throw new Error('unexpected');
      const portfolio = { ...golden.result.portfolio, parsedAt: 'test' } as unknown as Portfolio;
      const fund = portfolio.funds.find((f) => f.id === 'INF000S01IX8')!;
      const series = buildCashflows([fund], portfolio.statementDate, { includeIncomplete: true });
      const res = indexComparison(series, fixtureBenchmark, portfolio.statementDate);
      expect(res.status).toBe('ok');
      if (res.status === 'unavailable') return;
      expect(res.scope).toBe('fund');
      expect(res.fundId).toBe('INF000S01IX8');
      expect(res.excludedCount).toBe(0);
      expect(res.carriedForwardDays).toBe(0);
      expect(res.gapPoints).toBeDefined();
      expect(Math.abs(res.gapPoints!)).toBeLessThanOrEqual(0.0002);
      // The shadow buys with the gross outflow (purchase + stamp duty) while the real fund allotted units net of
      // stamp duty (0.005%), so the shadow holds up to 0.005% more units; bound = that effect plus ₹2 of rounding.
      const bound = 2 + 0.00005 * series.totals.invested * (res.actualTerminalValue / Math.max(1, series.totals.invested));
      expect(Math.abs(res.valueDifference!)).toBeLessThanOrEqual(Math.max(bound, 0.0001 * res.actualTerminalValue + 2));
    });
  }
});

describe('indexComparison: rules', () => {
  const sipFund = (from: string, months: number, amount: number) => {
    const specs = [];
    for (let i = 0; i < months; i++) {
      const total = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1 + i;
      const y = Math.floor(total / 12), m = total - y * 12 + 1;
      specs.push({ date: `${y}-${String(m).padStart(2, '0')}-10`, kind: 'sip' as const, amount, units: amount / 50, nav: 50 });
    }
    return makeFund('INF000CMP', [makeFolio('A', specs, { closingNav: 60 })]);
  };
  it('benchmark XIRR of a SIP into a fund compounding at exactly 12%/yr is 12% within 0.01 pp', () => {
    const bench = flatBenchmark('2013-01-01', '2026-12-31', 0.12);
    const series = buildCashflows([sipFund('2020-01', 36, 5000)], d('2023-06-30'));
    const res = indexComparison(series, bench, d('2023-06-30'));
    expect(res.status).toBe('ok');
    if (res.status === 'unavailable') return;
    expect(res.benchmarkXirr.status).toBe('ok');
    if (res.benchmarkXirr.status === 'ok') expect(Math.abs(res.benchmarkXirr.rate - 0.12)).toBeLessThanOrEqual(0.0001);
    expect(res.actualTerminalValue).toBeCloseTo(36 * 100 * 60, 2);
    expect(res.shadowCashReceived).toBe(0);
    expect(res.valueDifference).toBe(Math.round(res.shadowTerminalValue - res.actualTerminalValue));
    expect(res.gapPoints).toBeCloseTo(res.benchmarkXirr.status === 'ok' && res.yourXirr.status === 'ok' ? res.benchmarkXirr.rate - res.yourXirr.rate : NaN, 12);
  });
  it('uses the previous business day NAV on a holiday (E59) and null before the series starts', () => {
    const sunday = d('2024-03-10');
    const p = fixtureBenchmark.navOnOrBefore(sunday)!;
    expect(p.date).toBe('2024-03-08');
    expect(fixtureBenchmark.navOnOrBefore(d('2012-12-31'))).toBeNull();
    expect(fixtureBenchmark.navOnOrBefore(fixtureBenchmark.firstDate)!.date).toBe(fixtureBenchmark.firstDate);
  });
  it('excludes cashflows before the series starts, marks partial and states the excluded amount (E57, US-28)', () => {
    const bench = flatBenchmark('2021-01-01', '2026-12-31', 0.10);
    const series = buildCashflows([sipFund('2020-07', 12, 5000)], d('2021-12-31'));
    const res = indexComparison(series, bench, d('2021-12-31'));
    expect(res.status).toBe('partial');
    if (res.status === 'unavailable') return;
    expect(res.excludedCount).toBe(6);
    expect(res.excludedAmount).toBe(30000);
    expect(res.legs.filter((l) => l.excluded === 'before-series')).toHaveLength(6);
  });
  it('carries the last NAV forward up to 45 days with the count, and is unavailable beyond (E58, A5)', () => {
    const bench = flatBenchmark('2013-01-01', '2023-06-01', 0.10);
    const fund = sipFund('2022-01', 12, 5000);
    const within = indexComparison(buildCashflows([fund], d('2023-07-10')), bench, d('2023-07-10'));
    expect(within.status).toBe('partial');
    if (within.status !== 'unavailable') expect(within.carriedForwardDays).toBe(39);
    const beyond = indexComparison(buildCashflows([fund], d('2023-07-20')), bench, d('2023-07-20'));
    expect(beyond).toEqual({ status: 'unavailable', reason: 'series-too-old', benchmark: { fundName: bench.fundName, lastBundledDate: '2023-06-01' } });
    expect(addDays(bench.lastDate, 45)).toBe('2023-07-16');
  });
  it('sells the same fraction of the shadow holding as the investor sold (A6) and reports total-wealth difference', () => {
    const bench = flatBenchmark('2013-01-01', '2026-12-31', 0.0);
    const fund = makeFund('INF000SELL', [makeFolio('A', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2022-07-11', kind: 'redemption', amount: -6000, units: -50, nav: 120 },
    ], { closingNav: 150 })]);
    const series = buildCashflows([fund], d('2022-12-30'));
    const res = indexComparison(series, bench, d('2022-12-30'));
    expect(res.status).toBe('ok');
    if (res.status === 'unavailable') return;
    expect(res.legs[1]!.shadow).toBe(5000);               // half of 100 shadow units at NAV 100
    expect(res.shadowCashReceived).toBe(5000);
    expect(res.actualCashReceived).toBe(6000);
    expect(res.shadowTerminalValue).toBe(5000);
    expect(res.actualTerminalValue).toBe(7500);
    expect(res.valueDifference).toBe(5000 + 5000 - (7500 + 6000));
  });
  it('a dividend payout sells the same rupees from the shadow, clamped at what it holds (E60)', () => {
    const bench = flatBenchmark('2013-01-01', '2026-12-31', 0.0);
    const fund = makeFund('INF000PAY', [makeFolio('A', [
      { date: '2022-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
      { date: '2022-07-11', kind: 'dividend_payout', amount: 5000 },
    ], { closingNav: 100, closingUnits: 10 })]);
    const series = buildCashflows([fund], d('2022-12-30'));
    const res = indexComparison(series, bench, d('2022-12-30'));
    expect(res.status).toBe('partial');
    if (res.status === 'unavailable') return;
    expect(res.legs[1]!.shadow).toBe(1000);
    expect(res.legs[1]!.shadowUnitsAfter).toBe(0);
  });
  it('no cashflows inside the series window -> unavailable', () => {
    const bench = flatBenchmark('2025-01-01', '2026-12-31', 0.1);
    const series = buildCashflows([sipFund('2020-01', 3, 1000)], d('2025-02-01'));
    expect(indexComparison(series, bench, d('2025-02-01')).status).toBe('unavailable');
  });
  it('pooled portfolio: proportional selling is per fund, not of the whole shadow', () => {
    const bench = flatBenchmark('2013-01-01', '2026-12-31', 0.0);
    const big = makeFund('INF000BIG', [makeFolio('A', [{ date: '2022-01-10', kind: 'purchase', amount: 90000, units: 900, nav: 100 }], { closingNav: 100 })]);
    const small = makeFund('INF000SMALL', [makeFolio('B', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2022-06-10', kind: 'redemption', amount: -10000, units: -100, nav: 100 },
    ], { closingNav: 100 })]);
    const res = indexComparison(buildCashflows([big, small], d('2022-12-30')), bench, d('2022-12-30'));
    expect(res.status).toBe('ok');
    if (res.status === 'unavailable') return;
    expect(res.scope).toBe('portfolio');
    expect(res.shadowCashReceived).toBe(10000);
    expect(res.shadowTerminalValue).toBe(90000);
  });
});
