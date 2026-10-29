// SIP discipline (design §4.6, Q4, A18, A19, A25; US-23 to US-26): fixture pins and the register's cases E29-E33.
import { describe, expect, it } from 'vitest';
import { disciplineScore, missedSipCost } from '../src/calculations/discipline';
import { daysBetween } from '../src/calculations/dates';
import { fixtureNames } from './helpers/pdfjsNode';
import { loadGolden, portfolioForFixture } from './helpers/golden';
import { d, makeFolio, makeFund, makePortfolio, monthlySips } from './helpers/factory';

describe('discipline: fixtures reproduce the pinned SIPs', () => {
  for (const name of fixtureNames()) {
    const golden = loadGolden(name);
    if (golden.expect !== 'result') continue;
    const pins = golden.invariants.discipline;
    // The stress fixture pins no SIP on purpose (pin: false in the generator); its discipline is not compared.
    if (golden.digest && pins.sips.length === 0) continue;
    it(name, async () => {
      const portfolio = await portfolioForFixture(name, golden);
      const res = disciplineScore(portfolio, golden.invariants.portfolio.asOf);
      for (const pin of pins.sips) {
        const sip = res.sips.find((s) => s.fundId === pin.fundId && s.folioNumber === pin.folioNumber);
        expect(sip, `SIP ${pin.fundId} / ${pin.folioNumber}`).toBeDefined();
        if (!sip) continue;
        expect(sip.frequency).toBe(pin.frequency);
        expect(sip.counts, `${pin.fundId} counts`).toEqual(pin.counts);
        expect(sip.percent, `${pin.fundId} percent`).toBe(pin.percent);
        expect(sip.stoppedSince, `${pin.fundId} stoppedSince`).toBe(pin.stoppedSince);
        expect(Math.abs(daysBetween(sip.firstDate, pin.firstDate))).toBeLessThanOrEqual(7);
        expect(sip.amounts.map((a) => a.amount)).toEqual(pin.amounts.map((a) => a.amount));
        sip.amounts.forEach((a, i) => expect(Math.abs(daysBetween(a.from, pin.amounts[i]!.from)), `${pin.fundId} step-up ${i} date`).toBeLessThanOrEqual(7));
        expect(sip.evidence).toBe('description');
      }
      expect(res.sips.length, 'no extra SIPs detected').toBe(pins.sips.length);
      expect(res.score).toBe(pins.score);
    });
  }
});

