// Cashflow builder (design §4.3 mapping table, V-5, V-13) against every golden's pinned flows, plus the mapping rules in isolation.
import { describe, expect, it } from 'vitest';
import { buildCashflows } from '../../src/calculations/cashflows';
import { fundSeries, fundTotals, fundXirr, portfolioSummary } from '../../src/calculations/portfolio';
import { fixtureNames } from '../helpers/pdfjsNode';
import { loadGolden, portfolioForFixture } from '../helpers/golden';
import { d, makeFolio, makeFund, makePortfolio } from '../helpers/factory';

describe('cashflows: fixtures reproduce the pinned investor series', () => {
  for (const name of fixtureNames()) {
    const golden = loadGolden(name);
    if (golden.expect !== 'result') continue;
    it(name, async () => {
      const portfolio = await portfolioForFixture(name, golden);
      const asOf = golden.invariants.portfolio.asOf;
      for (const fund of portfolio.funds) {
        const pin = golden.invariants.funds[fund.id];
        if (!pin) throw new Error(`no pin for ${fund.id}`);
        const series = fundSeries(fund, asOf);
        const totals = fundTotals(fund, asOf);
        expect(totals.invested, `${fund.id} invested`).toBeCloseTo(pin.invested, 2);
        expect(totals.redeemed, `${fund.id} redeemed`).toBeCloseTo(pin.redeemed, 2);
        expect(totals.netInvested, `${fund.id} net`).toBeCloseTo(pin.netInvested, 2);
        expect(totals.terminalValue, `${fund.id} terminal`).toBeCloseTo(pin.terminalValue, 2);
        expect(series.cashflows.length, `${fund.id} cashflowCount`).toBe(pin.cashflowCount);
        expect(series.ignored.length, `${fund.id} ignoredCount`).toBe(pin.ignoredCount);
        if (pin.cashflows) {
          const actual = [...series.cashflows, ...(series.terminal ? [series.terminal] : [])];
          expect(actual.length).toBe(pin.cashflows.length);
          actual.forEach((cf, i) => {
            const exp = pin.cashflows![i]!;
            expect(cf.date, `${fund.id} flow ${i} date`).toBe(exp.date);
            expect(Math.abs(cf.amount - exp.amount), `${fund.id} flow ${i} amount`).toBeLessThanOrEqual(0.005);
            // Labels are UI strings and not a golden comparison rule (§4.6); the kind word must agree.
            expect(cf.label.split(' + ')[0]!.split(' − ')[0], `${fund.id} flow ${i} label`).toBe(exp.label.split(' + ')[0]!.split(' − ')[0]);
          });
        }
        if (pin.ignored) {
          const key = (x: { transactionId: string; reason: string }) => `${x.transactionId}|${x.reason}`;
          expect(series.ignored.map(key).sort()).toEqual(pin.ignored.map(key).sort());
        }
      }
      const summary = portfolioSummary(portfolio, asOf);
      const p = golden.invariants.portfolio;
      expect(summary.totalInvested).toBeCloseTo(p.totalInvested, 2);
      expect(summary.totalRedeemed).toBeCloseTo(p.totalRedeemed, 2);
      expect(summary.valueAsOfStatementDate).toBeCloseTo(p.valueAsOfStatementDate, 2);
      expect(summary.fundsWithoutPrintedValue).toBe(p.fundsWithoutPrintedValue);
      expect(summary.series.totals.terminalValue).toBeCloseTo(p.terminalValue, 2);
      expect([...summary.skippedFunds].sort((a, b) => a.fundId.localeCompare(b.fundId))).toEqual([...p.skippedFunds].sort((a, b) => a.fundId.localeCompare(b.fundId)));
    });
  }
});

