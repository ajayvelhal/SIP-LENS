// src/calculations/indexCompare.ts
// Shadow-invests the investor's own dated cashflows in the benchmark index fund (design §4.7, US-27, US-28, A5, A6).
// Outflows buy benchmark units at the NAV on (or before) that date; an inflow sells the same fraction of the shadow
// holding that the investor sold of that fund (A6), tracked per fund so a pooled comparison stays proportional.
// Pure; no clock, no data import (the loaded series is injected).

import type { ISODate } from '../parser/types';
import type { CashflowSeries, XirrResult } from './types';
import { addDays, daysBetween } from './dates';
import { round2, roundRupee, sumExact } from './money';
import { xirr } from './xirr';

export interface BenchmarkSeries {
  /** See §5.1 for the JSON. Dates ascending, NAV 4 dp. */
  fundName: string;              // 'UTI Nifty 50 Index Fund - Direct Plan - Growth'
  amfiCode: string;
  isin: string;
  firstDate: ISODate;
  lastDate: ISODate;
  /** NAV on or before `date` (previous business day's NAV on holidays). null before firstDate. */
  navOnOrBefore(date: ISODate): { date: ISODate; nav: number } | null;
}

export interface IndexComparisonOptions {
  /** Max days to carry the last NAV forward past lastDate (A5). Default 45. */
  maxCarryForwardDays?: number;
}

export interface ShadowLeg {
  date: ISODate;
  actual: number;                // investor cashflow (investor sign)
  shadow: number;                // shadow cashflow (investor sign)
  benchmarkNav: number;
  benchmarkNavDate: ISODate;     // may be earlier than `date` (holiday) or lastDate (carried forward)
  shadowUnitsAfter: number;
  excluded?: 'before-series' | 'after-carry-window';
}

export type IndexComparisonResult =
  | {
      status: 'ok' | 'partial';
      scope: 'portfolio' | 'fund';
      fundId?: string;
      yourXirr: XirrResult;
      benchmarkXirr: XirrResult;
      /** benchmark - yours, in percentage points (decimal, 0.023 = 2.3 pp); undefined if either XIRR not ok. */
      gapPoints?: number;
      /** Total-wealth difference, rupees to the nearest rupee (A6): positive = index would have been worth more. */
      valueDifference?: number;
      shadowTerminalValue: number;
      shadowCashReceived: number;
      actualTerminalValue: number;
      actualCashReceived: number;
      legs: ShadowLeg[];
      /** Σ |excluded outflows| (US-28 "excluded amount stated"). */
      excludedAmount: number;
      excludedCount: number;
      carriedForwardDays: number;   // 0 when the series covers asOf
      benchmark: { fundName: string; source: 'AMFI NAV history'; lastBundledDate: ISODate };
    }
  | { status: 'unavailable'; reason: 'series-too-old' | 'no-cashflows-in-range' | 'no-benchmark-data';
      benchmark: { fundName: string; lastBundledDate: ISODate } };