describe('discipline: register cases', () => {
  it('step-up continues the same SIP with a new amount; expected amounts follow (E29, A18)', () => {
    const specs = monthlySips('2022-01', 24, 5000, 100, { stepFrom: '2023-01-01', stepAmount: 7500 });
    const fund = makeFund('INF000SIP01', [makeFolio('F', specs, { closingNav: 120 })]);
    const res = disciplineScore(makePortfolio([fund], '2023-12-31'), d('2023-12-31'));
    expect(res.sips).toHaveLength(1);
    const sip = res.sips[0]!;
    expect(sip.amounts).toEqual([{ from: '2022-01-10', amount: 5000 }, { from: '2023-01-10', amount: 7500 }]);
    expect(sip.counts).toEqual({ expected: 24, made: 24, missed: 0, stopped: 0 });
    expect(sip.frequency).toBe('monthly');
    expect(res.score).toBe(100);
  });
  it('a pause of at most two periods counts as missed instalments (E30)', () => {
    const specs = monthlySips('2022-01', 12, 4000, 100, { skip: ['2022-06', '2022-07'] });
    const fund = makeFund('INF000SIP02', [makeFolio('F', specs, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-12-31'), d('2022-12-31'));
    const sip = res.sips[0]!;
    expect(sip.counts).toEqual({ expected: 12, made: 10, missed: 2, stopped: 0 });
    expect(sip.expected.filter((e) => e.status === 'missed').map((e) => e.date)).toEqual(['2022-06-10', '2022-07-10']);
    expect(sip.percent).toBe(83);
    expect(res.score).toBe(83);
  });
  it('silence beyond two periods before the statement date marks the SIP stopped, not missed (E31)', () => {
    const specs = monthlySips('2022-01', 6, 3000);
    const fund = makeFund('INF000SIP03', [makeFolio('F', specs, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-12-31'), d('2022-12-31'));
    const sip = res.sips[0]!;
    expect(sip.stoppedSince).toBe('2022-07-10');
    expect(sip.counts).toEqual({ expected: 12, made: 6, missed: 0, stopped: 6 });
    expect(sip.percent).toBe(100);
  });
  it('exactly two periods of silence is not yet stopped', () => {
    const specs = monthlySips('2022-01', 10, 3000);
    const fund = makeFund('INF000SIP03b', [makeFolio('F', specs, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-12-10'), d('2022-12-10'));
    const sip = res.sips[0]!;
    expect(sip.stoppedSince).toBeUndefined();
    expect(sip.counts).toEqual({ expected: 12, made: 10, missed: 2, stopped: 0 });
  });
  it('one-off top-ups are not instalments and lump sums do not form a SIP (E32)', () => {
    const specs = [...monthlySips('2022-01', 12, 5000), { date: '2022-03-20', kind: 'purchase' as const, amount: 50000, units: 500, nav: 100 }, { date: '2022-09-21', kind: 'purchase' as const, amount: 50000, units: 500, nav: 100 }];
    const fund = makeFund('INF000SIP04', [makeFolio('F', specs, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-12-31'), d('2022-12-31'));
    expect(res.sips).toHaveLength(1);
    expect(res.sips[0]!.instalmentIds).toHaveLength(12);
    expect(res.fundsWithoutSip).toEqual([]);
  });
  it('a SIP dated on the 31st clamps to month end and matches within the grace (E33)', () => {
    const specs = monthlySips('2022-01', 12, 2000, 100, { day: 31 });
    const fund = makeFund('INF000SIP05', [makeFolio('F', specs, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-12-31'), d('2022-12-31'));
    const sip = res.sips[0]!;
    expect(sip.expected.map((e) => e.date).slice(0, 4)).toEqual(['2022-01-31', '2022-02-28', '2022-03-31', '2022-04-30']);
    expect(sip.counts).toEqual({ expected: 12, made: 12, missed: 0, stopped: 0 });
  });
  it('detects weekly and quarterly frequencies', () => {
    const weekly = [];
    for (let i = 0; i < 20; i++) weekly.push({ date: new Date(Date.UTC(2024, 3, 3) + i * 7 * 86_400_000).toISOString().slice(0, 10), kind: 'sip' as const, amount: 1000, units: 10, nav: 100 });
    const quarterly = monthlySips('2022-03', 8, 15000, 100, { step: 3, day: 5 });
    const w = makeFund('INF000SIPW', [makeFolio('W', weekly, { closingNav: 100 })]);
    const q = makeFund('INF000SIPQ', [makeFolio('Q', quarterly, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([w, q], '2024-08-21'), d('2024-08-21'));
    const ws = res.sips.find((s) => s.fundId === 'INF000SIPW')!;
    const qs = res.sips.find((s) => s.fundId === 'INF000SIPQ')!;
    expect(ws.frequency).toBe('weekly');
    expect(ws.counts).toEqual({ expected: 21, made: 20, missed: 1, stopped: 0 });
    expect(qs.frequency).toBe('quarterly');
    // 8 quarterly instalments Mar 2022 .. Dec 2023; two quarters of silence before 21 Aug 2024 -> stopped since Mar 2024
    expect(qs.counts).toEqual({ expected: 10, made: 8, missed: 0, stopped: 2 });
    expect(qs.stoppedSince).toBe('2024-03-05');
  });
  it('detects a SIP from an amount/spacing pattern when rows are described as purchases (Q4)', () => {
    const specs = monthlySips('2022-01', 6, 5000).map((s) => ({ ...s, kind: 'purchase' as const, description: 'Purchase - via Online' }));
    const fund = makeFund('INF000SIP06', [makeFolio('F', specs, { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-06-30'), d('2022-06-30'));
    expect(res.sips).toHaveLength(1);
    expect(res.sips[0]!.evidence).toBe('pattern');
    expect(res.sips[0]!.counts.made).toBe(6);
  });
  it('a reversed instalment is not made and counts as missed (P15)', () => {
    const specs = monthlySips('2022-01', 6, 5000);
    const folio = makeFolio('F', [...specs, { date: '2022-03-13', kind: 'reversal', amount: -5000, units: -50, nav: 100, excluded: true }], { closingNav: 100 });
    const orig = folio.transactions[2]!; const rev = folio.transactions[6]!;
    orig.excludedFromCashflows = true; orig.reversedBy = rev.id; rev.reverses = orig.id;
    const res = disciplineScore(makePortfolio([makeFund('INF000SIP07', [folio])], '2022-06-30'), d('2022-06-30'));
    expect(res.sips[0]!.counts).toEqual({ expected: 6, made: 5, missed: 1, stopped: 0 });
  });
  it('no SIP anywhere -> score null and the fund is listed without a SIP (US-25)', () => {
    const fund = makeFund('INF000SIP08', [makeFolio('F', [{ date: '2022-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100 }], { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-12-31'), d('2022-12-31'));
    expect(res.score).toBeNull();
    expect(res.sips).toEqual([]);
    expect(res.fundsWithoutSip).toEqual(['INF000SIP08']);
  });
  it('weights the score by instalment amount across SIPs (A19)', () => {
    const big = makeFund('INF000BIG', [makeFolio('A', monthlySips('2022-01', 10, 10000, 100, { skip: ['2022-05'] }), { closingNav: 100 })]);
    const small = makeFund('INF000SMALL', [makeFolio('B', monthlySips('2022-01', 10, 1000), { closingNav: 100 })]);
    const res = disciplineScore(makePortfolio([big, small], '2022-10-31'), d('2022-10-31'));
    // made 90,000 + 10,000 of expected 100,000 + 10,000
    expect(res.score).toBe(91);
  });
});

describe('missedSipCost (US-26, A25)', () => {
  it('interpolates the NAV between the neighbouring instalments and values the missed cash at the closing NAV', () => {
    const specs = monthlySips('2022-01', 4, 1000, 100, { skip: ['2022-02'] });
    specs[1]!.nav = 120; specs[1]!.units = Math.round((1000 / 120) * 1000) / 1000; // March at 120 -> Feb interpolated ~ 110
    specs[2]!.nav = 130; specs[2]!.units = Math.round((1000 / 130) * 1000) / 1000;
    const fund = makeFund('INF000MISS', [makeFolio('F', specs, { closingNav: 150 })]);
    const res = disciplineScore(makePortfolio([fund], '2022-04-30'), d('2022-04-30'));
    const cost = missedSipCost(fund, res.sips[0]!, d('2022-04-30'));
    expect(cost).not.toBeNull();
    expect(cost!.perInstalment).toHaveLength(1);
    const p = cost!.perInstalment[0]!;
    expect(p.date).toBe('2022-02-10');
    expect(p.navSource).toBe('interpolated');
    // 31 of 59 days between 10 Jan (100) and 10 Mar (120)
    expect(p.navEstimate).toBeCloseTo(100 + 20 * (31 / 59), 6);
    expect(cost!.notInvested).toBe(1000);
    expect(cost!.wouldBeWorth).toBeCloseTo((1000 / p.navEstimate) * 150, 2);
    expect(cost!.growthForgone).toBe(Math.round(cost!.wouldBeWorth - 1000));
  });
  it('returns null without a closing NAV', () => {
    const fund = makeFund('INF000MISS2', [makeFolio('F', monthlySips('2022-01', 4, 1000, 100, { skip: ['2022-02'] }))]);
    const res = disciplineScore(makePortfolio([fund], '2022-04-30'), d('2022-04-30'));
    expect(missedSipCost(fund, res.sips[0]!, d('2022-04-30'))).toBeNull();
  });
});
