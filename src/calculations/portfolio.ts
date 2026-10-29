// src/calculations/portfolio.ts
// Fund- and portfolio-level aggregates the tiles and cards display (design §4.4, A23; data design D5, E43).
// Thin, pure compositions of cashflows.ts and xirr.ts.

import type { Fund, ISODate, Portfolio } from '../parser/types';
import type { CashflowSeries, XirrResult } from './types';
import { buildCashflows, hasOpeningBalance, isUnvaluable, seriesWithTerminal } from './cashflows';
import { round2, sumExact } from './money';
import { xirr } from './xirr';

/** A fund holding units with no history cannot have an XIRR (E43): there is no cost for the opening units. */
export type FundXirrResult = XirrResult | { status: 'insufficient'; reason: 'opening-balance-without-history' | 'no-closing-value' };

/** The fund's own series, regardless of flags (the card and drawer always show it). */
export function fundSeries(fund: Fund, asOf: ISODate): CashflowSeries {
  return buildCashflows([fund], asOf, { includeIncomplete: true, includeOpeningBalance: true });
}

export function fundXirr(fund: Fund, asOf: ISODate): FundXirrResult {
  if (hasOpeningBalance(fund)) return { status: 'insufficient', reason: 'opening-balance-without-history' };
  // Units held but neither NAV nor printed value: no terminal flow, so a computed rate would be ~-100% (design 4.3).
  if (isUnvaluable(fund)) return { status: 'insufficient', reason: 'no-closing-value' };
  return xirr(seriesWithTerminal(fundSeries(fund, asOf)));
}

export interface PortfolioSummary {
  series: CashflowSeries & { skippedFundIds: string[] };
  xirr: XirrResult;
  /** Σ outflows of the pooled series (positive). */
  totalInvested: number;
  totalRedeemed: number;
  /** Σ printed closingValue over all funds with one (V-14), incomplete funds included. */
  valueAsOfStatementDate: number;
  fundsWithoutPrintedValue: number;
  skippedFunds: { fundId: string; reason: 'may-be-incomplete' | 'opening-balance-without-history' | 'no-closing-value' }[];
}

export function portfolioSummary(portfolio: Portfolio, asOf: ISODate): PortfolioSummary {
  const series = buildCashflows(portfolio.funds, asOf);
  const skippedFunds = portfolio.funds
    .filter((f) => series.skippedFundIds.includes(f.id))
    .map((f) => ({
      fundId: f.id,
      reason: f.mayBeIncomplete ? ('may-be-incomplete' as const) : hasOpeningBalance(f) ? ('opening-balance-without-history' as const) : ('no-closing-value' as const),
    }));
  const withValue = portfolio.funds.filter((f) => f.closingValue !== undefined);
  return {
    series,
    xirr: xirr(seriesWithTerminal(series)),
    totalInvested: series.totals.invested,
    totalRedeemed: series.totals.redeemed,
    valueAsOfStatementDate: round2(sumExact(withValue.map((f) => f.closingValue as number))),
    fundsWithoutPrintedValue: portfolio.funds.length - withValue.length,
    skippedFunds,
  };
}

/** Per-fund card figures: invested (gross outflows), redeemed, net invested (US-13), terminal value. */
export function fundTotals(fund: Fund, asOf: ISODate): { invested: number; redeemed: number; netInvested: number; terminalValue: number } {
  const s = fundSeries(fund, asOf);
  return { invested: s.totals.invested, redeemed: s.totals.redeemed, netInvested: round2(s.totals.invested - s.totals.redeemed), terminalValue: s.totals.terminalValue };
}
