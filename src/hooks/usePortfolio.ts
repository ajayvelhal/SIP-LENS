// src/hooks/usePortfolio.ts
// The dashboard's Analysis (design §3.5 `useAnalysis`): every number the dashboard shows, computed synchronously on the
// main thread from the ParseResult through the engine's public exports, with the two bundled datasets loaded lazily
// (§3.3 step 7). Each Should calculation runs inside a boundary (§7.4) so a throw in one section cannot hide the XIRR tile.
// Nothing here formats, stores or sends anything.

import { useEffect, useMemo, useState } from 'react';
import type {
  AllocationResult, BenchmarkSeries, CategoryInfo, CategoryLookup, DetectedSip, DisciplineResult, Fund, FundXirrResult,
  IndexComparisonResult, ISODate, MissedCostResult, ParseResult, PortfolioSummary, TaxEstimateResult, Transaction,
} from '../engine';
import {
  allocation, fundSeries, fundTotals, indexComparison, loadBenchmark, loadCategories,
  sipKey, taxEstimate,
} from '../engine';
import { computeBase } from './computeBase';

export type Boundary<T> = { ok: true; value: T } | { ok: false };

export interface FundView {
  fund: Fund;
  xirr: FundXirrResult;
  totals: ReturnType<typeof fundTotals>;
  sips: DetectedSip[];
  category?: CategoryInfo;
}

export interface DisciplineView extends DisciplineResult {
  /** Missed-SIP cost per detected SIP, keyed by `sipKey` (fund, folio and first instalment date, so several SIPs in one folio stay separate); absent when the fund has no closing NAV. */
  missedCost: Map<string, MissedCostResult>;
}

export interface ComparisonView {
  portfolio: IndexComparisonResult;
  byFund: { fundId: string; result: IndexComparisonResult }[];
}

export type Pending<T> = 'loading' | Boundary<T>;

export interface Analysis {
  asOf: ISODate;
  result: ParseResult;
  summary: PortfolioSummary;
  /** Every fund in statement order, with its own series figures. */
  funds: FundView[];
  fundById: Map<string, Fund>;
  txById: Map<string, Transaction>;
  /** E62: no fund has a cashflow-bearing transaction. */
  isEmpty: boolean;
  /** A base calculation threw and was replaced by an empty fallback (design §7.4); the UI may offer the report option. */
  computeFailed: boolean;
  discipline: Boundary<DisciplineView>;
  allocation: Pending<AllocationResult>;
  tax: Pending<TaxEstimateResult>;
  comparison: Pending<ComparisonView>;
  categoryOf: CategoryLookup | null;
}

function guard<T>(fn: () => T): Boundary<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

interface Datasets { categoryOf: CategoryLookup; benchmark: BenchmarkSeries | null }

/** Module-level cache: the datasets contain no user data and are identical for every statement. */
let datasetsPromise: Promise<Datasets> | null = null;
function datasets(): Promise<Datasets> {
  datasetsPromise ??= Promise.all([loadCategories(), loadBenchmark()]).then(([cats, bench]) => ({ categoryOf: cats.categoryOf, benchmark: bench?.series ?? null }));
  return datasetsPromise;
}

export { sipKey };

export function usePortfolio(result: ParseResult): Analysis {
  const [data, setData] = useState<Datasets | null>(null);

  useEffect(() => {
    let live = true;
    void datasets().then((d) => { if (live) setData(d); }).catch(() => { if (live) setData({ categoryOf: () => undefined, benchmark: null }); });
    return () => { live = false; };
  }, []);

  const base = useMemo(() => computeBase(result), [result]);

  return useMemo<Analysis>(() => {
    const portfolio = result.portfolio;
    const { asOf } = base;
    if (!data) return { ...base, result, allocation: 'loading', tax: 'loading', comparison: 'loading', categoryOf: null };
    const { categoryOf, benchmark } = data;
    const funds = base.funds.map((v) => ({ ...v, category: categoryOf(v.fund.isin) }));
    const alloc = guard(() => allocation(portfolio, categoryOf));
    const tax = guard(() => taxEstimate(portfolio, asOf, categoryOf));
    const comparison: Boundary<ComparisonView> = benchmark
      ? guard<ComparisonView>(() => ({
          portfolio: indexComparison(base.summary.series, benchmark, asOf),
          byFund: portfolio.funds
            .map((f) => ({ fundId: f.id, series: fundSeries(f, asOf) }))
            .filter((x) => x.series.cashflows.length > 0)
            .map((x) => ({ fundId: x.fundId, result: indexComparison(x.series, benchmark, asOf) })),
        }))
      : { ok: true, value: { portfolio: { status: 'unavailable', reason: 'no-benchmark-data', benchmark: { fundName: 'Nifty 50 index fund', lastBundledDate: asOf } }, byFund: [] } };
    return { ...base, result, funds, allocation: alloc, tax, comparison, categoryOf };
  }, [base, data, result]);
}
