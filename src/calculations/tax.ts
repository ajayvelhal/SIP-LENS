// src/calculations/tax.ts
// Unrealised-gains preview "if you redeemed everything on the statement date" (design §4.8, US-30 to US-34):
// FIFO lots, long/short split by calendar-month arithmetic, the equity LTCG exemption applied once across the
// portfolio (A16), ELSS lock-in (US-33), debt at slab (US-32), hybrid-other not computed (A15).
// Every rate, threshold and period comes from taxRules.ts; the only numeric literals here are 0, 1, 2 and 100.

import type { Fund, ISODate, Portfolio } from '../parser/types';
import { addMonths } from './dates';
import { buildFifoLots, type Lot } from './fifo';
import { round2, roundRupee, sumExact } from './money';
import { rulesForDate, TAX_DISCLAIMER_LONG, TAX_DISCLAIMER_SHORT, type TaxRuleSet } from './taxRules';

export type TaxClass = 'equity' | 'debt' | 'hybrid-other' | 'unknown';
export interface CategoryInfo { category: 'Equity' | 'Debt' | 'Hybrid' | 'Other'; subCategory: string; taxClass: TaxClass; isElss: boolean }

export interface LotTax {
  lot: Lot;
  gain: number;                     // (closingNav - costPerUnit) x units, 2 dp; may be negative
  term: 'long' | 'short' | 'locked' | 'unknown-holding';
  unlockOn?: ISODate;               // ELSS lots while locked
}
export interface FundTax {
  fundId: string;
  taxClass: TaxClass;
  isElss: boolean;
  lots: LotTax[];
  shortTermGain: number;            // Σ ST gains (net of ST losses within the fund), rupee
  longTermGain: number;
  lockedGain: number;               // ELSS lots under lock: shown, excluded from the "if redeemed" total
  realisedEventsNotIncluded: number;
  note?: string;                    // 'taxed at your income-tax slab' | 'special hybrid rules; not computed' | 'unclassified; excluded'
}
export interface TaxEstimateResult {
  rules: TaxRuleSet;
  exactFy: boolean;
  asOf: ISODate;
  funds: FundTax[];
  equity: {
    shortTermGain: number; shortTermTax: number;
    longTermGain: number; exemptionApplied: number; taxableLongTermGain: number; longTermTax: number;
  };
  debt: { gain: number; note: string };
  hybridOther: { gain: number; note: string };
  excludedFunds: { fundId: string; reason: 'unclassified' | 'may-be-incomplete' | 'no-closing-nav' }[];
  /** equity ST + LT tax. Rupees, rounded to the rupee. Debt and hybrid-other add nothing by design. */
  estimatedTaxIfRedeemed: number;
  disclaimerLong: string;           // exact US-34 text
  disclaimerShort: string;          // 'This is an estimate only. Consult a CA.'
}

export const UNKNOWN_HOLDING_NOTE = 'units held before the statement period; holding period unknown; request a since-inception CAS';

/** Lots of one fund with their holding term and gain at the closing NAV. Exported for the drawer. */
export function fundLotTaxes(fund: Fund, asOf: ISODate, rules: TaxRuleSet, isElss: boolean, periodFrom?: ISODate): { lots: LotTax[]; realised: number } {
  const fifo = buildFifoLots(fund, asOf, periodFrom);
  const closingNav = fund.closingNav ?? 0;
  const lots: LotTax[] = fifo.openLots.map((lot) => {
    const gain = round2((closingNav - lot.costPerUnit) * lot.units);
    if (lot.source === 'opening_balance' || (lot.source === 'unit_adjustment' && lot.nav === 0)) {
      return { lot, gain, term: 'unknown-holding' };
    }
    if (isElss) {
      const unlockOn = addMonths(lot.acquiredOn, rules.elss.lockInMonths);
      if (asOf < unlockOn) return { lot, gain, term: 'locked', unlockOn };
    }
    const term: LotTax['term'] = asOf > addMonths(lot.acquiredOn, rules.equity.longTermAfterMonths) ? 'long' : 'short';
    return { lot, gain, term };
  });
  return { lots, realised: fifo.realisedEvents.length };
}