describe('cashflows: mapping rules', () => {
  it('folds stamp duty into the purchase outflow and STT into the redemption inflow (Q5, E20, E22)', () => {
    const folio = makeFolio('F1', [
      { date: '2021-01-10', kind: 'sip', amount: 9999.5, units: 100, nav: 99.995, stampDuty: 0.5 },
      { date: '2021-06-10', kind: 'redemption', amount: -6000, units: -50, nav: 120, stt: 0.06 },
    ], { closingNav: 130 });
    const fund = makeFund('INF000TEST01', [folio]);
    const s = buildCashflows([fund], d('2021-12-31'));
    expect(s.cashflows.map((c) => [c.date, c.amount, c.label])).toEqual([
      ['2021-01-10', -10000, 'SIP + stamp duty'],
      ['2021-06-10', 5999.94, 'Redemption − STT'],
    ]);
    expect(s.cashflows[1]!.fractionOfHolding).toBeCloseTo(0.5, 9);
    expect(s.cashflows[0]!.transactionIds).toHaveLength(2);
    expect(s.terminal).toMatchObject({ amount: 6500, kind: 'terminal', label: 'Value as of statement date' });
    expect(s.totals).toEqual({ invested: 10000, redeemed: 5999.94, terminalValue: 6500 });
  });
  it('an orphan levy is its own outflow; reversed pairs, reinvestments and no-cash kinds are ignored with a reason (E16, E18, E21, V-13)', () => {
    const folio = makeFolio('F1', [
      { date: '2021-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2021-02-10', kind: 'purchase', amount: 5000, units: 50, nav: 100 },
      { date: '2021-02-13', kind: 'reversal', amount: -5000, units: -50, nav: 100, excluded: true },
      { date: '2021-03-10', kind: 'dividend_reinvest', amount: 100, units: 1, nav: 100 },
      { date: '2021-04-10', kind: 'unit_adjustment', units: 10 },
      { date: '2021-05-10', kind: 'segregated', units: 5 },
      { date: '2021-06-10', kind: 'unknown' },
      { date: '2021-07-10', kind: 'stamp_duty', amount: 0.5 },
      { date: '2022-02-01', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
    ], { closingNav: 100 });
    const tx = folio.transactions;
    tx[1]!.excludedFromCashflows = true; tx[1]!.reversedBy = tx[2]!.id; tx[2]!.reverses = tx[1]!.id;
    const fund = makeFund('INF000TEST02', [folio]);
    const s = buildCashflows([fund], d('2021-12-31'));
    expect(s.cashflows.map((c) => [c.date, c.amount, c.label])).toEqual([
      ['2021-01-10', -10000, 'Purchase'],
      ['2021-07-10', -0.5, 'Stamp duty (no parent row)'],
    ]);
    expect(s.ignored.map((i) => i.reason).sort()).toEqual(['dividend_reinvest', 'future_dated', 'reversal', 'reversed', 'segregated', 'unit_adjustment', 'unknown'].sort());
  });
  it('skips incomplete and opening-balance funds for the pooled series and lists them (A23, D5)', () => {
    const ok = makeFund('INF000TESTOK', [makeFolio('A', [{ date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 }], { closingNav: 110 })]);
    const incomplete = makeFund('INF000TESTBAD', [makeFolio('B', [{ date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 }], { closingNav: 110 })], { mayBeIncomplete: true });
    const opening = makeFund('INF000TESTOPEN', [makeFolio('C', [{ date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 }], { closingNav: 110, openingUnits: 50 })]);
    const s = buildCashflows([ok, incomplete, opening], d('2021-12-31'));
    expect(s.skippedFundIds).toEqual(['INF000TESTBAD', 'INF000TESTOPEN']);
    expect(s.cashflows).toHaveLength(1);
    expect(s.terminal?.amount).toBe(1100);
    const all = buildCashflows([ok, incomplete, opening], d('2021-12-31'), { includeIncomplete: true, includeOpeningBalance: true });
    expect(all.skippedFundIds).toEqual([]);
    expect(all.cashflows).toHaveLength(3);
    expect(all.terminal?.fundId).toBe('portfolio');
  });
  it('orders same-day flows outflows first, then by transaction order', () => {
    const fund = makeFund('INF000TEST03', [makeFolio('A', [
      { date: '2021-01-10', kind: 'redemption', amount: -500, units: -5, nav: 100 },
      { date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
      { date: '2021-01-10', kind: 'purchase', amount: 2000, units: 20, nav: 100 },
    ], { closingNav: 100, openingUnits: 0 })]);
    const s = buildCashflows([fund], d('2021-06-30'), { includeOpeningBalance: true });
    expect(s.cashflows.map((c) => c.amount)).toEqual([-1000, -2000, 500]);
  });
  it('omits the terminal when units are 0 or the closing NAV is unknown', () => {
    const redeemed = makeFund('INF000TEST04', [makeFolio('A', [
      { date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
      { date: '2021-06-10', kind: 'redemption', amount: -1200, units: -10, nav: 120 },
    ], { closingNav: 130 })]);
    expect(buildCashflows([redeemed], d('2021-12-31')).terminal).toBeUndefined();
    const noNav = makeFund('INF000TEST05', [makeFolio('A', [{ date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 }])]);
    expect(buildCashflows([noNav], d('2021-12-31')).terminal).toBeUndefined();
    expect(makePortfolio([noNav], '2021-12-31').funds[0]!.closingValue).toBeUndefined();
  });
});

describe('cashflows: held units with no closing NAV (review finding B; design 4.3 terminal row, A23)', () => {
  const buy = { date: '2021-01-10', kind: 'purchase' as const, amount: 1000, units: 10, nav: 100 };
  const withValueOnly = () => {
    const folio = makeFolio('A', [buy], { closingUnits: 10 });
    folio.closingValue = 1200;
    return makeFund('INF000NONAV1', [folio]);
  };

  it('falls back to the printed closing value for the terminal flow, so XIRR is not -100%', () => {
    const fund = withValueOnly();
    expect(fund.closingNav).toBeUndefined();
    const s = buildCashflows([fund], d('2022-01-10'));
    expect(s.terminal).toMatchObject({ amount: 1200, kind: 'terminal' });
    const x = portfolioSummary(makePortfolio([fund], '2022-01-10'), d('2022-01-10')).xirr;
    expect(x.status).toBe('ok');
    if (x.status === 'ok') expect(x.rate).toBeCloseTo(0.2, 3);   // 1000 -> 1200 over one year
  });

  it('with neither NAV nor value the pooled series skips the fund (listed) rather than reporting outflows only', () => {
    const noValue = makeFund('INF000NONAV2', [makeFolio('A', [buy], { closingUnits: 10 })]);
    const ok = makeFund('INF000NONAV3', [makeFolio('B', [buy], { closingNav: 110 })]);
    const p = makePortfolio([noValue, ok], '2022-01-10');
    const s = buildCashflows(p.funds, d('2022-01-10'));
    expect(s.skippedFundIds).toEqual(['INF000NONAV2']);
    expect(s.totals.invested).toBe(1000);
    const sum = portfolioSummary(p, d('2022-01-10'));
    expect(sum.skippedFunds).toEqual([{ fundId: 'INF000NONAV2', reason: 'no-closing-value' }]);
    expect(sum.xirr.status).toBe('ok');
  });

  it('fundXirr reports insufficient (not -100%) when units are held and no value is printed; a fully redeemed fund is unaffected', () => {
    const noValue = makeFund('INF000NONAV4', [makeFolio('A', [buy], { closingUnits: 10 })]);
    expect(fundXirr(noValue, d('2022-01-10'))).toEqual({ status: 'insufficient', reason: 'no-closing-value' });
    const redeemed = makeFund('INF000NONAV5', [makeFolio('A', [buy, { date: '2021-07-10', kind: 'redemption', amount: -1100, units: -10, nav: 110 }])]);
    expect(fundXirr(redeemed, d('2022-01-10')).status).toBe('ok');
  });
});
