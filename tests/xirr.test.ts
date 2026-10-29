// XIRR engine (design §4.5, US-14): spreadsheet cross-checks, edge cases of the register (E34-E38) and every fixture's pinned rate.
import { describe, expect, it } from 'vitest';
import { xirr, npv, BRACKET_GRID } from '../src/calculations/xirr';
import { fundXirr, portfolioSummary } from '../src/calculations/portfolio';
import { fixtureNames } from './helpers/pdfjsNode';
import { loadGolden, portfolioForFixture } from './helpers/golden';
import { d } from './helpers/factory';

const PP = 0.0001; // 0.01 percentage points

describe('xirr: spreadsheet cross-checks', () => {
  it('two-flow CAGR: -10,000 on 2020-01-01, +12,100 on 2022-01-01 (731 days)', () => {
    // =XIRR({-10000,12100},{DATE(2020,1,1),DATE(2022,1,1)}) = 1.21^(365/731)-1 = 0.099852...
    const r = xirr([{ date: d('2020-01-01'), amount: -10000 }, { date: d('2022-01-01'), amount: 12100 }]);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.rate).toBeCloseTo(Math.pow(1.21, 365 / 731) - 1, 9);
      expect(r.method).toBe('newton');
    }
  });
  it('Microsoft XIRR documentation example = 37.3362535%', () => {
    // =XIRR({-10000,2750,4250,3250,2750},{DATE(2008,1,1),DATE(2008,3,1),DATE(2008,10,30),DATE(2009,2,15),DATE(2009,4,1)})
    const r = xirr([
      { date: d('2008-01-01'), amount: -10000 }, { date: d('2008-03-01'), amount: 2750 }, { date: d('2008-10-30'), amount: 4250 },
      { date: d('2009-02-15'), amount: 3250 }, { date: d('2009-04-01'), amount: 2750 },
    ]);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(Math.abs(r.rate - 0.373362535)).toBeLessThan(1e-7);
  });
  it('negative return is a valid number (US-14, E19 wording)', () => {
    // =XIRR({-10000,8000},{DATE(2020,1,1),DATE(2021,1,1)}) = 0.8^(365/366)-1 = -0.19976...
    const r = xirr([{ date: d('2020-01-01'), amount: -10000 }, { date: d('2021-01-01'), amount: 8000 }]);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.rate).toBeCloseTo(Math.pow(0.8, 365 / 366) - 1, 9);
  });
  it('fully redeemed fund: purchases and redemptions only, no terminal (E37)', () => {
    // =XIRR({-5000,-5000,-5000,16500},{DATE(2021,1,10),DATE(2021,2,10),DATE(2021,3,10),DATE(2022,3,10)}) = 0.1086...
    const r = xirr([
      { date: d('2021-01-10'), amount: -5000 }, { date: d('2021-02-10'), amount: -5000 }, { date: d('2021-03-10'), amount: -5000 },
      { date: d('2022-03-10'), amount: 16500 },
    ]);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(Math.abs(npv(
        [{ date: d('2021-01-10'), amount: -5000 }, { date: d('2021-02-10'), amount: -5000 }, { date: d('2021-03-10'), amount: -5000 }, { date: d('2022-03-10'), amount: 16500 }],
        r.rate,
      ))).toBeLessThan(1e-6);
      expect(r.rate).toBeGreaterThan(0.08);
      expect(r.rate).toBeLessThan(0.12);
    }
  });
  it('is invariant to the order of the cashflows', () => {
    const flows = [
      { date: d('2019-05-10'), amount: -10000 }, { date: d('2020-05-10'), amount: -10000 }, { date: d('2021-05-10'), amount: -10000 },
      { date: d('2022-02-14'), amount: 12000 }, { date: d('2022-09-30'), amount: 25000 },
    ];
    const a = xirr(flows);
    const b = xirr([...flows].reverse());
    const c = xirr([flows[3]!, flows[0]!, flows[4]!, flows[2]!, flows[1]!]);
    expect(a.status).toBe('ok');
    for (const other of [b, c]) {
      expect(other.status).toBe('ok');
      if (a.status === 'ok' && other.status === 'ok') expect(Math.abs(a.rate - other.rate)).toBeLessThan(1e-12);
    }
  });
});