/** Pure. `categoryOf` is injected (from data/categories.ts) so this module imports no JSON. */
export function taxEstimate(
  portfolio: Portfolio,
  asOf: ISODate,
  categoryOf: (isin: string | undefined) => CategoryInfo | undefined,
  rulesOverride?: TaxRuleSet,
): TaxEstimateResult {
  const picked = rulesForDate(asOf);
  const rules = rulesOverride ?? picked.rules;
  const exactFy = rulesOverride ? true : picked.exactFy;

  const funds: FundTax[] = [];
  const excludedFunds: TaxEstimateResult['excludedFunds'] = [];
  for (const fund of portfolio.funds) {
    const cat = categoryOf(fund.isin);
    if (!cat || cat.taxClass === 'unknown') { excludedFunds.push({ fundId: fund.id, reason: 'unclassified' }); continue; }
    if (fund.mayBeIncomplete) { excludedFunds.push({ fundId: fund.id, reason: 'may-be-incomplete' }); continue; }
    if (fund.closingNav === undefined) { excludedFunds.push({ fundId: fund.id, reason: 'no-closing-nav' }); continue; }
    const { lots, realised } = fundLotTaxes(fund, asOf, rules, cat.isElss, portfolio.statementPeriod.from);
    const ft: FundTax = {
      fundId: fund.id,
      taxClass: cat.taxClass,
      isElss: cat.isElss,
      lots,
      shortTermGain: roundRupee(sumExact(lots.filter((l) => l.term === 'short').map((l) => l.gain))),
      longTermGain: roundRupee(sumExact(lots.filter((l) => l.term === 'long').map((l) => l.gain))),
      lockedGain: roundRupee(sumExact(lots.filter((l) => l.term === 'locked').map((l) => l.gain))),
      realisedEventsNotIncluded: realised,
    };
    if (cat.taxClass === 'debt') ft.note = 'taxed at your income-tax slab';
    else if (cat.taxClass === 'hybrid-other') ft.note = 'special hybrid rules; not computed';
    else if (lots.some((l) => l.term === 'unknown-holding')) ft.note = UNKNOWN_HOLDING_NOTE;
    funds.push(ft);
  }

  const equityFunds = funds.filter((f) => f.taxClass === 'equity');
  const stNet = roundRupee(sumExact(equityFunds.map((f) => f.shortTermGain)));
  const ltNet = roundRupee(sumExact(equityFunds.map((f) => f.longTermGain)));
  const exemptionApplied = Math.min(rules.equity.ltcgExemption, Math.max(0, ltNet));
  const taxableLongTermGain = Math.max(0, ltNet - exemptionApplied);
  const longTermTax = roundRupee(taxableLongTermGain * rules.equity.ltcgRate);
  const shortTermTax = roundRupee(Math.max(0, stNet) * rules.equity.stcgRate);
  const gainOf = (cls: TaxClass) => roundRupee(sumExact(funds.filter((f) => f.taxClass === cls).flatMap((f) => f.lots.filter((l) => l.term !== 'unknown-holding').map((l) => l.gain))));

  return {
    rules,
    exactFy,
    asOf,
    funds,
    equity: { shortTermGain: stNet, shortTermTax, longTermGain: ltNet, exemptionApplied, taxableLongTermGain, longTermTax },
    debt: { gain: gainOf('debt'), note: rules.debt.note },
    hybridOther: { gain: gainOf('hybrid-other'), note: rules.hybridOther.note },
    excludedFunds,
    estimatedTaxIfRedeemed: shortTermTax + longTermTax,
    disclaimerLong: TAX_DISCLAIMER_LONG,
    disclaimerShort: TAX_DISCLAIMER_SHORT,
  };
}
