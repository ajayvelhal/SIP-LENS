// src/calculations/allocation.ts
// Value by category (design §4.9, US-18). Percent to 1 dp; buckets ordered Equity, Hybrid, Debt, Other, Unclassified.

import type { ISODate, Portfolio } from '../parser/types';
import type { CategoryInfo } from './tax';
import { roundTo, round2, sumExact } from './money';

export interface AllocationResult {
  asOf: ISODate;
  buckets: { category: 'Equity' | 'Debt' | 'Hybrid' | 'Other' | 'Unclassified'; value: number; percent: number; fundIds: string[] }[];
  unclassifiedCount: number;
  total: number;
}

const ORDER = ['Equity', 'Hybrid', 'Debt', 'Other', 'Unclassified'] as const;

export function allocation(portfolio: Portfolio, categoryOf: (isin?: string) => CategoryInfo | undefined): AllocationResult {
  const groups = new Map<(typeof ORDER)[number], { values: number[]; fundIds: string[] }>();
  for (const c of ORDER) groups.set(c, { values: [], fundIds: [] });
  let unclassifiedCount = 0;
  for (const fund of portfolio.funds) {
    const cat = categoryOf(fund.isin)?.category ?? 'Unclassified';
    if (cat === 'Unclassified') unclassifiedCount++;
    const g = groups.get(cat) as { values: number[]; fundIds: string[] };
    g.fundIds.push(fund.id);
    if (fund.closingValue !== undefined) g.values.push(fund.closingValue);
  }
  const total = round2(sumExact([...groups.values()].flatMap((g) => g.values)));
  const buckets = ORDER.map((category) => {
    const g = groups.get(category) as { values: number[]; fundIds: string[] };
    const value = round2(sumExact(g.values));
    return { category, value, percent: total > 0 ? roundTo((100 * value) / total, 1) : 0, fundIds: g.fundIds };
  });
  return { asOf: portfolio.statementDate, buckets, unclassifiedCount, total };
}
