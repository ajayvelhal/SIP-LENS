// src/calculations/taxRules.ts
// THE versioned tax-rules config (spec C5, US-31; design §4.8, §5.3). No rate, threshold or holding period lives
// anywhere else; tests/data/taxRules.test.ts greps tax.ts for stray numeric literals.
//
// Status: the FY2026-27 entry carries the Budget 2024 rules (Finance (No. 2) Act 2024, effective 23 July 2024) as
// transcribed from the spec's Appendix F. It is 'to-verify' until the owner checks it against the Finance Act in
// force for FY 2026-27 and signs `verifiedBy`; the UI shows "(unverified)" until then.

import type { ISODate } from '../parser/types';
import { fyOf } from './dates';

export interface TaxRuleSet {
  fy: string;                       // 'FY2026-27'
  fyStart: ISODate;                 // '2026-04-01'
  fyEnd: ISODate;                   // '2027-03-31'
  financeActReference: string;      // 'Finance (No. 2) Act 2024, s. 112A/111A as amended; verify for FY 2026-27'
  lastVerified: ISODate;            // shown in the UI heading
  verifiedBy: string;               // GitHub handle
  status: 'verified' | 'to-verify'; // UI adds "(unverified)" when 'to-verify'
  equity: {
    longTermAfterMonths: 12;        // LT iff asOf > addMonths(lotDate, 12)
    ltcgRate: number;               // 0.125
    ltcgExemption: number;          // 125000, applied once per portfolio per FY (A16)
    stcgRate: number;               // 0.20
  };
  debt: {
    treatment: 'slab';              // no rupee tax computed (US-32)
    note: string;                   // 'Taxed at your income-tax slab (post 1 Apr 2023; no indexation)'
  };
  hybridOther: {
    treatment: 'not-computed';      // A15
    note: string;
  };
  elss: {
    lockInMonths: 36;               // locked iff asOf < addMonths(lotDate, 36)
  };
  /** Rows of Appendix F reproduced for the "Rules we used" drawer (US-31). */
  displayTable: { fundType: string; holdingPeriod: string; rate: string; notes: string }[];
  simplifications: string[];        // 'Hybrid 35–65% equity not computed', 'Debt bought before 1 Apr 2023 treated as slab', ...
}

export const TAX_DISCLAIMER_LONG =
  'Tax calculations are estimates based on the information provided and publicly available rules for FY 2026-27. Tax laws change. This is not tax advice. Consult a Chartered Accountant before filing.';
export const TAX_DISCLAIMER_SHORT = 'This is an estimate only. Consult a CA.';

export const TAX_RULES: readonly TaxRuleSet[] = [
  {
    fy: 'FY2026-27',
    fyStart: '2026-04-01' as ISODate,
    fyEnd: '2027-03-31' as ISODate,
    financeActReference: 'Finance (No. 2) Act 2024, s. 111A/112A as amended; verify for FY 2026-27',
    // Date the table was transcribed from the spec (Appendix F). Nobody has verified it against the Act yet.
    lastVerified: '2026-10-26' as ISODate,
    verifiedBy: '',
    status: 'to-verify',
    equity: { longTermAfterMonths: 12, ltcgRate: 0.125, ltcgExemption: 125_000, stcgRate: 0.2 },
    debt: { treatment: 'slab', note: 'Taxed at your income-tax slab (post 1 Apr 2023; no indexation)' },
    hybridOther: { treatment: 'not-computed', note: 'Special hybrid rules; not computed in v1' },
    elss: { lockInMonths: 36 },
    displayTable: [
      { fundType: 'Equity / hybrid (≥65% equity)', holdingPeriod: '> 1 year', rate: '12.5% on gains above ₹1.25L', notes: 'LTCG; ₹1.25L exempt per FY' },
      { fundType: 'Equity / hybrid (≥65% equity)', holdingPeriod: '≤ 1 year', rate: '20%', notes: 'STCG; no exemption' },
      { fundType: 'Debt / international', holdingPeriod: 'Any', rate: 'Income slab rate', notes: 'Post Apr 2023; no indexation' },
      { fundType: 'ELSS', holdingPeriod: '< 3 years', rate: 'Locked, cannot redeem', notes: 'Enforce in UI' },
      { fundType: 'ELSS', holdingPeriod: '≥ 3 years', rate: 'Same as equity LTCG', notes: 'After lock-in' },
    ],
    simplifications: [
      'Hybrid funds with 35–65% equity are shown but not computed',
      'Debt units bought before 1 Apr 2023 are treated at slab (no indexation)',
      'Overseas FoF and gold/silver funds are treated as debt (slab); later Finance Act changes for these categories are not modelled',
      'Solution-oriented funds are shown but not computed',
      'Units held before the statement period have an unknown holding period and are excluded',
    ],
  },
];

/** Rules for the statement date's FY; the latest FY in the config when that FY is absent (A17). */
export function rulesForDate(asOf: ISODate): { rules: TaxRuleSet; exactFy: boolean } {
  const fy = fyOf(asOf);
  const exact = TAX_RULES.find((r) => r.fy === fy);
  if (exact) return { rules: exact, exactFy: true };
  const latest = [...TAX_RULES].sort((a, b) => (a.fyStart < b.fyStart ? 1 : -1))[0] as TaxRuleSet;
  return { rules: latest, exactFy: false };
}
