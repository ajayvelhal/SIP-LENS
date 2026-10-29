// Tax preview (design §4.8, US-30 to US-34): FIFO across switch-ins and reinvestments, the exemption applied once,
// ELSS lock-in, FY-boundary and 29-Feb holding periods, slab/hybrid/unclassified exclusions, and the fixture's pinned lots.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFifoLots } from '../src/calculations/fifo';
import { taxEstimate, type CategoryInfo } from '../src/calculations/tax';
import { rulesForDate, TAX_RULES, TAX_DISCLAIMER_LONG } from '../src/calculations/taxRules';
import { addMonths, fyOf } from '../src/calculations/dates';
import { makeCategoryLookup } from '../src/data/categories';
import type { IsinCategoryFile } from '../src/data/types';
import { FIXTURES_DIR } from './helpers/pdfjsNode';
import { loadGolden } from './helpers/golden';
import { d, makeFolio, makeFund, makePortfolio } from './helpers/factory';
import type { Portfolio } from '../src/parser/types';

const fixtureMap = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'isinCategory.fixture.json'), 'utf8')) as IsinCategoryFile;
const categoryOf = makeCategoryLookup(fixtureMap);
const equity: CategoryInfo = { category: 'Equity', subCategory: 'Large Cap Fund', taxClass: 'equity', isElss: false };
const elss: CategoryInfo = { category: 'Equity', subCategory: 'ELSS', taxClass: 'equity', isElss: true };
const debt: CategoryInfo = { category: 'Debt', subCategory: 'Liquid Fund', taxClass: 'debt', isElss: false };
const hybrid: CategoryInfo = { category: 'Hybrid', subCategory: 'Balanced Advantage Fund', taxClass: 'hybrid-other', isElss: false };
const lookup = (m: Record<string, CategoryInfo>) => (isin: string | undefined) => (isin ? m[isin] : undefined);

describe('tax: fixture pins (cams-2025-elss-tax)', () => {
  const golden = loadGolden('cams-2025-elss-tax');
  it('reproduces every pinned FIFO lot: date, term, unlock date, units, cost basis and gain', () => {
    if (golden.expect !== 'result' || !golden.invariants.taxLots) throw new Error('fixture has no taxLots');
    const portfolio = { ...golden.result.portfolio, parsedAt: 'test' } as unknown as Portfolio;
    const asOf = golden.invariants.portfolio.asOf;
    const res = taxEstimate(portfolio, asOf, categoryOf);
    expect(res.excludedFunds).toEqual([]);
    for (const [fundId, pin] of Object.entries(golden.invariants.taxLots)) {
      const ft = res.funds.find((f) => f.fundId === fundId)!;
      expect(ft, fundId).toBeDefined();
      expect(ft.taxClass).toBe(pin.taxClass);
      expect(ft.isElss).toBe(pin.isElss);
      expect(ft.lots.length, `${fundId} lot count`).toBe(pin.lots.length);
      ft.lots.forEach((lt, i) => {
        const exp = pin.lots[i]!;
        expect(lt.lot.acquiredOn, `${fundId} lot ${i} date`).toBe(exp.acquiredOn);
        expect(lt.term, `${fundId} lot ${i} term`).toBe(exp.term);
        expect(lt.unlockOn, `${fundId} lot ${i} unlock`).toBe(exp.unlockOn);
        expect(Math.abs(lt.lot.units - exp.units)).toBeLessThanOrEqual(0.001);
        expect(Math.abs(lt.lot.costPerUnit - exp.costPerUnit)).toBeLessThanOrEqual(1e-4);
        expect(Math.abs(lt.gain - exp.gain), `${fundId} lot ${i} gain`).toBeLessThanOrEqual(0.01);
        expect(lt.lot.source).toBe(exp.source);
      });
    }
    // The design's own checks on this fixture (02-database-design.md §4.3)
    const elssTax = res.funds.find((f) => f.fundId === 'INF000S01EL2')!;
    expect(elssTax.lots.filter((l) => l.term === 'long')).toHaveLength(2);
    expect(elssTax.lots.filter((l) => l.term === 'locked')).toHaveLength(39);
    expect(elssTax.lots.find((l) => l.term === 'locked')!.unlockOn).toBe('2025-10-10');
    const lc = res.funds.find((f) => f.fundId === 'INF000S01LC6')!;
    expect(lc.lots.map((l) => [l.lot.acquiredOn, l.term])).toEqual([['2024-03-28', 'long'], ['2024-09-27', 'long'], ['2024-09-30', 'short']]);
    expect(res.funds.find((f) => f.fundId === 'INF000S01LQ6')!.note).toBe('taxed at your income-tax slab');
    expect(res.funds.find((f) => f.fundId === 'INF000S01BA1')!.taxClass).toBe('hybrid-other');
    expect(res.funds.find((f) => f.fundId === 'INF000S01AG0')!.taxClass).toBe('equity');
    expect(res.funds.find((f) => f.fundId === 'INF000S01IN9')!.taxClass).toBe('debt');
    expect(res.estimatedTaxIfRedeemed).toBe(res.equity.shortTermTax + res.equity.longTermTax);
    expect(res.disclaimerLong).toBe(TAX_DISCLAIMER_LONG);
  });
});

