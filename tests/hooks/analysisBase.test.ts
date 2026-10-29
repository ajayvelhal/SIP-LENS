// Review findings C and F: missed-SIP cost is keyed per SIP, and a throw in a base calculation degrades instead of crashing.
import { describe, expect, it } from 'vitest';
import { disciplineScore } from '../../src/calculations/discipline';
import { missedCostBySip } from '../../src/calculations/discipline';
import { computeBase } from '../../src/hooks/computeBase';
import { d, makeFolio, makeFund, makePortfolio, monthlySips } from '../helpers/factory';
import type { ParseResult, Portfolio } from '../../src/parser/types';

describe('missedCostBySip (finding C)', () => {
  it('two SIPs in one folio each keep their own entry and the total is the sum', () => {
    // Purchases of two different equal amounts form two pattern-detected SIPs inside one folio.
    const specs = [
      ...monthlySips('2022-01', 24, 5000, 100, { skip: ['2022-06', '2022-09'], day: 5 }),
      ...monthlySips('2022-01', 24, 2000, 100, { skip: ['2022-07'], day: 20 }),
    ].map((s) => ({ ...s, kind: 'purchase' as const, description: 'Purchase - via myCAMS' }));
    const folio = makeFolio('F1', specs, { closingNav: 130 });
    const fund = makeFund('INF000MISS01', [folio]);
    const portfolio = makePortfolio([fund], '2023-12-31');
    const disc = disciplineScore(portfolio, d('2023-12-31'));
    const withMissed = disc.sips.filter((s) => s.counts.missed > 0);
    expect(withMissed.length).toBe(2);
    expect(new Set(withMissed.map((s) => s.folioNumber)).size).toBe(1);
    const map = missedCostBySip(portfolio, disc.sips, d('2023-12-31'));
    expect(map.size).toBe(2);
    const total = [...map.values()].reduce((a, c) => a + c.notInvested, 0);
    expect(total).toBe(withMissed.reduce((a, s) => a + s.expected.filter((e) => e.status === 'missed').reduce((x, e) => x + e.amount, 0), 0));
  });
});

describe('computeBase boundary (finding F, design 7.4)', () => {
  const good = makeFund('INF000BASE01', [makeFolio('A', [
    { date: '2022-01-10', kind: 'purchase', amount: 1000, units: 10, nav: 100 },
  ], { closingNav: 110 })]);
  const wrap = (p: Portfolio): ParseResult => ({ status: 'ok', portfolio: p } as unknown as ParseResult);

  it('healthy portfolio: unchanged figures, nothing flagged failed', () => {
    const b = computeBase(wrap(makePortfolio([good], '2023-01-10')));
    expect(b.computeFailed).toBe(false);
    expect(b.summary.totalInvested).toBe(1000);
    expect(b.funds[0]!.xirr.status).toBe('ok');
  });

  it('a malformed fund does not throw: the summary degrades, healthy funds keep their own figures', () => {
    const bad = { ...makeFund('INF000BASE02', []), folios: undefined } as unknown as typeof good;
    let b!: ReturnType<typeof computeBase>;
    expect(() => { b = computeBase(wrap(makePortfolio([good, bad], '2023-01-10'))); }).not.toThrow();
    expect(b.computeFailed).toBe(true);
    expect(b.summary.xirr.status).toBe('no-convergence');
    expect(b.isEmpty).toBe(true);
    expect(b.funds).toHaveLength(2);
    expect(b.funds[0]!.xirr.status).toBe('ok');
    expect(b.funds[0]!.totals.invested).toBe(1000);
    expect(b.funds[1]!.xirr.status).toBe('no-convergence');
    expect(b.funds[1]!.totals.invested).toBe(0);
  });
});
