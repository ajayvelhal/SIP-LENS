// FIFO lot builder: unit_adjustment rows reach the lots although they carry no cash (review finding A),
// and redemptions consume units of their own folio only (finding E).
import { describe, expect, it } from 'vitest';
import { buildFifoLots } from '../../src/calculations/fifo';
import { buildCashflows } from '../../src/calculations/cashflows';
import { taxEstimate, type CategoryInfo } from '../../src/calculations/tax';
import { d, makeFolio, makeFund, makePortfolio } from '../helpers/factory';

const ASOF = d('2024-12-31');
const equity: CategoryInfo = { category: 'Equity', subCategory: 'Large Cap Fund', taxClass: 'equity', isElss: false };

describe('fifo: unit_adjustment rows (finding A)', () => {
  it('a bonus row (excluded from cashflows, as the parser marks it) still creates a lot at its printed NAV', () => {
    const folio = makeFolio('F1', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2022-06-10', kind: 'unit_adjustment', units: 10, nav: 50, amount: 500 },
    ], { closingNav: 120 });
    expect(folio.transactions[1]!.excludedFromCashflows).toBe(true);
    const fund = makeFund('INF000FIFO01', [folio]);
    const { openLots } = buildFifoLots(fund, ASOF);
    expect(openLots.map((l) => [l.source, l.units, l.costPerUnit])).toEqual([['purchase', 100, 100], ['unit_adjustment', 10, 50]]);
  });

  it('a zero-cost bonus lot is unknown-holding in tax and adds no cashflow, no invested rupee and no XIRR leg', () => {
    const folio = makeFolio('F1', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2022-06-10', kind: 'unit_adjustment', units: 10 },
    ], { closingNav: 120 });
    const fund = makeFund('INF000FIFO02', [folio]);
    const tax = taxEstimate(makePortfolio([fund], '2024-12-31'), ASOF, () => equity);
    expect(tax.funds[0]!.lots.map((l) => l.term)).toEqual(['long', 'unknown-holding']);
    // unknown-holding gain is excluded from every aggregate: only the purchase lot (100 x (120-100)) counts.
    expect(tax.equity.longTermGain).toBe(2000);
    const s = buildCashflows([fund], ASOF);
    expect(s.cashflows.map((c) => c.amount)).toEqual([-10000]);
    expect(s.totals.invested).toBe(10000);
  });

  it('a negative unit_adjustment (transfer out) consumes the oldest lots', () => {
    const folio = makeFolio('F1', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2022-03-10', kind: 'purchase', amount: 5000, units: 50, nav: 100 },
      { date: '2022-06-10', kind: 'unit_adjustment', units: -120 },
    ], { closingNav: 100 });
    const { openLots, realisedEvents } = buildFifoLots(makeFund('INF000FIFO03', [folio]), ASOF);
    expect(openLots.map((l) => [l.acquiredOn, l.units])).toEqual([['2022-03-10', 30]]);
    expect(realisedEvents).toEqual([]);   // not a redemption: no realised event
  });

  it('a unit_adjustment that was reversed stays out of the lots', () => {
    const folio = makeFolio('F1', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2022-06-10', kind: 'unit_adjustment', units: 10, nav: 50, amount: 500 },
      { date: '2022-06-11', kind: 'reversal', units: -10, nav: 50, amount: -500, excluded: true },
    ], { closingNav: 100 });
    const [, adj, rev] = folio.transactions;
    adj!.reversedBy = rev!.id; rev!.reverses = adj!.id;
    const { openLots } = buildFifoLots(makeFund('INF000FIFO04', [folio]), ASOF);
    expect(openLots.map((l) => l.units)).toEqual([100]);
  });
});

describe('fifo: redemptions consume their own folio (finding E; design is silent, units are held per folio)', () => {
  it('a redemption in folio B leaves folio A untouched even though A holds the oldest lot', () => {
    const a = makeFolio('A', [{ date: '2021-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 }], { closingNav: 100 });
    const b = makeFolio('B', [
      { date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 },
      { date: '2023-01-10', kind: 'redemption', amount: -6000, units: -60, nav: 100 },
    ], { closingNav: 100 });
    const { openLots, realisedEvents } = buildFifoLots(makeFund('INF000FIFO05', [a, b]), ASOF);
    expect(openLots.map((l) => [l.folioNumber, l.units])).toEqual([['A', 100], ['B', 40]]);
    expect(realisedEvents[0]!.fromLots).toEqual([{ acquiredOn: '2022-01-10', units: 60 }]);
  });

  it('oldest-first still applies inside a folio, and a redemption never spills into another folio', () => {
    const a = makeFolio('A', [{ date: '2021-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 }], { closingNav: 100 });
    const b = makeFolio('B', [
      { date: '2022-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
      { date: '2022-02-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
      { date: '2023-01-10', kind: 'redemption', amount: -1500, units: -15, nav: 100 },
    ], { closingNav: 100 });
    const { openLots } = buildFifoLots(makeFund('INF000FIFO06', [a, b]), ASOF);
    expect(openLots.map((l) => [l.folioNumber, l.acquiredOn, l.units])).toEqual([['A', '2021-01-10', 10], ['B', '2022-02-10', 5]]);
  });
});