describe('fifo', () => {
  it('matches oldest units first across switch-in and reinvestment lots, same-day by row order (US-30, E42)', () => {
    const folio = makeFolio('F', [
      { date: '2021-01-10', kind: 'purchase', amount: 10000, units: 100, nav: 100, stampDuty: 0.5 },
      { date: '2021-06-10', kind: 'switch_in', amount: 5500, units: 50, nav: 110 },
      { date: '2021-09-10', kind: 'dividend_reinvest', amount: 120, units: 1, nav: 120 },
      { date: '2022-01-10', kind: 'redemption', amount: -14400, units: -120, nav: 120 },
    ], { closingNav: 130 });
    const fifo = buildFifoLots(makeFund('INF000FIFO', [folio]), d('2022-12-31'));
    expect(fifo.openLots.map((l) => [l.acquiredOn, l.units, l.source])).toEqual([['2021-06-10', 30, 'switch_in'], ['2021-09-10', 1, 'dividend_reinvest']]);
    expect(fifo.realisedEvents).toHaveLength(1);
    expect(fifo.realisedEvents[0]!.fromLots).toEqual([{ acquiredOn: '2021-01-10', units: 100 }, { acquiredOn: '2021-06-10', units: 20 }]);
    expect(fifo.syntheticOpeningLot).toBeUndefined();
  });
  it('cost basis per unit includes stamp duty; reinvest lots cost their NAV', () => {
    const folio = makeFolio('F', [
      { date: '2021-01-10', kind: 'purchase', amount: 9999.5, units: 100, nav: 99.995, stampDuty: 0.5 },
      { date: '2021-09-10', kind: 'dividend_reinvest', amount: 120, units: 1, nav: 120 },
    ], { closingNav: 130 });
    const fifo = buildFifoLots(makeFund('INF000FIFO2', [folio]), d('2022-12-31'));
    expect(fifo.openLots[0]!.costPerUnit).toBeCloseTo(100, 6);
    expect(fifo.openLots[0]!.nav).toBe(99.995);
    expect(fifo.openLots[1]!.costPerUnit).toBe(120);
  });
  it('opening balance without history becomes a synthetic lot that tax marks unknown-holding (E43)', () => {
    const folio = makeFolio('F', [{ date: '2023-02-10', kind: 'sip', amount: 1000, units: 10, nav: 100 }], { closingNav: 120, openingUnits: 500 });
    const fund = makeFund('INF000OPEN', [folio]);
    const fifo = buildFifoLots(fund, d('2023-12-31'), d('2022-04-01'));
    expect(fifo.syntheticOpeningLot).toMatchObject({ acquiredOn: '2022-04-01', units: 500, nav: 100, source: 'opening_balance' });
    const res = taxEstimate(makePortfolio([fund], '2023-12-31', '2022-04-01'), d('2023-12-31'), lookup({ INF000OPEN: equity }));
    const ft = res.funds[0]!;
    expect(ft.lots[0]!.term).toBe('unknown-holding');
    expect(ft.note).toMatch(/holding period unknown/);
    expect(ft.shortTermGain).toBe(200); // only the 10-unit lot (120 - 100) x 10
    expect(ft.longTermGain).toBe(0);
  });
});