/** Pure. `series` is the loaded benchmark; `funds` are the non-incomplete funds (or one fund). */
export function indexComparison(
  series: CashflowSeries,
  benchmark: BenchmarkSeries,
  asOf: ISODate,
  opts: IndexComparisonOptions = {},
): IndexComparisonResult {
  const carry = opts.maxCarryForwardDays ?? 45;
  const carryLimit = addDays(benchmark.lastDate, carry);
  const unavailable = (reason: 'series-too-old' | 'no-cashflows-in-range' | 'no-benchmark-data'): IndexComparisonResult =>
    ({ status: 'unavailable', reason, benchmark: { fundName: benchmark.fundName, lastBundledDate: benchmark.lastDate } });
  if (!benchmark.navOnOrBefore(benchmark.lastDate)) return unavailable('no-benchmark-data');
  if (asOf > carryLimit) return unavailable('series-too-old');

  const fundIds = new Set(series.cashflows.map((c) => c.fundId));
  const scope: 'portfolio' | 'fund' = fundIds.size === 1 ? 'fund' : 'portfolio';
  const unitsByFund = new Map<string, number>();
  const legs: ShadowLeg[] = [];
  const shadowFlows: Array<{ date: ISODate; amount: number }> = [];
  let excludedAmount = 0;
  let excludedCount = 0;
  let carriedForwardDays = 0;
  let shadowCashReceived = 0;
  let actualCashReceived = 0;
  let partial = false;

  const navFor = (date: ISODate): { nav: number; navDate: ISODate; carried: number } | null => {
    const lookup = date > benchmark.lastDate ? benchmark.lastDate : date;
    const point = benchmark.navOnOrBefore(lookup);
    if (!point) return null;
    const carried = date > benchmark.lastDate ? daysBetween(benchmark.lastDate, date) : 0;
    return { nav: point.nav, navDate: point.date, carried };
  };

  for (const cf of series.cashflows) {
    if (cf.kind === 'terminal') continue;
    const held = unitsByFund.get(cf.fundId) ?? 0;
    if (cf.date < benchmark.firstDate || cf.date > carryLimit) {
      const reason = cf.date < benchmark.firstDate ? 'before-series' : 'after-carry-window';
      legs.push({ date: cf.date, actual: cf.amount, shadow: 0, benchmarkNav: 0, benchmarkNavDate: cf.date, shadowUnitsAfter: held, excluded: reason });
      if (cf.amount < 0) excludedAmount += -cf.amount;
      excludedCount++;
      partial = true;
      continue;
    }
    const n = navFor(cf.date);
    if (!n) {
      legs.push({ date: cf.date, actual: cf.amount, shadow: 0, benchmarkNav: 0, benchmarkNavDate: cf.date, shadowUnitsAfter: held, excluded: 'before-series' });
      if (cf.amount < 0) excludedAmount += -cf.amount;
      excludedCount++;
      partial = true;
      continue;
    }
    if (n.carried > carriedForwardDays) carriedForwardDays = n.carried;
    let shadow: number;
    let after: number;
    if (cf.amount < 0) {
      after = held + -cf.amount / n.nav;
      shadow = cf.amount;
    } else {
      let sold: number;
      if (cf.fractionOfHolding !== undefined) sold = held * Math.min(1, Math.max(0, cf.fractionOfHolding));
      else {
        // Dividend payout (no unit change): sell the same rupees, clamped at what the shadow holds (E60).
        sold = Math.min(held, cf.amount / n.nav);
        if (sold < cf.amount / n.nav - 1e-9) partial = true;
      }
      after = held - sold;
      shadow = round2(sold * n.nav);
      shadowCashReceived += shadow;
      actualCashReceived += cf.amount;
    }
    unitsByFund.set(cf.fundId, after);
    legs.push({ date: cf.date, actual: cf.amount, shadow, benchmarkNav: n.nav, benchmarkNavDate: n.navDate, shadowUnitsAfter: after });
    if (shadow !== 0) shadowFlows.push({ date: cf.date, amount: shadow });
  }
  if (shadowFlows.length === 0) return unavailable('no-cashflows-in-range');

  const terminalNav = navFor(asOf);
  if (!terminalNav) return unavailable('no-benchmark-data');
  if (terminalNav.carried > carriedForwardDays) carriedForwardDays = terminalNav.carried;
  const shadowUnits = sumExact(unitsByFund.values());
  const shadowTerminalValue = round2(shadowUnits * terminalNav.nav);
  if (shadowTerminalValue > 0) shadowFlows.push({ date: asOf, amount: shadowTerminalValue });

  const actualFlows: Array<{ date: ISODate; amount: number }> = series.cashflows.map((c) => ({ date: c.date, amount: c.amount }));
  if (series.terminal) actualFlows.push({ date: series.terminal.date, amount: series.terminal.amount });
  const yourXirr = xirr(actualFlows);
  const benchmarkXirr = xirr(shadowFlows);
  const actualTerminalValue = series.terminal?.amount ?? 0;

  const result: IndexComparisonResult = {
    status: partial || carriedForwardDays > 0 ? 'partial' : 'ok',
    scope,
    yourXirr,
    benchmarkXirr,
    shadowTerminalValue,
    shadowCashReceived: round2(shadowCashReceived),
    actualTerminalValue,
    actualCashReceived: round2(actualCashReceived),
    legs,
    excludedAmount: round2(excludedAmount),
    excludedCount,
    carriedForwardDays,
    benchmark: { fundName: benchmark.fundName, source: 'AMFI NAV history', lastBundledDate: benchmark.lastDate },
  };
  if (scope === 'fund') result.fundId = [...fundIds][0] as string;
  if (yourXirr.status === 'ok' && benchmarkXirr.status === 'ok') result.gapPoints = benchmarkXirr.rate - yourXirr.rate;
  result.valueDifference = roundRupee(shadowTerminalValue + shadowCashReceived - (actualTerminalValue + actualCashReceived));
  return result;
}