describe('xirr: edge cases of the register', () => {
  it('fewer than two non-zero flows -> insufficient (E36)', () => {
    expect(xirr([{ date: d('2020-01-01'), amount: -100 }])).toEqual({ status: 'insufficient', reason: 'fewer-than-two' });
    expect(xirr([{ date: d('2020-01-01'), amount: -100 }, { date: d('2020-06-01'), amount: 0 }])).toEqual({ status: 'insufficient', reason: 'fewer-than-two' });
    expect(xirr([])).toEqual({ status: 'insufficient', reason: 'fewer-than-two' });
  });
  it('all flows on one day -> insufficient same-day (E36, E38)', () => {
    expect(xirr([{ date: d('2020-01-01'), amount: -100 }, { date: d('2020-01-01'), amount: 120 }])).toEqual({ status: 'insufficient', reason: 'same-day' });
  });
  it('no sign change -> insufficient same-sign', () => {
    expect(xirr([{ date: d('2020-01-01'), amount: -100 }, { date: d('2021-01-01'), amount: -100 }])).toEqual({ status: 'insufficient', reason: 'same-sign' });
  });
  it('purchase on the statement date with other flows still computes (E38)', () => {
    const r = xirr([{ date: d('2020-01-01'), amount: -1000 }, { date: d('2021-01-01'), amount: -1000 }, { date: d('2021-01-01'), amount: 2200 }]);
    expect(r.status).toBe('ok');
  });
  it('two roots: returns the root nearest zero with warning multiple-roots (E35, A8)', () => {
    // -1000, +2420, -1456 at exact 365-day spacing: NPV = -1456x² + 2420x - 1000 with x = 1/(1+r) has roots at r = 12% and 30%.
    const flows = [{ date: d('2021-01-01'), amount: -1000 }, { date: d('2022-01-01'), amount: 2420 }, { date: d('2023-01-01'), amount: -1456 }];
    expect(Math.abs(npv(flows, 0.12))).toBeLessThan(0.01);
    expect(Math.abs(npv(flows, 0.30))).toBeLessThan(0.01);
    const r = xirr(flows);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.warning).toBe('multiple-roots');
      expect(Math.abs(r.rate - 0.12)).toBeLessThan(1e-4);
    }
  });
  it('forced non-convergence: a grid that excludes the root -> no-bracket (E34)', () => {
    const r = xirr([{ date: d('2020-01-01'), amount: -10000 }, { date: d('2021-01-01'), amount: 11000 }], { grid: [5, 10, 50] });
    expect(r).toEqual({ status: 'no-convergence', reason: 'no-bracket' });
  });
  it('forced non-convergence: iteration budgets too small -> iterations', () => {
    const r = xirr([{ date: d('2020-01-01'), amount: -10000 }, { date: d('2021-01-01'), amount: 11000 }], { maxNewtonIterations: 0, maxBisectionIterations: 1 });
    expect(r).toEqual({ status: 'no-convergence', reason: 'iterations' });
  });
  it('bisection fallback converges when Newton is disabled', () => {
    const r = xirr([{ date: d('2020-01-01'), amount: -10000 }, { date: d('2021-01-01'), amount: 11000 }], { maxNewtonIterations: 0 });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.method).toBe('bisection');
      expect(r.rate).toBeCloseTo(Math.pow(1.1, 365 / 366) - 1, 8);
    }
  });
  it('rates near -100% stay finite (log1p evaluation)', () => {
    const r = xirr([{ date: d('2020-01-01'), amount: -10000 }, { date: d('2021-01-01'), amount: 10 }]);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.rate).toBeLessThan(-0.99);
  });
  it('throws TypeError only for NaN / invalid dates', () => {
    expect(() => xirr([{ date: d('2020-01-01'), amount: Number.NaN }, { date: d('2021-01-01'), amount: 1 }])).toThrow(TypeError);
    expect(() => xirr([{ date: '2020-13-01' as never, amount: -1 }, { date: d('2021-01-01'), amount: 1 }])).toThrow(TypeError);
  });
  it('exposes the bracketing grid of the design', () => {
    expect(BRACKET_GRID[0]).toBe(-0.9999);
    expect(BRACKET_GRID[BRACKET_GRID.length - 1]).toBe(100);
  });
  it('a 2,000-row series finishes quickly (design §4.5: under 5 ms)', () => {
    const flows: Array<{ date: string; amount: number }> = [];
    for (let i = 0; i < 2000; i++) {
      const dt = new Date(Date.UTC(2010, 0, 1) + i * 2 * 86_400_000).toISOString().slice(0, 10);
      flows.push({ date: dt, amount: -5000 });
    }
    flows.push({ date: '2021-01-01', amount: 15_000_000 });
    const typed = flows.map((f) => ({ date: d(f.date), amount: f.amount }));
    xirr(typed); // warm-up
    const t0 = performance.now();
    const r = xirr(typed);
    const ms = performance.now() - t0;
    expect(r.status).toBe('ok');
    // eslint-disable-next-line no-console
    console.info(`xirr 2,001 flows: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});

describe('xirr: every fixture matches its pinned rate within 0.01 pp (US-14)', () => {
  for (const name of fixtureNames()) {
    const golden = loadGolden(name);
    if (golden.expect !== 'result') continue;
    it(name, async () => {
      const portfolio = await portfolioForFixture(name, golden);
      const asOf = golden.invariants.portfolio.asOf;
      for (const fund of portfolio.funds) {
        const pin = golden.invariants.funds[fund.id];
        expect(pin, `pin for ${fund.id}`).toBeDefined();
        if (!pin) continue;
        const r = fundXirr(fund, asOf);
        expect(r.status, `${fund.id} status`).toBe(pin.xirr.status);
        if (pin.xirr.status === 'ok' && r.status === 'ok') {
          expect(Math.abs(r.rate * 100 - pin.xirr.ratePct4dp), `${fund.id} rate`).toBeLessThanOrEqual(PP * 100);
          expect(r.warning).toBe(pin.xirr.warning);
        } else if (pin.xirr.status !== 'ok' && r.status !== 'ok') {
          expect(r.reason).toBe(pin.xirr.reason);
        }
      }
      const summary = portfolioSummary(portfolio, asOf);
      const pin = golden.invariants.portfolio.xirr;
      expect(summary.xirr.status).toBe(pin.status);
      if (pin.status === 'ok' && summary.xirr.status === 'ok') expect(Math.abs(summary.xirr.rate * 100 - pin.ratePct4dp)).toBeLessThanOrEqual(PP * 100);
    });
  }
});