describe('tax: rules, terms and aggregates', () => {
  it('rulesForDate picks by the statement date\'s FY on both sides of 1 April (A17, E40)', () => {
    expect(fyOf(d('2026-03-31'))).toBe('FY2025-26');
    expect(fyOf(d('2026-04-01'))).toBe('FY2026-27');
    expect(rulesForDate(d('2026-04-01'))).toEqual({ rules: TAX_RULES[0], exactFy: true });
    expect(rulesForDate(d('2027-03-31')).exactFy).toBe(true);
    expect(rulesForDate(d('2026-03-31'))).toEqual({ rules: TAX_RULES[0], exactFy: false });
    expect(rulesForDate(d('2027-04-01')).exactFy).toBe(false);
  });
  it('the config ships to-verify with the Appendix F table and no verifier yet (C5, US-31)', () => {
    const r = TAX_RULES[0]!;
    expect(r.status).toBe('to-verify');
    expect(r.verifiedBy).toBe('');
    expect(r.displayTable).toHaveLength(5);
    expect(r.equity).toEqual({ longTermAfterMonths: 12, ltcgRate: 0.125, ltcgExemption: 125000, stcgRate: 0.2 });
    expect(r.elss.lockInMonths).toBe(36);
  });
  it('tax.ts contains no numeric literal other than 0, 1, 2 and 100 (design §5.3)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'calculations', 'tax.ts'), 'utf8')
      .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``');
    const literals = [...src.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => m[1]);
    const offending = literals.filter((l) => !['0', '1', '2', '100'].includes(l!));
    expect(offending).toEqual([]);
  });
  it('holding term: exactly 12 months is short, one day later is long; 29 Feb clamps (E40)', () => {
    const mk = (date: string) => makeFund(`INF000T${date.replace(/-/g, '')}`, [makeFolio('F', [{ date, kind: 'purchase', amount: 1000, units: 10, nav: 100 }], { closingNav: 150 })]);
    const terms = (asOf: string, dates: string[]) => {
      const funds = dates.map(mk);
      const res = taxEstimate(makePortfolio(funds, asOf), d(asOf), () => equity);
      return res.funds.map((f) => f.lots[0]!.term);
    };
    expect(terms('2025-03-31', ['2024-03-31'])).toEqual(['short']);
    expect(terms('2025-04-01', ['2024-03-31', '2024-04-01'])).toEqual(['long', 'short']);
    expect(addMonths(d('2024-02-29'), 12)).toBe('2025-02-28');
    expect(terms('2025-02-28', ['2024-02-29'])).toEqual(['short']);
    expect(terms('2025-03-01', ['2024-02-29'])).toEqual(['long']);
  });
  it('applies the ₹1.25L exemption once across the portfolio, nets losses, and taxes at the configured rates (A16)', () => {
    const a = makeFund('INF000EQA', [makeFolio('A', [{ date: '2023-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 200 })]); // LT +100,000
    const b = makeFund('INF000EQB', [makeFolio('B', [{ date: '2023-02-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 180 })]); // LT +80,000
    const c = makeFund('INF000EQC', [makeFolio('C', [{ date: '2025-01-10', kind: 'purchase', amount: 50000, units: 500, nav: 100 }], { closingNav: 90 })]);   // ST -5,000
    const e = makeFund('INF000EQD', [makeFolio('D', [{ date: '2025-02-10', kind: 'purchase', amount: 50000, units: 500, nav: 100 }], { closingNav: 130 })]);  // ST +15,000
    const res = taxEstimate(makePortfolio([a, b, c, e], '2025-06-30'), d('2025-06-30'), () => equity);
    expect(res.equity).toEqual({ shortTermGain: 10000, shortTermTax: 2000, longTermGain: 180000, exemptionApplied: 125000, taxableLongTermGain: 55000, longTermTax: 6875 });
    expect(res.estimatedTaxIfRedeemed).toBe(8875);
    expect(res.exactFy).toBe(false); // FY2025-26 is not in the config yet -> latest rules
  });
  it('negative nets give zero tax and the loss is shown', () => {
    const a = makeFund('INF000LOSS', [makeFolio('A', [{ date: '2023-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 80 })]);
    const res = taxEstimate(makePortfolio([a], '2025-06-30'), d('2025-06-30'), () => equity);
    expect(res.equity.longTermGain).toBe(-20000);
    expect(res.equity.exemptionApplied).toBe(0);
    expect(res.estimatedTaxIfRedeemed).toBe(0);
  });
  it('ELSS: lots under 36 months are locked with an unlock date and excluded from the if-redeemed total (US-33, E41, E42)', () => {
    const f = makeFund('INF000ELSS', [makeFolio('A', [
      { date: '2022-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 },
      { date: '2023-06-12', kind: 'switch_in', amount: 50000, units: 500, nav: 100 },
    ], { closingNav: 300 })]);
    const res = taxEstimate(makePortfolio([f], '2025-06-30'), d('2025-06-30'), () => elss);
    const ft = res.funds[0]!;
    expect(ft.lots.map((l) => [l.term, l.unlockOn])).toEqual([['long', undefined], ['locked', '2026-06-12']]);
    expect(ft.longTermGain).toBe(200000);
    expect(ft.lockedGain).toBe(100000);
    expect(res.equity.longTermGain).toBe(200000);
    expect(res.estimatedTaxIfRedeemed).toBe(Math.round((200000 - 125000) * 0.125));
  });
  it('debt is reported at slab without a rupee tax; hybrid-other is shown but not computed; unknown ISINs and incomplete funds are excluded (US-32, A15, Q6)', () => {
    const dbt = makeFund('INF000DEBT', [makeFolio('A', [{ date: '2020-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 130 })]);
    const hyb = makeFund('INF000HYB', [makeFolio('B', [{ date: '2020-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 120 })]);
    const unk = makeFund('INF000UNK', [makeFolio('C', [{ date: '2020-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 120 })]);
    const bad = makeFund('INF000BAD', [makeFolio('D', [{ date: '2020-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }], { closingNav: 120 })], { mayBeIncomplete: true });
    const nonav = makeFund('INF000NONAV', [makeFolio('E', [{ date: '2020-01-10', kind: 'purchase', amount: 100000, units: 1000, nav: 100 }])]);
    const res = taxEstimate(makePortfolio([dbt, hyb, unk, bad, nonav], '2025-06-30'), d('2025-06-30'), lookup({ INF000DEBT: debt, INF000HYB: hybrid, INF000BAD: equity, INF000NONAV: equity }));
    expect(res.debt).toEqual({ gain: 30000, note: TAX_RULES[0]!.debt.note });
    expect(res.hybridOther).toEqual({ gain: 20000, note: TAX_RULES[0]!.hybridOther.note });
    expect(res.estimatedTaxIfRedeemed).toBe(0);
    expect(res.excludedFunds).toEqual([{ fundId: 'INF000UNK', reason: 'unclassified' }, { fundId: 'INF000BAD', reason: 'may-be-incomplete' }, { fundId: 'INF000NONAV', reason: 'no-closing-nav' }]);
  });
});
